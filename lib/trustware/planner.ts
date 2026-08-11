// Conversion planner.
//
// Decides what has to happen before a Jupiter Lend collateral deposit can go
// through. The user asks to deposit N units of a vault's collateral xStock; this
// works out whether they already hold it on Solana (deposit directly), whether
// they hold the same underlying equity on another chain (convert first, then
// deposit), or whether neither is true.
//
// This module is read-only. It moves no funds and signs nothing: it reads
// balances that were passed in and prices the conversion through the
// /api/trustware/quote proxy so the API key stays server-side. Execution is a
// separate step.

import type { XStockBorrowVault } from "@/lib/jupiter/borrow";
import { quoteSolanaConversion } from "@/lib/jupiter/convert";
import {
  addBps,
  atomicToUi,
  rescaleAtomic,
  toNumberOrNull,
  uiToAtomic,
} from "./amounts";
import { fetchTrustwareQuoteViaProxy } from "./client";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
  TRUSTWARE_SOLANA_SLIPPAGE,
} from "./constants";
import { sourcesForVaultId, type EquivalentSource } from "./equivalents";
import {
  extractEstimate,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "./types";

type QuoteFn = (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;

// Prices one Solana-to-Solana leg. Injectable so offline checks can exercise the
// sizing maths without reaching Jupiter.
export type SolanaQuoteFn = (args: {
  source: EquivalentSource;
  vault: XStockBorrowVault;
  fromAmountAtomic: string;
  taker: string;
}) => Promise<ConversionQuote>;

// Headroom added on top of the quoted rate when sizing the source amount. The
// quote is a point-in-time estimate and the rate can drift between planning and
// execution; without headroom a drift of a few basis points lands us just under
// the requested collateral and the deposit has to be resized. 1.5% comfortably
// covers observed drift on the Mayan and Relay routes.
export const CONVERSION_HEADROOM_BPS = 150;

// A source-chain holding the user actually has. Balances are supplied by the
// caller (slice 4b reads them from the EVM chains) so the planner stays free of
// network access other than the quote.
export interface HeldEquivalent {
  source: EquivalentSource;
  // Atomic units at source.decimals.
  balanceAtomic: string;
}

export interface ConversionQuote {
  // Atomic source units to send, at source.decimals.
  fromAmountAtomic: string;
  // Atomic destination units Trustware expects to deliver, at 8 decimals.
  toAmountAtomic: string;
  // Guaranteed floor after slippage. The planner sizes against this, not the
  // optimistic toAmount.
  toAmountMinAtomic: string;
  fromAmountUsd: number | null;
  toAmountUsd: number | null;
  totalFeesUsd: number | null;
  // End-to-end value lost as a fraction, e.g. 0.009 = 0.9%. Taken from the USD
  // legs when the quote carries both, otherwise from 1:1 unit parity.
  lossFraction: number | null;
  slippagePct: number;
}

export interface DirectDepositPlan {
  kind: "direct-deposit";
  vault: XStockBorrowVault;
  // Atomic collateral units to deposit, at vault.collateralDecimals.
  depositAtomic: string;
}

export interface ConvertThenDepositPlan {
  kind: "convert-then-deposit";
  vault: XStockBorrowVault;
  depositAtomic: string;
  // What the Solana wallet is missing and the conversion has to deliver.
  shortfallAtomic: string;
  source: EquivalentSource;
  // Atomic source units to convert, at source.decimals.
  sourceAmountAtomic: string;
  quote: ConversionQuote;
}

// Nothing to do, or nothing we can do. `reason` is user-facing copy.
export interface BlockedPlan {
  kind: "insufficient" | "unavailable";
  vault: XStockBorrowVault;
  reason: string;
}

export type ConversionPlan =
  | DirectDepositPlan
  | ConvertThenDepositPlan
  | BlockedPlan;

export interface PlanInput {
  vault: XStockBorrowVault;
  // What the user typed into the collateral field.
  requestedUi: string | number;
  // Destination. Also the recipient of any conversion.
  solanaAddress: string;
  // Signer for EVM sources only. A Solana source signs with the Solana wallet,
  // so this may be undefined and the plan still succeeds.
  evmAddress: string | undefined;
  // Current balance of vault.collateralMint in the user's Solana ATA, atomic.
  solanaCollateralAtomic: string;
  // Same-underlying holdings, on other chains or on Solana itself (Ondo issues
  // these equities natively on Solana, and those are not vault collateral).
  heldEquivalents: HeldEquivalent[];
  slippagePct?: number;
  // Override the quote transport. The default hits our proxy on a relative path,
  // which only resolves in the browser; scripts and tests pass an absolute-URL
  // fetcher instead. Never point this at Trustware directly from the client.
  fetchQuote?: (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;
  // Override the Solana-to-Solana pricing engine. Defaults to Jupiter; offline
  // checks stub it so the sizing maths runs without a network.
  quoteSolana?: SolanaQuoteFn;
}

function blocked(
  vault: XStockBorrowVault,
  kind: BlockedPlan["kind"],
  reason: string,
): BlockedPlan {
  return { kind, vault, reason };
}

// Rough margin over the 1:1 notional a balance needs before we treat it as
// likely to cover the shortfall. Only used for ranking; the real test is the
// solved amount from the live quote.
const COVERAGE_MARGIN_BPS = 500;

// Deterministic pick when the user holds the same equity in several places.
// Ordering, in priority order:
//   1. Balances that plausibly cover the shortfall, ahead of ones that cannot.
//   2. Solana sources ahead of EVM ones. A Solana-to-Solana conversion never
//      touches a bridge, so it avoids the latency and the stuck-in-flight
//      failure mode entirely, even when the headline fee is similar.
//   3. Larger balance, then chain, then symbol, purely for determinism.
// We never split a conversion across two sources: two routes means two sets of
// fees and two ways to fail.
function rankCandidates(
  candidates: HeldEquivalent[],
  shortfallAtomic: string,
  destDecimals: number,
): HeldEquivalent[] {
  const covers = (h: HeldEquivalent): boolean => {
    const notional = BigInt(
      rescaleAtomic(h.balanceAtomic, h.source.decimals, destDecimals),
    );
    return notional >= BigInt(addBps(shortfallAtomic, COVERAGE_MARGIN_BPS));
  };
  return [...candidates].sort((a, b) => {
    const ac = covers(a);
    const bc = covers(b);
    if (ac !== bc) return ac ? -1 : 1;
    const asol = a.source.kind === "solana";
    const bsol = b.source.kind === "solana";
    if (asol !== bsol) return asol ? -1 : 1;
    const av = BigInt(a.balanceAtomic);
    const bv = BigInt(b.balanceAtomic);
    if (av !== bv) return av > bv ? -1 : 1;
    if (a.source.chain !== b.source.chain) {
      return a.source.chain.localeCompare(b.source.chain);
    }
    return a.source.symbol.localeCompare(b.source.symbol);
  });
}

function quoteRequest(
  source: EquivalentSource,
  vault: XStockBorrowVault,
  fromAmountAtomic: string,
  fromAddress: string,
  solanaAddress: string,
  slippagePct: number,
): TrustwareQuoteRequest {
  return {
    fromChain: source.chain,
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: source.token,
    toToken: vault.collateralMint,
    fromAmount: fromAmountAtomic,
    fromAddress,
    toAddress: solanaAddress,
    slippage: slippagePct,
  };
}

// Price a Solana-to-Solana conversion through Jupiter.
//
// Trustware cannot execute this case: its /route picks a provider per request,
// and a `relay` selection returns no signable transaction. See
// lib/jupiter/convert.ts and scripts/trustware-solana-route-check.mts. Cross
// chain sources are untouched and still price through Trustware below.
export const priceSolanaConversion: SolanaQuoteFn = async ({
  source,
  vault,
  fromAmountAtomic,
}) => {
  const quote = await quoteSolanaConversion({
    inputMint: source.token,
    inputDecimals: source.decimals,
    outputMint: vault.collateralMint,
    outputDecimals: vault.collateralDecimals,
    amountAtomic: fromAmountAtomic,
  });
  return {
    fromAmountAtomic: quote.fromAmountAtomic,
    toAmountAtomic: quote.toAmountAtomic,
    toAmountMinAtomic: quote.toAmountMinAtomic,
    fromAmountUsd: quote.fromAmountUsd,
    toAmountUsd: quote.toAmountUsd,
    // The classic swap quote prices in token units, not USD. The loss
    // fraction below carries the real cost; inventing a USD figure here
    // would be a guess.
    totalFeesUsd: null,
    lossFraction: quote.lossFraction,
    slippagePct: quote.slippagePct,
  };
};

// Price one leg with whichever engine the route needs. Solana-to-Solana goes to
// Jupiter, everything cross-chain stays on Trustware.
async function priceLeg(args: {
  source: EquivalentSource;
  vault: XStockBorrowVault;
  fromAmountAtomic: string;
  fromAddress: string;
  solanaAddress: string;
  slippagePct: number;
  fetchQuote: QuoteFn;
  quoteSolana: SolanaQuoteFn;
}): Promise<ConversionQuote> {
  const { source, vault, fromAmountAtomic } = args;
  if (source.kind === "solana") {
    return args.quoteSolana({
      source,
      vault,
      fromAmountAtomic,
      taker: args.solanaAddress,
    });
  }
  return priceConversion(
    quoteRequest(
      source,
      vault,
      fromAmountAtomic,
      args.fromAddress,
      args.solanaAddress,
      args.slippagePct,
    ),
    args.slippagePct,
    args.fetchQuote,
    source.decimals,
    vault.collateralDecimals,
  );
}

async function priceConversion(
  req: TrustwareQuoteRequest,
  slippagePct: number,
  fetchQuote: QuoteFn,
  fromDecimals: number,
  toDecimals: number,
): Promise<ConversionQuote> {
  const res = await fetchQuote(req);
  const estimate = extractEstimate(res);
  if (!estimate?.toAmount) {
    throw new Error("Trustware returned no estimate for this conversion.");
  }
  const toAmountAtomic = estimate.toAmount;
  // Not every route echoes a minimum. Falling back to toAmount would let us size
  // against an optimistic number, so derive a floor from the slippage instead.
  const toAmountMinAtomic =
    estimate.toAmountMin ??
    (
      (BigInt(toAmountAtomic) * BigInt(Math.round((100 - slippagePct) * 100))) /
      10_000n
    ).toString();

  const fromAmountUsd = toNumberOrNull(estimate.fromAmountUsd);
  const toAmountUsd = toNumberOrNull(estimate.toAmountUsd);

  // Live Trustware payloads frequently omit fromAmountUsd (observed on the
  // Mayan route), which left the USD-difference calculation null and would have
  // rendered "0% loss" next to a real fee. Fall back to comparing units: the
  // registry only holds strict 1:1 equivalents of the same underlying, so one
  // source token is one destination token and any shortfall between them is
  // exactly the round-trip cost. This is the more reliable measure of the two.
  let lossFraction: number | null = null;
  if (fromAmountUsd && toAmountUsd && fromAmountUsd > 0) {
    lossFraction = (fromAmountUsd - toAmountUsd) / fromAmountUsd;
  } else {
    const notional = BigInt(
      rescaleAtomic(req.fromAmount, fromDecimals, toDecimals),
    );
    if (notional > 0n) {
      const lost = notional - BigInt(toAmountAtomic);
      lossFraction = Number(lost) / Number(notional);
    }
  }

  return {
    fromAmountAtomic: req.fromAmount,
    toAmountAtomic,
    toAmountMinAtomic,
    fromAmountUsd,
    toAmountUsd,
    totalFeesUsd: toNumberOrNull(estimate.totalFeesUsd),
    lossFraction,
    slippagePct,
  };
}

export async function planCollateralDeposit(
  input: PlanInput,
): Promise<ConversionPlan> {
  const {
    vault,
    requestedUi,
    solanaAddress,
    evmAddress,
    solanaCollateralAtomic,
    heldEquivalents,
  } = input;
  // Left undefined so each candidate can take the tolerance its route deserves.
  // An explicit caller value still overrides both.
  const slippagePct = input.slippagePct;
  const fetchQuote = input.fetchQuote ?? fetchTrustwareQuoteViaProxy;
  const quoteSolana = input.quoteSolana ?? priceSolanaConversion;
  const decimals = vault.collateralDecimals;

  let requested: bigint;
  try {
    requested = BigInt(uiToAtomic(requestedUi, decimals));
  } catch {
    return blocked(vault, "insufficient", "Enter a valid amount.");
  }
  if (requested <= 0n) {
    return blocked(vault, "insufficient", "Enter an amount above zero.");
  }

  const onSolana = BigInt(solanaCollateralAtomic || "0");

  // The common case: they already hold the collateral. No Trustware involved.
  if (onSolana >= requested) {
    return {
      kind: "direct-deposit",
      vault,
      depositAtomic: requested.toString(),
    };
  }

  const shortfall = requested - onSolana;
  const shortfallUi = atomicToUi(shortfall.toString(), decimals);

  // Only tokens registered as 1:1 equivalents of this vault's collateral are
  // convertible. Anything else the user happens to hold is not the same asset.
  const eligible = sourcesForVaultId(vault.vaultId);
  const candidates = heldEquivalents.filter(
    (h) =>
      BigInt(h.balanceAtomic) > 0n &&
      eligible.some(
        (e) => e.chain === h.source.chain && e.token === h.source.token,
      ),
  );

  if (candidates.length === 0) {
    return blocked(
      vault,
      "insufficient",
      `You need ${shortfallUi} more ${vault.collateralSymbol}. No equivalent holding was found to convert.`,
    );
  }

  // Try each candidate in ranked order rather than committing to the best one.
  // A listed token is not a routable one: chains go under maintenance (BNB Chain
  // was, as of 2026-08-05), and a user holding the same equity on two chains
  // should not be blocked because the higher-ranked chain happens to be down.
  //
  // If none of them work, report the BEST-ranked failure, not the last one. The
  // top candidate is the route the user would actually have taken, so its reason
  // is the actionable one. Reporting the last would explain why some fallback
  // chain they never chose was unavailable.
  const ranked = rankCandidates(candidates, shortfall.toString(), decimals);
  let bestBlock: BlockedPlan | null = null;
  for (const candidate of ranked) {
    const attempt = await planFromCandidate({
      candidate,
      vault,
      requested,
      shortfall,
      shortfallUi,
      decimals,
      solanaAddress,
      evmAddress,
      slippagePct,
      fetchQuote,
      quoteSolana,
    });
    if (attempt.kind === "convert-then-deposit") return attempt;
    bestBlock ??= attempt;
  }
  return (
    bestBlock ??
    blocked(vault, "insufficient", `You need ${shortfallUi} more ${vault.collateralSymbol}.`)
  );
}

// Price spending one source's entire balance.
//
// The sequencing layer needs this when no single source can cover what is left:
// a holding of N source tokens delivers less than N after fees, so assuming par
// would size a leg the source cannot actually fund. This asks the route what the
// whole balance is really worth, which is the only honest answer.
//
// Returns the priced leg, or the reason this source cannot serve one.
export async function quoteSpendAll(args: {
  candidate: HeldEquivalent;
  vault: XStockBorrowVault;
  solanaAddress: string;
  evmAddress: string | undefined;
  slippagePct?: number;
  fetchQuote?: QuoteFn;
  quoteSolana?: SolanaQuoteFn;
}): Promise<
  { sourceAmountAtomic: string; quote: ConversionQuote } | BlockedPlan
> {
  const { candidate, vault, solanaAddress, evmAddress } = args;
  const { source } = candidate;
  const slippagePct = args.slippagePct ?? slippageFor(source);
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;

  const fromAddress = source.kind === "solana" ? solanaAddress : evmAddress;
  if (!fromAddress) {
    return blocked(
      vault,
      "unavailable",
      "No wallet is available to sign on the source chain.",
    );
  }

  const balance = BigInt(candidate.balanceAtomic);
  if (balance <= 0n) {
    return blocked(
      vault,
      "insufficient",
      `Your ${source.symbol} balance on ${source.chainLabel} is too small to convert.`,
    );
  }

  try {
    const quote = await priceLeg({
      source,
      vault,
      fromAmountAtomic: balance.toString(),
      fromAddress,
      solanaAddress,
      slippagePct,
      fetchQuote,
      quoteSolana: args.quoteSolana ?? priceSolanaConversion,
    });
    if (BigInt(quote.toAmountMinAtomic) <= 0n) {
      return blocked(
        vault,
        "unavailable",
        `The conversion from ${source.symbol} on ${source.chainLabel} did not return a usable rate.`,
      );
    }
    return { sourceAmountAtomic: balance.toString(), quote };
  } catch (err) {
    return blocked(
      vault,
      "unavailable",
      `No conversion route from ${source.symbol} on ${source.chainLabel} right now. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    );
  }
}

// Slippage tolerance for a route, when the caller has not pinned one. A Solana
// source converts in a single Jupiter hop, so it tolerates a tight setting; an
// EVM source crosses a bridge and keeps Trustware's own 1% default.
function slippageFor(source: EquivalentSource): number {
  return source.kind === "solana"
    ? TRUSTWARE_SOLANA_SLIPPAGE
    : TRUSTWARE_DEFAULT_SLIPPAGE;
}

// Price one candidate source end to end. Returns the executable plan, or the
// reason this particular source cannot serve the deposit. Every failure here is
// candidate-scoped: the caller moves on to the next one.
async function planFromCandidate(args: {
  candidate: HeldEquivalent;
  vault: XStockBorrowVault;
  requested: bigint;
  shortfall: bigint;
  shortfallUi: string;
  decimals: number;
  solanaAddress: string;
  evmAddress: string | undefined;
  // Undefined means "let the route decide". See slippageFor.
  slippagePct: number | undefined;
  fetchQuote: QuoteFn;
  quoteSolana: SolanaQuoteFn;
}): Promise<ConvertThenDepositPlan | BlockedPlan> {
  const {
    candidate,
    vault,
    requested,
    shortfall,
    shortfallUi,
    decimals,
    solanaAddress,
    evmAddress,
    fetchQuote,
    quoteSolana,
  } = args;
  const { source } = candidate;
  const balance = BigInt(candidate.balanceAtomic);
  const slippagePct = args.slippagePct ?? slippageFor(source);

  // Who holds and signs the source leg. A Solana source is the user's own Solana
  // wallet, so no EVM wallet is needed at all; only EVM sources require one.
  const fromAddress = source.kind === "solana" ? solanaAddress : evmAddress;
  if (!fromAddress) {
    return blocked(
      vault,
      "unavailable",
      "No wallet is available to sign on the source chain.",
    );
  }

  // Probe at the notional 1:1 amount to learn the live rate, clamped to what the
  // user actually holds so the quote is one they could execute. These tokens
  // track the same underlying, so 1:1 is a close first guess and the probe only
  // has to correct for fees, slippage and price impact.
  const notional = BigInt(
    rescaleAtomic(shortfall.toString(), decimals, source.decimals),
  );
  const probeAmount = notional > balance ? balance : notional;
  if (probeAmount <= 0n) {
    return blocked(
      vault,
      "insufficient",
      `Your ${source.symbol} balance on ${source.chainLabel} is too small to convert.`,
    );
  }

  let probe: ConversionQuote;
  try {
    probe = await priceLeg({
      source,
      vault,
      fromAmountAtomic: probeAmount.toString(),
      fromAddress,
      solanaAddress,
      slippagePct,
      fetchQuote,
      quoteSolana,
    });
  } catch (err) {
    // A token being listed in Trustware's registry does not prove a live route.
    // Chains go under maintenance; surface that as unavailable, not as the
    // user's balance being wrong.
    return blocked(
      vault,
      "unavailable",
      `No conversion route from ${source.symbol} on ${source.chainLabel} right now. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    );
  }

  const delivered = BigInt(probe.toAmountMinAtomic);
  if (delivered <= 0n) {
    return blocked(
      vault,
      "unavailable",
      `The conversion from ${source.symbol} on ${source.chainLabel} did not return a usable rate.`,
    );
  }

  // Solve for the source amount that clears the shortfall at the observed rate.
  // The units cancel out: shortfall and delivered are both destination-scale, so
  // the result is already source-scale and needs no rescale.
  let required = (shortfall * probeAmount + delivered - 1n) / delivered;
  required = BigInt(addBps(required.toString(), CONVERSION_HEADROOM_BPS));

  if (required > balance) {
    const heldUi = atomicToUi(balance.toString(), source.decimals);
    const neededUi = atomicToUi(required.toString(), source.decimals);
    return blocked(
      vault,
      "insufficient",
      `Converting all ${heldUi} ${source.symbol} on ${source.chainLabel} is not enough. About ${neededUi} is needed to cover ${shortfallUi} ${vault.collateralSymbol}.`,
    );
  }

  // Re-quote at the solved amount. The first quote priced a different size, so
  // its fee and price-impact figures do not describe what we would actually run.
  let quote: ConversionQuote;
  try {
    quote = await priceLeg({
      source,
      vault,
      fromAmountAtomic: required.toString(),
      fromAddress,
      solanaAddress,
      slippagePct,
      fetchQuote,
      quoteSolana,
    });
  } catch (err) {
    return blocked(
      vault,
      "unavailable",
      `Could not price the conversion from ${source.symbol} on ${source.chainLabel}. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    );
  }

  // Final guard. If the confirming quote still lands under the shortfall the
  // rate moved against us; better to stop than to run a conversion that leaves
  // the deposit short.
  if (BigInt(quote.toAmountMinAtomic) < shortfall) {
    return blocked(
      vault,
      "unavailable",
      "The conversion rate moved while pricing. Try again.",
    );
  }

  return {
    kind: "convert-then-deposit",
    vault,
    depositAtomic: requested.toString(),
    shortfallAtomic: shortfall.toString(),
    source,
    sourceAmountAtomic: required.toString(),
    quote,
  };
}

// Human-readable one-liner for the preview UI.
export function describePlan(plan: ConversionPlan): string {
  if (plan.kind === "direct-deposit") {
    return `Deposit ${atomicToUi(
      plan.depositAtomic,
      plan.vault.collateralDecimals,
    )} ${plan.vault.collateralSymbol}.`;
  }
  if (plan.kind === "convert-then-deposit") {
    const from = atomicToUi(plan.sourceAmountAtomic, plan.source.decimals);
    const to = atomicToUi(
      plan.quote.toAmountMinAtomic,
      plan.vault.collateralDecimals,
    );
    return `Convert ${from} ${plan.source.symbol} on ${plan.source.chainLabel} into at least ${to} ${plan.vault.collateralSymbol}, then deposit ${atomicToUi(
      plan.depositAtomic,
      plan.vault.collateralDecimals,
    )} ${plan.vault.collateralSymbol}.`;
  }
  return plan.reason;
}
