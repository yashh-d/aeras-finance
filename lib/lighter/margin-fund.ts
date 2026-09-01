"use client";

// Posting Lighter margin from whichever wallet holds the USDC.
//
// One entry point, three roads, chosen by the source the user picked:
//
//   solana-cctp   An SPL transfer to Lighter's Solana intent account. No
//                 bridge. lib/lighter/deposit.ts already builds and guards it.
//   arbitrum,     Trustware routes Solana USDC to Lighter's Arbitrum intent
//   Solana source address. The solver performs the destination leg, so the user
//                 signs one Solana transaction, holds no gas on Arbitrum and
//                 never switches networks.
//   arbitrum,     Trustware routes the user's own EVM USDC the same way, but
//   EVM source    the source leg is signed on their chain: an ERC-20 approve
//                 and a bridge, both paid in that chain's native token.
//
// The destination is NEVER caller-supplied. It is fetched here, from Lighter,
// over Lighter's own API, derived from the user's L1 address, and it is
// per-chain: the Arbitrum intent address is not the Base one and not the Solana
// one, and paying one chain's address on another delivers real money to an
// address Lighter is not watching there. The shape is re-checked before the
// route request is built. This mirrors guard 1 in lib/ondo/fund.ts and the same
// guard in lib/lighter/borrow-bridge.ts.
//
// The second guard is the loss bound. A badly priced route does not error, it
// quietly delivers less margin than the user asked for, so anything past
// MAX_MARGIN_LOSS_BPS is refused rather than signed.
//
// A note on retries, learned the expensive way in borrow-bridge.ts: a failure
// BEFORE the signer is handed a transaction costs nothing and the caller may
// take another road. A failure after it means a transaction is in flight whose
// fate is unknown, and the caller must not respond by paying the same margin
// down a second road. The two cases are distinguished by `signed` on the error.

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { uiToAtomic } from "@/lib/trustware/amounts";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import {
  executeEvmRoute,
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type ConversionProgress,
  type EvmSigner,
} from "@/lib/trustware/execute";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "@/lib/trustware/types";

import { buildLighterDepositTransaction } from "./deposit";
import { LIGHTER_INTENT_CHAIN_IDS } from "./constants";
import type { MarginSource } from "./margin-sources";

