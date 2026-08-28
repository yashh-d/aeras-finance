"use client";

// Conversion execution engine.
//
// Takes a convert-then-deposit plan and actually performs the conversion: builds
// the route, grants any ERC-20 allowance, signs and broadcasts the source-chain
// leg with the user's own wallet, hands the hash to Trustware, then tracks the
// route to settlement.
//
// Trustware routes and tracks; Privy signs. Every Trustware call goes through our
// server proxies so the API key stays server-side. The only things that happen in
// the browser are the two that structurally must: signing with the user's wallet,
// and reading back what landed.
//
// Two rules run through all of this:
//
//   1. Nothing downstream may treat funds as delivered before Trustware reports
//      `success`. On `failed` the source funds are refunded, so acting early
//      would credit collateral the user does not have.
//   2. The last chance to abort safely is before the user signs. Once the source
//      transaction is broadcast their funds are committed, so every validation
//      that can happen before signing does.

import type { EIP1193Provider } from "@privy-io/react-auth";
import { encodeFunctionData, erc20Abi } from "viem";

import {
  executeSolanaConversion,
  quoteSolanaConversion,
} from "@/lib/jupiter/convert";
import { TRUSTWARE_SOLANA_CHAIN } from "./constants";
import { buildEvmTxParams, usableApprovals } from "./evm-tx";
import type { ConvertThenDepositPlan } from "./planner";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  isTerminalStatus,
  type TrustwareApproval,
  type TrustwareEvmTransaction,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
  type TrustwareStatusResponse,
} from "./types";

export type ConversionStage =
  | "routing"
  | "approving"
  | "signing"
  | "tracking"
  | "settled";

export interface ConversionProgress {
  stage: ConversionStage;
  // User-facing, already phrased for display.
  message: string;
  sourceTxHash?: string;
  destTxHash?: string;
}

export interface EvmSigner {
  address: string;
  // Wallet-level chain switch. Privy binds each provider instance to the chain
  // active when it was requested, and the signing confirmation follows the
  // wallet's active chain, so the switch must happen at the wallet level and a
  // FRESH provider must be requested after it (see lib/privy/evm.ts).
  switchChain: (chainId: number) => Promise<void>;
  getProvider: () => Promise<EIP1193Provider>;
}

export interface SolanaSigner {
  address: string;
  // Sign a base64 transaction, broadcast it, and resolve with the signature.
  signAndSendBase64: (base64Tx: string) => Promise<string>;
}

export interface ExecuteConversionInput {
  plan: ConvertThenDepositPlan;
  // Always required: it is the destination of every conversion, and the signer
  // when the source is Solana.
  solana: SolanaSigner;
  // Required only when the plan's source is an EVM chain.
  evm?: EvmSigner;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
}

export interface ConversionResult {
  intentId: string;
  sourceTxHash: string;
  destTxHash: string | null;
  // Destination units actually delivered, when Trustware reports them.
  deliveredAtomic: string | null;
}

// A bridged route can legitimately take minutes. This bounds the wait so the UI
// cannot hang forever; timing out here does not cancel the route, it only stops
// us watching, so the message says so.
const MAX_TRACKING_MS = 15 * 60_000;
const MIN_POLL_MS = 2_000;
const MAX_POLL_MS = 15_000;
// The receipt is the one call that must land. Losing it makes a conversion the
// user has already paid for untrackable, so this retries well past the point
// that would be reasonable for a read.
const RECEIPT_ATTEMPTS = 6;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Conversion cancelled."));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new Error("Conversion cancelled."));
      },
      { once: true },
    );
  });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(parsed.error ?? `${path} failed: ${res.status}`);
  return parsed;
}

// Build the route request. Mirrors the planner's quote request so the route we
// execute matches the one that was priced.
function routeRequest(
  plan: ConvertThenDepositPlan,
  fromAddress: string,
  toAddress: string,
): TrustwareQuoteRequest {
  return {
    fromChain: plan.source.chain,
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: plan.source.token,
    toToken: plan.vault.collateralMint,
    fromAmount: plan.sourceAmountAtomic,
    fromAddress,
    toAddress,
    slippage: plan.quote.slippagePct,
  };
}

