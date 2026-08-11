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
  toQuantity,
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
  const provider = await evm.getProvider();
  await ensureChain(provider, plan.source.chain);
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
  await submitReceipt(intentId, sourceTxHash, signal);

  report("tracking", "Waiting for the converted asset to arrive on Solana.", {
    sourceTxHash,
  });
  const final = await trackToSettlement(intentId, signal, (status) =>
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

// Point the wallet at the source chain. Privy only permits chains declared in
// `supportedChains`, so an undeclared chain fails here rather than silently
// signing on the wrong network.
async function ensureChain(provider: EIP1193Provider, chain: string) {
  const chainId = toQuantity(chain);
  if (!chainId) throw new Error(`Unsupported source chain: ${chain}`);
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (BigInt(current) === BigInt(chain)) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch {
    throw new Error(
      `Could not switch the wallet to chain ${chain}. ` +
        "The conversion was not started and no funds moved.",
    );
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

async function submitReceipt(
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

async function trackToSettlement(
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