// Canonical USDC on each chain a margin deposit can be delivered to. Hardcoded
// rather than derived: this is a payment destination, and a wrong address here
// does not error, it delivers real money to a token nobody wanted.
const DESTINATION_USDC: Record<string, string> = {
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

// Slippage asked of the router, in percent. Matches the rest of the app, and is
// the gap between Trustware's expected and guaranteed delivery.
const SLIPPAGE_PCT = 0.3;

// Most a margin leg may give up before it is refused outright. Mirrors
// MAX_FUNDING_LOSS_BPS in lib/lighter/borrow-funding.ts and the same bound in
// lib/ondo/fund.ts. The measured roads sit at 25 to 40 bps, so this leaves
// headroom for a moving auction without ever accepting a route that would
// quietly under-fund the account.
export const MAX_MARGIN_LOSS_BPS = 150;

export class MarginFundError extends Error {
  // True when a transaction was already handed to the signer. The caller must
  // NOT retry down another road: check the chain first.
  readonly signed: boolean;
  constructor(message: string, signed: boolean) {
    super(message);
    this.name = "MarginFundError";
    this.signed = signed;
  }
}

export interface MarginFundResult {
  // Solana signature or EVM tx hash for the source leg.
  sourceTx: string;
  // Present for bridged roads; the CCTP road has no intent.
  intentId?: string;
  destination: MarginSource["destination"];
}

export interface MarginFundArgs {
  source: MarginSource;
  amountUsdc: string;
  // The embedded Solana wallet. Always needed for a Solana source, and it is
  // the address Lighter's Solana intent account is funded from.
  solanaAddress: string | undefined;
  signAndSendSolana: (base64OrBytes: Uint8Array | string) => Promise<string>;
  // The embedded EVM wallet, needed only for an EVM source.
  evm?: EvmSigner;
  // The user's L1 address, which is what Lighter derives every intent address
  // from. This is the account being funded.
  l1Address: string;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
}

export async function fundLighterMargin(
  args: MarginFundArgs,
): Promise<MarginFundResult> {
  const { source, amountUsdc } = args;

  if (source.destination === "solana-cctp") {
    return fundViaSolanaTransfer(args);
  }
  return source.signing === "solana-only"
    ? fundViaSolanaBridge(args)
    : fundViaEvmBridge(args);
}

// ---------------------------------------------------------------------------

// The free road: an SPL transfer straight to Lighter's Solana intent account.
async function fundViaSolanaTransfer(
  args: MarginFundArgs,
): Promise<MarginFundResult> {
  const { solanaAddress, amountUsdc } = args;
  if (!solanaAddress) {
    throw new MarginFundError("No Solana wallet is available.", false);
  }

  const intentAddress = await intentAddressFor(args.l1Address, "solana", args.signal);
  // A Solana intent account is base58. An EVM-shaped value here would mean
  // Lighter answered for the wrong chain, and the transfer would fail rather
  // than misdeliver, but it is caught before anything is built either way.
  if (/^0x[0-9a-fA-F]{40}$/.test(intentAddress)) {
    throw new MarginFundError(
      "Lighter returned an Ethereum-shaped address for the Solana road. Funding is paused.",
      false,
    );
  }

  args.onProgress?.({ stage: "signing", message: "Sending USDC to Lighter." });
  // deposit.ts inspects the destination token account on chain before building,
  // so a missing or wrong-mint intent account throws here rather than being
  // signed away.
  const built = await buildLighterDepositTransaction({
    sender: solanaAddress,
    intentAddress,
    amountUsdc,
  });

  let sourceTx: string;
  try {
    sourceTx = await args.signAndSendSolana(built.transaction);
  } catch (err) {
    throw new MarginFundError(message(err), true);
  }
  args.onProgress?.({ stage: "settled", message: "Sent. Lighter credits this in 15 to 20 minutes." });
  return { sourceTx, destination: "solana-cctp" };
}

// Solana USDC bridged to Lighter's Arbitrum intent address. One Solana
// signature, no gas anywhere else.
//
// prepare-then-sign in a single function on purpose: the route request that is
// validated is the one that gets signed. borrow-bridge.ts documents why asking
// twice stranded a live user, and the same reasoning applies here.
async function fundViaSolanaBridge(
  args: MarginFundArgs,
): Promise<MarginFundResult> {
  const { solanaAddress, amountUsdc } = args;
  if (!solanaAddress) {
    throw new MarginFundError("No Solana wallet is available.", false);
  }

  const request = await buildRouteRequest({
    l1Address: args.l1Address,
    fromChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: USDC_MINT,
    fromAddress: solanaAddress,
    amountUsdc,
    decimals: USDC_DECIMALS,
    signal: args.signal,
  });

  args.onProgress?.({ stage: "routing", message: "Pricing the transfer to Lighter." });
  const routeRes = await postJson<TrustwareQuoteResponse>(
    "/api/trustware/route",
    request,
    args.signal,
  );

  const intentId = extractIntentId(routeRes);
  const transaction = extractExecution(routeRes)?.transaction;
  if (!intentId) {
    throw new MarginFundError("Trustware returned no intent to track.", false);
  }
  if (!transaction?.data) {
    // The relay case: priced, tracked, nothing to sign. Not transient and not
    // retryable at this size. Measured: LI.FI wins to about $100 and relay
    // takes over above it, returning an estimate and no Solana transaction.
    throw new MarginFundError(
      "No bridge would build this transfer at this size right now. " +
        "Try a smaller amount, or use the slower Solana route.",
      false,
    );
  }
  assertLossWithinBound(routeRes, request.fromAmount, USDC_DECIMALS);

  args.onProgress?.({ stage: "signing", message: "Sending USDC to Lighter." });
  let sourceTx: string;
  try {
    sourceTx = await args.signAndSendSolana(transaction.data);
  } catch (err) {
    throw new MarginFundError(message(err), true);
  }

  await afterSourceLeg(intentId, sourceTx, args);
  return { sourceTx, intentId, destination: "arbitrum" };
}

// The user's own EVM USDC bridged to Lighter's Arbitrum intent address.
//
// executeEvmRoute owns the whole source leg: it re-requests the route, grants
// the ERC-20 approval, switches the wallet's active chain, signs, and tracks.
// The floor is passed to it so the guarantee is checked against the FRESH quote
// it signs rather than an earlier one.
async function fundViaEvmBridge(
  args: MarginFundArgs,
): Promise<MarginFundResult> {
  const { source, amountUsdc } = args;
  if (!args.evm) {
    throw new MarginFundError(
      "No Ethereum wallet is available to sign this transfer.",
      false,
    );
  }

  const request = await buildRouteRequest({
    l1Address: args.l1Address,
    fromChain: source.chain,
    fromToken: source.token,
    fromAddress: args.evm.address,
    amountUsdc,
    decimals: source.decimals,
    signal: args.signal,
  });

  // Floor from the planning figure rather than a probe quote: executeEvmRoute
  // compares it against the route it is about to sign, which is the only
  // comparison that protects the user.
  //
  // Rebased to the DESTINATION's decimals, because that is what the floor is
  // compared against. Passing a source-decimal figure would make the guard
  // meaningless the moment an 18-decimal source is added.
  const fromAmount = rebase(BigInt(request.fromAmount), source.decimals);
  const floor =
    fromAmount - (fromAmount * BigInt(MAX_MARGIN_LOSS_BPS)) / 10_000n;

  try {
    const result = await executeEvmRoute({
      request,
      evm: args.evm,
      describe: "USDC",
      minDeliveredAtomic: floor,
      onProgress: args.onProgress,
      signal: args.signal,
    });
    return {
      sourceTx: result.sourceTxHash,
      intentId: result.intentId,
      destination: "arbitrum",
    };
  } catch (err) {
    // executeEvmRoute broadcasts inside itself, so a throw here may or may not
    // have signed. Treated as signed, which is the safe direction: it stops the
    // caller paying the same margin twice.
    throw new MarginFundError(message(err), true);
  }
}

// ---------------------------------------------------------------------------

async function buildRouteRequest(input: {
  l1Address: string;
  fromChain: string;
  fromToken: string;
  fromAddress: string;
  amountUsdc: string;
  decimals: number;
  signal?: AbortSignal;
}): Promise<TrustwareQuoteRequest> {
  const toToken = DESTINATION_USDC.arbitrum;
  const toAddress = await intentAddressFor(input.l1Address, "arbitrum", input.signal);
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
    throw new MarginFundError(
      "Lighter's Arbitrum deposit address is not Ethereum-shaped. Funding is paused.",
      false,
    );
  }
  return {
    fromChain: input.fromChain,
    toChain: String(LIGHTER_INTENT_CHAIN_IDS.arbitrum),
    fromToken: input.fromToken,
    toToken,
    fromAmount: uiToAtomic(input.amountUsdc, input.decimals),
    fromAddress: input.fromAddress,
    toAddress,
    slippage: SLIPPAGE_PCT,
  };
}