export async function executeConversion(
  input: ExecuteConversionInput,
): Promise<ConversionResult> {
  const { plan, solana, evm, onProgress, signal } = input;
  const report = (
    stage: ConversionStage,
    message: string,
    extra?: Partial<ConversionProgress>,
  ) => onProgress?.({ stage, message, ...extra });

  const isSolanaSource = plan.source.kind === "solana";
  const fromAddress = isSolanaSource ? solana.address : evm?.address;
  if (!fromAddress) {
    throw new Error(
      `No ${plan.source.chainLabel} wallet is available to sign this conversion.`,
    );
  }

  // Solana to Solana never leaves the chain, so there is no route to bridge, no
  // intent to track and no receipt to submit. It is a swap, and Jupiter executes
  // it. Trustware cannot: its /route returns no signable transaction whenever it
  // selects the relay provider for this pair, which is what
  // scripts/trustware-solana-route-check.mts demonstrates.
  if (isSolanaSource) {
    return runSolanaConversion(plan, solana, report);
  }

  report("routing", `Preparing the ${plan.source.symbol} conversion.`);
  const routeRes = await postJson<TrustwareQuoteResponse>(
    "/api/trustware/route",
    routeRequest(plan, fromAddress, solana.address),
  );

  const intentId = extractIntentId(routeRes);
  const execution = extractExecution(routeRes);
  const transaction = execution?.transaction;
  if (!intentId) throw new Error("Trustware returned no intent to track.");
  if (!transaction) throw new Error("Trustware returned no transaction to sign.");

  // Re-quoting between planning and routing can move the rate. Verify the route
  // still clears the shortfall before the user commits funds, since this is the
  // last point where aborting costs nothing.
  const estimate = extractEstimate(routeRes);
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
  if (guaranteed && BigInt(guaranteed) < BigInt(plan.shortfallAtomic)) {
    throw new Error(
      "The conversion rate moved and no longer covers this deposit. " +
        "Try again to get a fresh quote.",
    );
  }

  if (!evm) throw new Error("No EVM wallet is available to sign.");
  const provider = await connectChain(evm, plan.source.chain);
  await grantApprovals({
    provider,
    approvals: usableApprovals(execution?.approvals),
    owner: evm.address,
    chain: plan.source.chain,
    symbol: plan.source.symbol,
    report,
    signal,
  });
  report(
    "signing",
    `Converting ${plan.source.symbol} to ${plan.vault.collateralSymbol}.`,
  );
  const sourceTxHash = await sendEvmTransaction(
    provider,
    transaction,
    evm.address,
  );

  // Submit immediately after broadcast, before anything else. Without this
  // Trustware cannot track a route the user has already paid for.
  await submitTrustwareReceipt(intentId, sourceTxHash, signal);

  report("tracking", "Waiting for the converted asset to arrive on Solana.", {
    sourceTxHash,
  });
  const final = await trackTrustwareSettlement(intentId, signal, (status) =>
    report("tracking", describeStatus(status, plan), {
      sourceTxHash,
      destTxHash: status.data?.dest_tx_hash,
    }),
  );

  const delivered = final.data?.to_amount_wei ?? null;
  report("settled", `${plan.vault.collateralSymbol} arrived on Solana.`, {
    sourceTxHash,
    destTxHash: final.data?.dest_tx_hash,
  });

  return {
    intentId,
    sourceTxHash,
    destTxHash: final.data?.dest_tx_hash ?? null,
    deliveredAtomic: delivered,
  };
}

