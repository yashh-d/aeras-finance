"use client";

// Funding a Mag7X portfolio from the wallet's Solana USDC.
//
// The deposit is a Trustware route from Solana USDC to USDC on Base,
// delivered straight to the Glider smart account rather than to the user's
// own EVM wallet. That is the Ondo-margin pattern (lib/ondo/fund.ts) and it
// is chosen for the same reason: one Solana signature, no ETH, no chain
// switch. Delivering to the embedded wallet first would need a Base ERC-20
// transfer from a wallet born with no ETH, a gas top-up leg, and a second
// signature, to arrive at the same place.
//
// What that costs is recoverability, and here the cost is smaller than on
// Ondo: the smart account is the user's own (their EOA owns it), and a
// deposit that never becomes holdings is still USDC they can liquidate out.
// The destination is still verified server-side before a route is built,
// because the proxy hands back a signable transaction and a page script
// naming its own address would otherwise have a drain (see the note in
// app/api/trustware/route/route.ts).
//
// After settlement the app asks Glider for a rebalance, which is what turns
// the USDC into the eight holdings. Glider's scheduler would do it within a
// day anyway; asking makes it minutes.

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/base/constants";
import { atomicToUi, toNumberOrNull } from "@/lib/trustware/amounts";
import {
  fetchTrustwareQuoteViaProxy,
  fetchTrustwareRouteViaProxy,
} from "@/lib/trustware/client";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
} from "@/lib/trustware/constants";
import {
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "@/lib/trustware/types";

import { requestGliderRebalance, waitForGliderOperation } from "./client";
import {
  GLIDER_STRATEGY_NAME,
  MAG7X_MIN_DEPOSIT_USD,
  MAG7X_SMALL_DEPOSIT_USD,
} from "./constants";
import type { GliderOperationView, GliderRebalanceResult } from "./types";

export type { SolanaSigner } from "@/lib/trustware/execute";

export type QuoteFn = (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;

// Refuse a route that delivers less than 97% of the USDC put in. The Base
// route was measured at about $0.30 flat (lib/trustware/base.ts), so at the
// $20 minimum this is a 1.5% cost and at $100 it is 0.3%; anything past 3%
// is a broken route, not a fee.
export const MAX_DEPOSIT_LOSS_BPS = 300;

export type Mag7xDepositPlan =
  | { kind: "blocked"; reason: string }
  | {
      kind: "ready";
      request: TrustwareQuoteRequest;
      portfolioId: string;
      smartAccount: string;
      amountAtomic: bigint;
      amountUsd: number;
      deliveredAtomic: string;
      deliveredMinAtomic: string;
      deliveredUsd: number;
      lossBps: number;
      feesUsd: number | null;
      // Copy for the ticket when the deposit is small enough that the flat
      // route cost is worth stating.
      warning: string | null;
    };

function usdcRequest(args: {
  amountAtomic: bigint;
  solanaAddress: string;
  smartAccount: string;
}): TrustwareQuoteRequest {
  const amountUsd = Number(atomicToUi(args.amountAtomic.toString(), USDC_DECIMALS));
  return {
    fromChain: TRUSTWARE_SOLANA_CHAIN,
    toChain: String(BASE_CHAIN_ID),
    fromToken: USDC_MINT,
    toToken: BASE_USDC.address,
    fromAmount: args.amountAtomic.toString(),
    fromAddress: args.solanaAddress,
    // The Glider smart account. One of the shapes the proxy does not
    // overwrite, so it names itself; the proxy then checks the address with
    // Glider before building anything.
    toAddress: args.smartAccount,
    intent: "glider-deposit",
    // Crosses a bridge, so it keeps Trustware's default tolerance.
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
    // Trustware wants a USD hint on a Solana-sourced quote. It decides
    // nothing about what is delivered.
    ...({ fromAmountUSD: String(amountUsd) } as Record<string, string>),
  } as TrustwareQuoteRequest;
}

export async function planMag7xDeposit(args: {
  amountAtomic: bigint;
  solanaAddress: string;
  solanaUsdcAtomic: string;
  portfolio: { portfolioId: string; smartAccount: string };
  fetchQuote?: QuoteFn;
}): Promise<Mag7xDepositPlan> {
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;
  const { amountAtomic } = args;
  const amountUsd = Number(atomicToUi(amountAtomic.toString(), USDC_DECIMALS));

  if (amountAtomic <= 0n) return { kind: "blocked", reason: "Enter an amount above zero." };
  if (amountUsd < MAG7X_MIN_DEPOSIT_USD) {
    return {
      kind: "blocked",
      reason: `The minimum deposit is $${MAG7X_MIN_DEPOSIT_USD}. Below that the route's flat cost and Glider's $1-per-holding swap floor eat too much of it.`,
    };
  }
  if (amountAtomic > BigInt(args.solanaUsdcAtomic || "0")) {
    return { kind: "blocked", reason: "Amount is above the wallet's USDC balance." };
  }

  const request = usdcRequest({
    amountAtomic,
    solanaAddress: args.solanaAddress,
    smartAccount: args.portfolio.smartAccount,
  });

  let estimate;
  try {
    estimate = extractEstimate(await fetchQuote(request));
  } catch (err) {
    return {
      kind: "blocked",
      reason: `Could not price this deposit. ${err instanceof Error ? err.message : "Try again shortly."}`,
    };
  }
  if (!estimate?.toAmount) {
    return { kind: "blocked", reason: "No route from Solana USDC to Base right now." };
  }

  const deliveredAtomic = estimate.toAmount;
  const deliveredMinAtomic =
    estimate.toAmountMin ??
    (
      (BigInt(deliveredAtomic) *
        BigInt(Math.round((100 - TRUSTWARE_DEFAULT_SLIPPAGE) * 100))) /
      10_000n
    ).toString();
  // USDC to USDC, so the loss is a plain difference of atomic amounts and
  // needs no price.
  const deliveredUsd = Number(atomicToUi(deliveredMinAtomic, BASE_USDC.decimals));
  const lossBps = Math.round(((amountUsd - deliveredUsd) / amountUsd) * 10_000);
  if (lossBps > MAX_DEPOSIT_LOSS_BPS) {
    return {
      kind: "blocked",
      reason: `This route would deliver about $${deliveredUsd.toFixed(2)} of $${amountUsd.toFixed(2)}, a ${(lossBps / 100).toFixed(1)}% loss. That is a broken route, not a fee. Refusing to send it.`,
    };
  }

  return {
    kind: "ready",
    request,
    portfolioId: args.portfolio.portfolioId,
    smartAccount: args.portfolio.smartAccount,
    amountAtomic,
    amountUsd,
    deliveredAtomic,
    deliveredMinAtomic,
    deliveredUsd,
    lossBps,
    feesUsd: toNumberOrNull(estimate.totalFeesUsd),
    warning:
      amountUsd < MAG7X_SMALL_DEPOSIT_USD
        ? `The Base route costs about $${(amountUsd - deliveredUsd).toFixed(2)} on this amount, which is ${(lossBps / 100).toFixed(1)}% of it. Larger deposits lose a smaller share.`
        : null,
  };
}

export type Mag7xDepositProgress =
  | { stage: "routing"; message: string }
  | { stage: "signing"; message: string }
  | { stage: "bridging"; message: string; txHash: string }
  | { stage: "rebalancing"; message: string }
  | { stage: "done"; message: string; txHash: string };

export interface Mag7xDepositResult {
  txHash: string;
  deliveredAtomic: string | null;
  rebalance: GliderRebalanceResult;
  operation: GliderOperationView | null;
  // True when the deposit landed but Glider had not finished buying the
  // holdings by the time the app stopped watching. Not a failure.
  rebalancePending: boolean;
}

export async function executeMag7xDeposit(args: {
  plan: Extract<Mag7xDepositPlan, { kind: "ready" }>;
  solana: SolanaSigner;
  onProgress?: (p: Mag7xDepositProgress) => void;
  signal?: AbortSignal;
}): Promise<Mag7xDepositResult> {
  const { plan, solana } = args;
  const report = args.onProgress ?? (() => {});

  report({ stage: "routing", message: "Preparing the move to Base" });
  const route = await fetchTrustwareRouteViaProxy(plan.request);
  const execution = extractExecution(route);
  const intentId = extractIntentId(route);
  const base64Tx = execution?.transaction?.data;
  if (!base64Tx || base64Tx.startsWith("0x") || !intentId) {
    throw new Error("Trustware returned no signable Solana transaction for this deposit.");
  }
  // Last free abort point: the fresh route must still clear the priced floor.
  const estimate = extractEstimate(route);
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
  if (guaranteed && BigInt(guaranteed) < BigInt(plan.deliveredMinAtomic)) {
    throw new Error("The rate moved and the route no longer delivers what was quoted. Try again for a fresh quote.");
  }

  report({ stage: "signing", message: `Sending ${plan.amountUsd.toFixed(2)} USDC from your Solana wallet` });
  const txHash = await solana.signAndSendBase64(base64Tx);
  report({ stage: "bridging", message: "Waiting for the USDC to arrive on Base", txHash });
  await submitTrustwareReceipt(intentId, txHash, args.signal);
  const status = await trackTrustwareSettlement(intentId, args.signal, () => {});
  const deliveredAtomic = status.data?.to_amount_wei ?? null;

  report({ stage: "rebalancing", message: `Asking Glider to buy the ${GLIDER_STRATEGY_NAME} holdings` });
  let rebalance: GliderRebalanceResult;
  try {
    rebalance = await requestGliderRebalance();
  } catch (err) {
    // The deposit is in the smart account either way; the scheduler runs
    // daily. Report rather than fail a step whose money already landed.
    rebalance = { operationId: null, retryAfterSeconds: null };
    report({
      stage: "rebalancing",
      message: `The deposit landed. Glider will buy the holdings at its next scheduled rebalance (${err instanceof Error ? err.message : "manual trigger unavailable"}).`,
    });
  }
  let operation: GliderOperationView | null = null;
  let rebalancePending = rebalance.operationId == null;
  if (rebalance.operationId) {
    const waited = await waitForGliderOperation(rebalance.operationId, {
      signal: args.signal,
      onTick: (op) =>
        report({ stage: "rebalancing", message: `Glider is buying the holdings (${op.state.replace("_", " ")})` }),
    });
    operation = waited.operation;
    rebalancePending = waited.timedOut || operation?.state !== "completed";
    if (operation?.state === "failed" || operation?.state === "cancelled") {
      throw new Error(
        `Your USDC is in the Mag7X account, but Glider's rebalance ${operation.state}${operation.error ? `: ${operation.error}` : ""}. It will retry at the next scheduled run, or press Buy holdings now.`,
      );
    }
  }
  report({
    stage: "done",
    message: rebalancePending
      ? "Deposit landed. Glider is still buying the holdings; the position will show them shortly."
      : `Deposited into ${GLIDER_STRATEGY_NAME}.`,
    txHash,
  });
  return { txHash, deliveredAtomic, rebalance, operation, rebalancePending };
}
