"use client";

// The Trustware leg of a borrow-funded hedge: Solana USDC to Lighter's deposit
// address on an EVM chain.
//
// Deliver-direct, the same shape lib/ondo/fund.ts uses. Trustware's solver
// performs the destination leg, so the user signs one Solana transaction and
// never holds gas on the far chain, never switches networks, and never touches
// the embedded EVM wallet.
//
// The API here is prepare-then-finish, split deliberately and with a history.
// Whether Trustware hands back a signable transaction depends on which bridge
// provider wins its price auction for this exact size at this exact moment, and
// the first version of this flow asked twice: a probe before the borrow, then a
// fresh route request at pay time. The auction flipped between the two asks, the
// pay-time request came back unsignable, and a live user was left holding open
// debt with no hedge. One request, one answer: prepare() makes the only route
// request and runs every guard, and the transaction it validates is the very
// transaction finish() signs. A prepare() failure costs nothing and the caller
// falls back to another road; a finish() failure is a signed transaction whose
// fate must be checked, never silently retried elsewhere.
//
// Two guards, both money-critical:
//
//   1. The destination is never caller-supplied. It comes from Lighter, over
//      Lighter's own API, derived from the user's L1 address, and it is
//      per-chain: the Base intent address is not the Arbitrum one, and paying
//      one chain's address on another chain delivers real money to an address
//      Lighter is not watching there. Callers fetch the address for the road
//      they are paying, and the shape is re-checked here before anything else.
//   2. The guaranteed delivery is bounded. A route that prices badly does not
//      error, it quietly under-hedges, so it is refused instead.

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import {
  submitTrustwareReceipt,
  trackTrustwareSettlement,
} from "@/lib/trustware/execute";
import { uiToAtomic } from "@/lib/trustware/amounts";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  type TrustwareQuoteResponse,
} from "@/lib/trustware/types";

import {
  intentChainId,
  destinationShapeMatches,
  MAX_FUNDING_LOSS_BPS,
  type FundingRoute,
} from "./borrow-funding";

// Canonical USDC on each chain a bridge road can deliver to. Hardcoded rather
// than derived, because this is a payment destination: a wrong address here does
// not error, it delivers real money to a token nobody wanted.
const DESTINATION_USDC: Record<string, string> = {
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

// Slippage asked of the router, in percent. Matches what the rest of the app
// requests, and is the gap between Trustware's expected and guaranteed delivery.
const SLIPPAGE_PCT = 0.3;

export interface PreparedBridge {
  route: FundingRoute;
  // Base64 Solana transaction, exactly as Trustware returned it. Signing this
  // and nothing else is the point of the prepare/finish split.
  transactionBase64: string;
  intentId: string;
  // Guaranteed delivery in USDC base units, when the estimate carried one.
  guaranteedAtomic: string | null;
  toAddress: string;
}

// Make the one route request and run every guard. Throws with a readable reason
// when the road cannot be paid; nothing is signed and failure costs nothing.
export async function prepareSolanaBridge(args: {
  route: FundingRoute;
  amountUsdc: number;
  fromAddress: string;
  // Lighter's deposit address on route.deliversOn, and no other chain's.
  toAddress: string;
  signal?: AbortSignal;
}): Promise<PreparedBridge> {
  const { route, amountUsdc, fromAddress, toAddress } = args;

  const toToken = DESTINATION_USDC[route.deliversOn];
  const chainId = intentChainId(route);
  if (!toToken || chainId == null) {
    throw new Error(`No route is configured for ${route.label}.`);
  }
  if (!destinationShapeMatches(route, toAddress)) {
    throw new Error(
      `Lighter's deposit address is not shaped for ${route.label}. Funding is paused.`,
    );
  }

  const fromAmount = uiToAtomic(String(amountUsdc), USDC_DECIMALS);

  const routeRes = await postJson<TrustwareQuoteResponse>(
    "/api/trustware/route",
    {
      fromChain: TRUSTWARE_SOLANA_CHAIN,
      toChain: String(chainId),
      fromToken: USDC_MINT,
      toToken,
      fromAmount,
      fromAddress,
      toAddress,
      slippage: SLIPPAGE_PCT,
    },
    args.signal,
  );

  const intentId = extractIntentId(routeRes);
  const transaction = extractExecution(routeRes)?.transaction;

  if (!intentId) throw new Error("Trustware returned no intent to track.");
  if (!transaction?.data) {
    // The relay case: priced, tracked, nothing to sign. Not transient and not
    // retryable at this size; the caller's job is to take a different road.
    throw new Error(
      `Trustware priced the ${route.label} transfer but returned nothing to sign at this size.`,
    );
  }

  const estimate = extractEstimate(routeRes);
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount ?? null;
  if (guaranteed) {
    const lossBps =
      ((BigInt(fromAmount) - BigInt(guaranteed)) * 10_000n) / BigInt(fromAmount);
    if (lossBps > BigInt(MAX_FUNDING_LOSS_BPS)) {
      throw new Error(
        `The ${route.label} route gives up ${lossBps} bps, past the ${MAX_FUNDING_LOSS_BPS} bps this hedge accepts.`,
      );
    }
    if (BigInt(guaranteed) < BigInt(fromAmount) / 2n) {
      // A guarantee this far below the input is a malformed quote rather than a
      // bad price, and signing it would deliver a fraction of the margin.
      throw new Error("Trustware returned an implausible quote. Funding is paused.");
    }
  }

  return {
    route,
    transactionBase64: transaction.data,
    intentId,
    guaranteedAtomic: guaranteed,
    toAddress,
  };
}

// Sign and broadcast what prepare() validated, then report the receipt and track
// settlement. Returns the Solana signature.
//
// Any throw from here means a transaction was HANDED TO THE SIGNER: its fate is
// unknown until checked on chain, and the caller must not respond by paying the
// same margin down another road.
export async function finishSolanaBridge(args: {
  prepared: PreparedBridge;
  signAndSendBase64: (base64Tx: string) => Promise<string>;
  signal?: AbortSignal;
}): Promise<string> {
  const { prepared } = args;

  const signature = await args.signAndSendBase64(prepared.transactionBase64);

  // Receipt and tracking are best-effort from here. The money has moved; failing
  // to track it does not un-move it, and the caller's credit poll against
  // Lighter is the real confirmation either way.
  await submitTrustwareReceipt(prepared.intentId, signature, args.signal).catch(
    (err) => console.error("[borrow-bridge receipt]", err),
  );
  void trackTrustwareSettlement(prepared.intentId, args.signal, (status) =>
    console.info("[borrow-bridge settlement]", status.data?.status),
  ).catch((err) => console.error("[borrow-bridge settlement]", err));

  return signature;
}

async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request to ${path} failed (${res.status}).`);
  }
  return (await res.json()) as T;
}