// Convert one Solana token into another with Jupiter, and confirm it landed.
//
// This is a single transaction the user signs, so there is no in-flight state to
// recover: it either lands or it does not. That makes it strictly safer than the
// bridged path, which is why no receipt or status polling appears here.
async function runSolanaConversion(
  plan: ConvertThenDepositPlan,
  solana: SolanaSigner,
  report: (
    stage: ConversionStage,
    message: string,
    extra?: Partial<ConversionProgress>,
  ) => void,
): Promise<ConversionResult> {
  report("routing", `Pricing the ${plan.source.symbol} swap.`);
  // Re-quoted here rather than reusing the plan's quote, so the transaction is
  // built against the freshest rate and the plan's numbers cannot go stale
  // between preview and signature.
  const quote = await quoteSolanaConversion({
    inputMint: plan.source.token,
    inputDecimals: plan.source.decimals,
    outputMint: plan.vault.collateralMint,
    outputDecimals: plan.vault.collateralDecimals,
    amountAtomic: plan.sourceAmountAtomic,
  });

  // Last point where stopping costs nothing. After this the user has signed.
  if (BigInt(quote.toAmountMinAtomic) < BigInt(plan.shortfallAtomic)) {
    throw new Error(
      "The swap rate moved and no longer covers this deposit. " +
        "Try again to get a fresh quote.",
    );
  }

  report(
    "signing",
    `Swapping ${plan.source.symbol} for ${plan.vault.collateralSymbol}.`,
  );
  const { signature } = await executeSolanaConversion({
    quote,
    userPublicKey: solana.address,
    signAndSendBase64: solana.signAndSendBase64,
  });

  report("settled", `${plan.vault.collateralSymbol} arrived in your wallet.`, {
    sourceTxHash: signature,
    destTxHash: signature,
  });

  return {
    // Same-chain swaps have no Trustware intent. The signature identifies the
    // conversion everywhere an intent id would have.
    intentId: signature,
    sourceTxHash: signature,
    destTxHash: signature,
    // The swap's own minimum. The caller reads the settled ATA balance anyway,
    // which is the number that actually governs the deposit.
    deliveredAtomic: quote.toAmountMinAtomic,
  };
}

// Run one EVM-source Trustware route end to end: build it, grant approvals,
// sign the source transaction with the embedded wallet, submit the receipt,
// and track to settlement. The generic engine behind flows that are not xStock
// conversions (the Monad -> Solana USDC return leg in lib/morpho/fund.ts).
// The same two rules as executeConversion apply: nothing downstream treats
// funds as delivered before Trustware reports success, and the last free abort
// is before the user signs.
export interface EvmRouteResult {
  intentId: string;
  sourceTxHash: string;
  destTxHash: string | null;
  // Destination units actually delivered, when Trustware reports them.
  deliveredAtomic: string | null;
}

export async function executeEvmRoute(args: {
  request: TrustwareQuoteRequest;
  evm: EvmSigner;
  // Progress-copy noun for what is moving, e.g. "USDC".
  describe: string;
  // Guaranteed-minimum floor the fresh route must clear before signing.
  // 0n disables the check.
  minDeliveredAtomic?: bigint;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
}): Promise<EvmRouteResult> {
  const { request, evm, describe, onProgress, signal } = args;
  const report = (
    stage: ConversionStage,
    message: string,
    extra?: Partial<ConversionProgress>,
  ) => onProgress?.({ stage, message, ...extra });

  report("routing", `Preparing the ${describe} transfer.`);
  const routeRes = await postJson<TrustwareQuoteResponse>(
    "/api/trustware/route",
    request,
  );
  const intentId = extractIntentId(routeRes);
  const execution = extractExecution(routeRes);
  const transaction = execution?.transaction;
  if (!intentId) throw new Error("Trustware returned no intent to track.");
  if (!transaction) throw new Error("Trustware returned no transaction to sign.");

  const estimate = extractEstimate(routeRes);
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
  const floor = args.minDeliveredAtomic ?? 0n;
  if (floor > 0n && guaranteed && BigInt(guaranteed) < floor) {
    throw new Error(
      "The rate moved and no longer covers this transfer. " +
        "Try again to get a fresh quote.",
    );
  }

  const provider = await connectChain(evm, request.fromChain);
  await grantApprovals({
    provider,
    approvals: usableApprovals(execution?.approvals),
    owner: evm.address,
    chain: request.fromChain,
    symbol: describe,
    report,
    signal,
  });
  report("signing", `Sending ${describe}.`);
  const sourceTxHash = await sendEvmTransaction(provider, transaction, evm.address);

  // Submit immediately after broadcast, before anything else. Without this
  // Trustware cannot track a route the user has already paid for.
  await submitTrustwareReceipt(intentId, sourceTxHash, signal);

  report("tracking", `Bridging ${describe}. This can take a few minutes.`, {
    sourceTxHash,
  });
  const final = await trackTrustwareSettlement(intentId, signal, (status) =>
    report(
      "tracking",
      status.data?.gas_status === "needs_gas"
        ? "The route stalled waiting for destination gas. Trustware is retrying."
        : `Bridging ${describe}. This can take a few minutes.`,
      { sourceTxHash, destTxHash: status.data?.dest_tx_hash },
    ),
  );

  report("settled", `${describe} arrived.`, {
    sourceTxHash,
    destTxHash: final.data?.dest_tx_hash,
  });
  return {
    intentId,
    sourceTxHash,
    destTxHash: final.data?.dest_tx_hash ?? null,
    deliveredAtomic: final.data?.to_amount_wei ?? null,
  };
}