// Lighter's intent address for a chain, straight from Lighter via our own
// route. Never from the browser, never from the caller.
async function intentAddressFor(
  l1Address: string,
  chain: "solana" | "arbitrum",
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(
    `/api/lighter/account?l1Address=${encodeURIComponent(l1Address)}` +
      `&intentChain=${chain}`,
    { cache: "no-store", signal },
  );
  const body = (await res.json()) as { depositAddress?: string; error?: string };
  if (!res.ok || !body.depositAddress) {
    throw new MarginFundError(
      body.error ?? `Could not get Lighter's ${chain} deposit address.`,
      false,
    );
  }
  return body.depositAddress;
}

// Destination USDC is 6 decimals on every chain LIGHTER_MARGIN_DESTINATIONS
// lists. Named rather than inlined because the comparison below is only valid
// once both sides are on the same scale.
const DESTINATION_DECIMALS = 6;

// Both sides rebased to whole USDC-hundredths before comparing.
//
// Comparing raw atomic amounts is WRONG whenever the source and destination
// decimals differ, and it fails in the dangerous direction: 20 USDC of an
// 18-decimal source against a 6-decimal destination reads as a 99.99% loss, so
// a guard written that way refuses good routes, and the inverse pairing would
// wave through a terrible one. The check script caught this on BNB Chain, whose
// USDC is 18 decimals. Every source shipped today is 6, so this is defensive,
// but it is the kind of defence that has to exist before the case arrives.
function rebase(atomic: bigint, decimals: number): bigint {
  const scale = 10n ** BigInt(Math.abs(decimals - DESTINATION_DECIMALS));
  return decimals > DESTINATION_DECIMALS ? atomic / scale : atomic * scale;
}

function assertLossWithinBound(
  routeRes: TrustwareQuoteResponse,
  fromAmount: string,
  fromDecimals: number,
): void {
  const estimate = extractEstimate(routeRes);
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
  if (!guaranteed) return;

  const from = rebase(BigInt(fromAmount), fromDecimals);
  if (from <= 0n) return;
  const lossBps = ((from - BigInt(guaranteed)) * 10_000n) / from;
  if (lossBps > BigInt(MAX_MARGIN_LOSS_BPS)) {
    throw new MarginFundError(
      `This route gives up ${lossBps} bps, past the ${MAX_MARGIN_LOSS_BPS} bps a margin deposit accepts.`,
      false,
    );
  }
  if (BigInt(guaranteed) < from / 2n) {
    // A guarantee this far below the input is a malformed quote rather than a
    // bad price, and signing it would deliver a fraction of the margin.
    throw new MarginFundError(
      "Trustware returned an implausible quote. Funding is paused.",
      false,
    );
  }
}

// Receipt and tracking are best-effort: the money has moved, and failing to
// track it does not un-move it. The caller's Lighter credit poll is the real
// confirmation either way.
async function afterSourceLeg(
  intentId: string,
  sourceTx: string,
  args: MarginFundArgs,
): Promise<void> {
  args.onProgress?.({ stage: "tracking", message: "Tracking the transfer." });
  await submitTrustwareReceipt(intentId, sourceTx, args.signal).catch((err) =>
    console.error("[margin-fund receipt]", err),
  );
  void trackTrustwareSettlement(intentId, args.signal, (status) =>
    console.info("[margin-fund settlement]", status.data?.status),
  ).catch((err) => console.error("[margin-fund settlement]", err));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
    throw new MarginFundError(
      text || `Request to ${path} failed (${res.status}).`,
      false,
    );
  }
  return (await res.json()) as T;
}
