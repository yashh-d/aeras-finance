"use client";

// Leaving Mag7X and bringing the money back to Solana.
//
// Three legs, each of which can be re-run on its own if the one after it
// fails, because every leg re-reads the chain before it acts:
//
//   1. Liquidate. Glider sells every holding to USDC on Base and delivers it
//      to the user's own embedded EVM wallet. Authorised by one EIP-712
//      signature; Glider pays the gas. The recipient is pinned server-side.
//   2. Gas. The embedded wallet is born with no ETH, and the leg home is a
//      Base transaction it has to sign. A small Solana USDC -> Base ETH leg
//      through Trustware, only when the wallet is short. This is the top-up
//      lib/trustware/base.ts says Base could not have because nothing
//      inbound existed to ride on; a Mag7X exit is that inbound leg.
//   3. Home. lib/trustware/base.ts's return leg, unchanged.
//
// Liquidation is whole-portfolio by construction (Glider's liquidate-all).
// A partial exit is not offered: an in-kind withdrawal of one holding would
// land a Coinbase tokenized stock in the EVM wallet with no route home, the
// exact stranding the wallet panel warns about.

import { BASE_CHAIN_ID, BASE_NATIVE_TOKEN } from "@/lib/base/constants";
import { USDC_MINT } from "@/lib/jupiter/constants";
import {
  fetchTrustwareRouteViaProxy,
} from "@/lib/trustware/client";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
} from "@/lib/trustware/constants";
import { needsBaseGas, sendBaseUsdcToSolana } from "@/lib/trustware/base";
import {
  connectEvmChain,
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type EvmSigner,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import {
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
} from "@/lib/trustware/types";

import {
  fetchBaseBalances,
  prepareGliderLiquidation,
  submitGliderLiquidation,
  waitForGliderOperation,
} from "./client";
import type { BaseBalancesView, GliderOperationView } from "./types";

// What the gas leg spends. Base gas is a fraction of a cent per transaction;
// 2 USDC of ETH covers the approval and the route with a wide margin and
// leaves a residue for the next exit. Above the $0.30 flat route cost so the
// leg is not mostly fee.
export const BASE_GAS_TOPUP_USDC_ATOMIC = 2_000_000n;

const BALANCE_POLL_MS = 5_000;
const ARRIVAL_TIMEOUT_MS = 5 * 60_000;

export type Mag7xExitProgress = { stage: "liquidating" | "gas" | "returning" | "done"; message: string };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled."));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new Error("Cancelled."));
    }, { once: true });
  });
}

// Leg 1. Resolves once Glider reports the sale complete.
export async function liquidateMag7x(args: {
  evm: EvmSigner;
  onProgress?: (p: Mag7xExitProgress) => void;
  signal?: AbortSignal;
}): Promise<{ operationId: string; operation: GliderOperationView | null }> {
  const report = args.onProgress ?? (() => {});
  report({ stage: "liquidating", message: "Preparing the sale with Glider" });
  const prepared = await prepareGliderLiquidation();

  // The typed data names Base in its domain, so the wallet is switched there
  // and the switch read back before signing, as every EVM signature in the
  // app is. Glider verifies the recovered signer against the owner, so a
  // signature on the wrong chain is refused, not misapplied.
  const provider = await connectEvmChain(args.evm, String(BASE_CHAIN_ID));
  report({ stage: "liquidating", message: "Sign to sell every holding to USDC" });
  const signature = (await provider.request({
    method: "eth_signTypedData_v4",
    params: [args.evm.address, JSON.stringify(prepared.typedData)],
  })) as string;
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw new Error("The wallet returned no signature.");
  }

  const message = (prepared.typedData as { message?: unknown }).message;
  const { operationId } = await submitGliderLiquidation(message, signature);
  report({ stage: "liquidating", message: "Glider is selling the holdings" });
  const { operation, timedOut } = await waitForGliderOperation(operationId, {
    signal: args.signal,
    onTick: (op) => report({ stage: "liquidating", message: `Glider is selling the holdings (${op.state.replace("_", " ")})` }),
  });
  if (operation?.state === "failed" || operation?.state === "cancelled") {
    throw new Error(`Glider's sale ${operation.state}${operation.error ? `: ${operation.error}` : ""}. Nothing left the portfolio; try again.`);
  }
  if (timedOut) {
    throw new Error("Glider is still selling the holdings. Wait a minute and press Exit again; the USDC will be picked up from Base once it lands.");
  }
  return { operationId, operation };
}