// Point the wallet at the source chain and hand back a provider bound to it.
//
// The switch happens on the WALLET, never via wallet_switchEthereumChain on a
// provider: a provider instance is bound to the chain active when it was
// requested, and the Privy signing confirmation follows the wallet's active
// chain, not the provider's (that split once presented a Monad transaction as
// an Ethereum one in the Morpho flow). Privy only permits chains declared in
// `supportedChains`, so an undeclared chain fails here rather than silently
// signing on the wrong network, and the chainId read-back on the fresh
// provider is the final guard before anything is signed.
// Exported because reads need it too, not only signing. Anything that wants to
// eth_call against a specific chain has to go through the same switch: a
// provider bound to Monad answers a Ethereum balanceOf with whatever that
// address holds on Monad, silently and wrongly. One implementation of this
// exists on purpose; the failure mode it guards is subtle enough that a second
// copy would drift.
export { connectChain as connectEvmChain };

async function connectChain(
  evm: EvmSigner,
  chain: string,
): Promise<EIP1193Provider> {
  const target = Number(chain);
  if (!Number.isInteger(target) || target <= 0) {
    throw new Error(`Unsupported source chain: ${chain}`);
  }
  try {
    await evm.switchChain(target);
  } catch {
    throw new Error(
      `Could not switch the wallet to chain ${chain}. ` +
        "The conversion was not started and no funds moved.",
    );
  }
  // The wallet-level switch propagates asynchronously: switchChain can resolve
  // while a provider requested right after is still bound to the previous
  // chain (observed live on the Monad flow, 2026-08-26). Poll for the binding,
  // nudging the provider instance directly as a fallback. The chainId
  // read-back stays the hard gate: nothing is signed until a provider actually
  // reports the target chain.
  const deadline = Date.now() + 5_000;
  for (;;) {
    const provider = await evm.getProvider();
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (BigInt(current) === BigInt(target)) return provider;
    if (Date.now() >= deadline) {
      throw new Error(
        `The wallet did not switch to chain ${chain}. ` +
          "The conversion was not started and no funds moved.",
      );
    }
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${target.toString(16)}` }],
      });
    } catch {
      // The wallet-level switch may still land on its own; keep polling.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function grantApprovals(args: {
  provider: EIP1193Provider;
  approvals: TrustwareApproval[];
  owner: string;
  chain: string;
  symbol: string;
  report: (stage: ConversionStage, message: string) => void;
  signal?: AbortSignal;
}) {
  const { provider, approvals, owner, chain, symbol, report, signal } = args;
  for (const approval of approvals) {
    // The spender is the provider contract for this specific route and is not
    // the same as transaction.to. Re-quoting can change the provider, so this
    // is read from the route response rather than cached.
    const qs = new URLSearchParams({
      chainId: String(approval.chainId ?? chain),
      tokenAddress: approval.tokenAddress,
      ownerAddress: owner,
      spenderAddress: approval.spender,
    });
    const res = await fetch(`/api/trustware/allowance?${qs}`, {
      cache: "no-store",
    });
    const body = (await res.json()) as {
      data?: { allowance?: string };
      error?: string;
    };
    if (!res.ok) {
      throw new Error(body.error ?? `Could not read the ${symbol} allowance.`);
    }
    const current = BigInt(body.data?.allowance ?? "0");
    if (current >= BigInt(approval.amount)) continue;

    report("approving", `Approving ${symbol} for the conversion.`);
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [approval.spender as `0x${string}`, BigInt(approval.amount)],
    });
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: owner, to: approval.tokenAddress, data }],
    })) as string;
    await waitForEvmReceipt(provider, hash, signal);
  }
}

// Wait for an approval to mine. The route transaction will revert if it is
// broadcast while the allowance is still pending.
async function waitForEvmReceipt(
  provider: EIP1193Provider,
  hash: string,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error("The approval transaction failed on chain.");
      }
      return;
    }
    await sleep(MIN_POLL_MS, signal);
  }
  throw new Error("The approval transaction did not confirm in time.");
}

async function sendEvmTransaction(
  provider: EIP1193Provider,
  tx: TrustwareEvmTransaction,
  from: string,
): Promise<string> {
  return (await provider.request({
    method: "eth_sendTransaction",
    params: [buildEvmTxParams(tx, from)],
  })) as string;
}

// Exported for reuse: the Morpho-on-Monad funding leg (lib/morpho/fund.ts)
// broadcasts its own source transaction and then needs the same receipt and
// settlement machinery as an xStock conversion.
export async function submitTrustwareReceipt(
  intentId: string,
  txHash: string,
  signal?: AbortSignal,
) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RECEIPT_ATTEMPTS; attempt++) {
    try {
      await postJson("/api/trustware/receipt", { intentId, txHash });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < RECEIPT_ATTEMPTS - 1) {
        await sleep(Math.min(MIN_POLL_MS * 2 ** attempt, MAX_POLL_MS), signal);
      }
    }
  }
  // The funds have already moved at this point, so the message has to make the
  // real situation clear rather than read like a failed deposit.
  throw new Error(
    `The conversion was broadcast (${txHash}) but Trustware could not be told ` +
      `to track it: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}. ` +
      "The funds are not lost. Keep this transaction hash.",
  );
}

export async function trackTrustwareSettlement(
  intentId: string,
  signal: AbortSignal | undefined,
  onTick: (status: TrustwareStatusResponse) => void,
): Promise<TrustwareStatusResponse> {
  const deadline = Date.now() + MAX_TRACKING_MS;
  let delay = MIN_POLL_MS;

  while (Date.now() < deadline) {
    await sleep(delay, signal);
    const res = await fetch(
      `/api/trustware/status?intentId=${encodeURIComponent(intentId)}`,
      { cache: "no-store" },
    );

    // 404 means tracking has not started yet, which is expected right after
    // broadcast and is not a failure.
    if (res.status === 404) continue;

    const body = (await res.json()) as TrustwareStatusResponse;
    if (!res.ok) {
      // A transient status read must not abort a route that is still running.
      delay = Math.min(delay * 2, MAX_POLL_MS);
      continue;
    }
    onTick(body);

    const status = body.data?.status;
    if (status === "failed") {
      throw new Error(
        "The conversion failed and Trustware has refunded the source chain. " +
          "Nothing was deposited.",
      );
    }
    if (isTerminalStatus(status)) return body;

    // Prefer the server's suggested cadence over a fixed interval.
    delay = nextDelay(body.data?.next_poll_at, delay);
  }

  throw new Error(
    "The conversion is taking longer than expected and is still in flight. " +
      "It has not failed. Check back shortly rather than retrying, so you are " +
      "not charged twice.",
  );
}

function nextDelay(nextPollAt: string | undefined, previous: number): number {
  if (nextPollAt) {
    const wait = new Date(nextPollAt).getTime() - Date.now();
    if (Number.isFinite(wait) && wait > 0) {
      return Math.min(Math.max(wait, MIN_POLL_MS), MAX_POLL_MS);
    }
  }
  return Math.min(Math.round(previous * 1.5), MAX_POLL_MS);
}

function describeStatus(
  status: TrustwareStatusResponse,
  plan: ConvertThenDepositPlan,
): string {
  if (status.data?.gas_status === "needs_gas") {
    return "The route stalled waiting for destination gas. Trustware is retrying.";
  }
  switch (status.data?.status) {
    case "bridging":
      return `Bridging ${plan.source.symbol} to Solana.`;
    case "submitted":
      return "Conversion submitted. Waiting for confirmation.";
    default:
      return `Converting to ${plan.vault.collateralSymbol}.`;
  }
}