// Leg 2. Solana USDC -> native ETH on Base, to the embedded wallet.
export async function topUpBaseGas(args: {
  solana: SolanaSigner;
  evmAddress: string;
  onProgress?: (p: Mag7xExitProgress) => void;
  signal?: AbortSignal;
}): Promise<{ txHash: string }> {
  const report = args.onProgress ?? (() => {});
  const request = {
    fromChain: TRUSTWARE_SOLANA_CHAIN,
    toChain: String(BASE_CHAIN_ID),
    fromToken: USDC_MINT,
    toToken: BASE_NATIVE_TOKEN,
    fromAmount: BASE_GAS_TOPUP_USDC_ATOMIC.toString(),
    fromAddress: args.solana.address,
    toAddress: args.evmAddress,
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
    fromAmountUSD: "2",
  } as TrustwareQuoteRequest;

  report({ stage: "gas", message: "Buying a little ETH on Base for gas" });
  const route = await fetchTrustwareRouteViaProxy(request);
  const base64Tx = extractExecution(route)?.transaction?.data;
  const intentId = extractIntentId(route);
  if (!base64Tx || base64Tx.startsWith("0x") || !intentId) {
    throw new Error("Trustware returned no signable transaction for the gas top-up.");
  }
  const txHash = await args.solana.signAndSendBase64(base64Tx);
  await submitTrustwareReceipt(intentId, txHash, args.signal);
  await trackTrustwareSettlement(intentId, args.signal, () => {});
  return { txHash };
}

async function waitForBase(
  predicate: (b: BaseBalancesView) => boolean,
  signal?: AbortSignal,
): Promise<BaseBalancesView> {
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  let last = await fetchBaseBalances(signal);
  while (!predicate(last)) {
    if (Date.now() >= deadline) {
      throw new Error("The funds have not shown up on Base yet. Wait a minute and press Exit again; nothing is lost, the next attempt picks up from where this one stopped.");
    }
    await sleep(BALANCE_POLL_MS, signal);
    last = await fetchBaseBalances(signal);
  }
  return last;
}

// The whole exit. Idempotent across retries: a portfolio already sold skips
// the sale (Glider answers "nothing to liquidate" and the USDC is already in
// the wallet), a wallet already holding gas skips the top-up, and the return
// leg sends whatever USDC is on Base.
export async function exitMag7xToSolana(args: {
  evm: EvmSigner;
  solana: SolanaSigner;
  // True when the portfolio still holds something to sell. False lets a
  // retry skip straight to the legs that move what is already on Base.
  hasHoldings: boolean;
  onProgress?: (p: Mag7xExitProgress) => void;
  signal?: AbortSignal;
}): Promise<{ deliveredAtomic: string | null; returnedAtomic: string }> {
  const report = args.onProgress ?? (() => {});
  const before = await fetchBaseBalances(args.signal);

  if (args.hasHoldings) {
    await liquidateMag7x({ evm: args.evm, onProgress: report, signal: args.signal });
    report({ stage: "liquidating", message: "Waiting for the USDC to land in your Base wallet" });
    await waitForBase((b) => BigInt(b.usdcAtomic) > BigInt(before.usdcAtomic), args.signal);
  }

  let balances = await fetchBaseBalances(args.signal);
  if (BigInt(balances.usdcAtomic) === 0n) {
    throw new Error("There is no USDC on Base to bring home.");
  }

  if (needsBaseGas(balances.ethWei)) {
    await topUpBaseGas({ solana: args.solana, evmAddress: args.evm.address, onProgress: report, signal: args.signal });
    report({ stage: "gas", message: "Waiting for the ETH to land on Base" });
    balances = await waitForBase((b) => !needsBaseGas(b.ethWei), args.signal);
  }

  report({ stage: "returning", message: "Moving the USDC from Base to your Solana wallet" });
  const amount = BigInt(balances.usdcAtomic);
  const { deliveredAtomic } = await sendBaseUsdcToSolana({
    amountAtomic: amount,
    baseUsdcAtomic: balances.usdcAtomic,
    ethBalanceWei: balances.ethWei,
    evm: args.evm,
    solanaAddress: args.solana.address,
    onProgress: (p) => report({ stage: p.stage === "done" ? "done" : "returning", message: p.message }),
    signal: args.signal,
  });
  report({ stage: "done", message: "The USDC is back on Solana." });
  return { deliveredAtomic, returnedAtomic: amount.toString() };
}
