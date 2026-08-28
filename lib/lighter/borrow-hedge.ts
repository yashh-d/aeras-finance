// Sizing a hedge that pays for itself.
//
// The shape: a user holding $1,000 of TSLAx borrows $500 of USDC against it,
// posts that as Lighter margin, and shorts $1,000 of TSLA. Net delta is zero and
// no new money was added. The number that makes it work is the product of the
// borrow ratio and the perp leverage:
//
//     borrowRatio * leverage == 1   =>   fully delta-neutral
//
// 0.5 and 2x is one point on that curve, not a magic pair. The curve is a
// straight trade between the two liquidation risks, and they run in opposite
// directions, which is the thing about this position that is easy to get wrong:
//
//   - The stock falls. Collateral is marked down while the debt stays fixed, so
//     the *borrow* walks toward its liquidation threshold. The perp is in profit.
//   - The stock rises. The *short* bleeds margin toward its own liquidation. The
//     borrow position is getting healthier.
//
// So a lower borrow ratio buys safety on the borrow and spends it on the perp,
// and a higher one does the reverse. Neither leg can rescue the other, because
// the perp's profit sits on Lighter and cannot repay a Solana debt without a
// withdrawal first. Both distances are reported for that reason: a plan that
// showed only one would look safe in exactly the direction it was not.
//
// Everything here is planning and display arithmetic in ordinary numbers, the
// same choice risk.ts makes and for the same reason. The one number that becomes
// an order goes through computeHedgeSize, which works in scaled BigInt and is
// the audited path. This module derives the ratio and hands it over rather than
// reimplementing the sizing.

import {
  borrowLiquidationDrop,
  healthAt,
  safeMaxBorrowRatio,
  type BorrowRoute,
} from "@/lib/borrow/route";

import {
  deliveredMarginUsd,
  type FundingRoute,
} from "./borrow-funding";
import type { HedgeRoute } from "./hedge";
import {
  estimateFundingFromInterest,
  isFeeFree,
  liquidationDistance,
} from "./risk";
import { computeHedgeSize, type HedgeSizeLimit } from "./sizing";
import type { LighterMarket } from "./types";

// The borrow ratio to aim for when the caller does not name one.
//
// 50% and 2x is the pair worth reaching for, but it is only reachable where the
// venue lends that much, and on the live numbers half the catalog does not.
// Kamino takes AAPLx at 40%, METAx at 35%, and MSTRx, HOODx and CRCLx at 30%,
// so a flat 50% is not a conservative default there, it is an impossible one.
//
// Neutrality does not depend on hitting 50% though. It depends on the product
// borrowRatio * leverage staying at 1, so a venue that lends less is answered by
// shorting at higher leverage rather than by refusing. The default therefore
// asks for 50% and settles for the most the venue actually allows, and the only
// thing that can still block the plan is the market's own leverage cap.
export const PREFERRED_BORROW_RATIO = 0.5;

export function defaultBorrowRatioFor(route: BorrowRoute): number {
  return Math.min(PREFERRED_BORROW_RATIO, safeMaxBorrowRatio(route));
}

export interface BorrowHedgeInput {
  xstockSymbol: string;
  // Tokens held, as a decimal string. Never a float: an 8-decimal balance that
  // rounded up in the last place sizes an order the wallet cannot back.
  quantity: string;
  tokenPriceUsd: string;
  borrowRoute: BorrowRoute;
  hedgeRoute: HedgeRoute;
  // Live, from the catalog. Never a snapshot: margin fractions and tradeability
  // are state on this venue, not configuration.
  market: LighterMarket;
  funding: FundingRoute;
  borrowRatio?: number;
  // From a real Trustware quote when one has been fetched. Falls back to the
  // route's planning bound, which is deliberately pessimistic.
  quotedLossBps?: number;
  // Live borrow APR on the vault or reserve, percent. Omitted means the carry
  // figure reports only the funding side and says so.
  borrowAprPercent?: number;
}

export type BorrowHedgeBlock =
  | "market-not-tradeable"
  | "no-price"
  | "borrow-ratio-too-high"
  | "below-deposit-minimum"
  | "below-order-minimum";

export interface BorrowHedgeCarry {
  // Interest on the drawn USDC, per year. Always a cost.
  borrowCostUsdPerYear: number | null;
  // Funding on the short, per year. Negative means the position receives, which
  // is the usual direction for a short at a flat premium.
  fundingUsdPerYear: number;
  // Sum, when the borrow rate is known. Positive is a net cost.
  netUsdPerYear: number | null;
  // Net as a percentage of the holding being hedged.
  netPercentOfExposure: number | null;
}

export interface BorrowHedgeRisk {
  // Health on the borrow leg at this ratio. Below 1.0 is liquidatable.
  borrowHealth: number;
  // How far the stock may FALL before the borrow is liquidatable.
  borrowLiquidationDrop: number | null;
  // How far the stock may RISE before the short is liquidated.
  shortLiquidationRise: number | null;
  // The smaller of the two, which is the one that actually bounds the position.
  worstCaseMove: number | null;
}

export interface BorrowHedgePlanOk {
  kind: "ok";
  xstockSymbol: string;
  marketSymbol: string;
  // Full value of the holding being hedged.
  exposureUsd: number;
  borrowRatio: number;
  // Drawn against the collateral.
  borrowedUsd: number;
  // What survives the road to Lighter and is actually posted.
  marginUsd: number;
  // Given up in transit.
  fundingLossUsd: number;
  // The short, after the market's own increments and minimums.
  shortNotionalUsd: number;
  shortSize: string;
  // The integer create_order carries.
  baseAmount: string;
  leverage: number;
  // Portion of the exposure actually offset. Below 1 whenever an increment, a
  // cap, or the market's max leverage binds.
  coverage: number;
  // What stays long after the hedge. Zero at full coverage.
  netExposureUsd: number;
  // Set when the market's leverage cap, rather than the borrow, limited the size.
  leverageCapped: boolean;
  // Set when the order was trimmed by an increment or a quote cap.
  sizeLimitedBy: HedgeSizeLimit;
  // Minutes the position is expected to sit unhedged between the borrow landing
  // and the short filling. The road's number, restated here because it is a risk
  // figure for this position rather than a property of the road.
  unhedgedMinutes: number;
  risk: BorrowHedgeRisk;
  carry: BorrowHedgeCarry;
  // Non-fatal things the surface must disclose.
  warnings: string[];
}

export interface BorrowHedgePlanBlocked {
  kind: "blocked";
  reason: BorrowHedgeBlock;
  message: string;
}

export type BorrowHedgePlan = BorrowHedgePlanOk | BorrowHedgePlanBlocked;

const HOURS_PER_YEAR = 24 * 365;

export function planBorrowHedge(input: BorrowHedgeInput): BorrowHedgePlan {
  const {
    xstockSymbol,
    quantity,
    tokenPriceUsd,
    borrowRoute,
    hedgeRoute,
    market,
    funding,
  } = input;
  const borrowRatio = input.borrowRatio ?? defaultBorrowRatioFor(borrowRoute);

  const blocked = (
    reason: BorrowHedgeBlock,
    message: string,
  ): BorrowHedgePlanBlocked => ({ kind: "blocked", reason, message });

  if (!market.tradeable) {
    return blocked(
      "market-not-tradeable",
      `${market.symbol} is not accepting orders on Lighter right now.`,
    );
  }

  const price = Number(tokenPriceUsd);
  const markPrice = Number(market.markPrice);
  const qty = Number(quantity);
  if (!(price > 0) || !(markPrice > 0) || !(qty > 0)) {
    return blocked(
      "no-price",
      "This holding has no usable price, so a hedge cannot be sized.",
    );
  }

  // Checked before anything is drawn. Borrowing to the venue's own factor is
  // rejected on chain the moment the oracle ticks down between building the
  // transaction and landing it.
  const maxRatio = safeMaxBorrowRatio(borrowRoute);
  if (borrowRatio > maxRatio) {
    return blocked(
      "borrow-ratio-too-high",
      `${borrowRoute.venueLabel} lends at most ${(borrowRoute.collateralFactor * 100).toFixed(0)}% ` +
        `against ${borrowRoute.collateralSymbol}, so this plan stops at ` +
        `${(maxRatio * 100).toFixed(0)}% to leave room for price movement.`,
    );
  }

  const exposureUsd = qty * price;
  const borrowedUsd = exposureUsd * borrowRatio;
  const marginUsd = deliveredMarginUsd(
    funding,
    borrowedUsd,
    input.quotedLossBps,
  );

  if (marginUsd < funding.minimumUsd) {
    return blocked(
      "below-deposit-minimum",
      `Borrowing ${(borrowRatio * 100).toFixed(0)}% against this holding delivers about ` +
        `$${marginUsd.toFixed(2)} of margin, under the $${funding.minimumUsd} minimum ` +
        `for ${funding.label}. A deposit below it does not credit.`,
    );
  }

  // Full neutrality is the target. The market's own cap on leverage is the only
  // thing allowed to reduce it, and when it does the plan degrades to partial
  // coverage rather than failing, because a partial hedge is still worth having.
  const wantedLeverage = exposureUsd / marginUsd;
  const leverage = Math.min(wantedLeverage, market.maxLeverage);
  const leverageCapped = leverage < wantedLeverage;
  const affordableNotional = marginUsd * leverage;

  // Handed to the audited sizing path as a ratio of exposure, which is the unit
  // it works in. Clamped to 1 because over-hedging turns a hedge into a net
  // short, and floating-point division can land a hair above.
  const targetRatio = Math.min(1, affordableNotional / exposureUsd);
  const sized = computeHedgeSize({
    quantity,
    tokenPriceUsd,
    hedgeRatio: targetRatio,
    marketPriceUsd: market.markPrice,
    sizeDecimals: market.sizeDecimals,
    minBaseAmount: market.minBaseAmount,
    minQuoteAmount: market.minQuoteAmount,
    orderQuoteLimit: market.orderQuoteLimit,
  });

  if (sized.baseAmount === "0") {
    const why =
      sized.limitedBy === "below-min-notional"
        ? `under ${market.symbol}'s $${market.minQuoteAmount} minimum order`
        : `under ${market.symbol}'s ${market.minBaseAmount} minimum size`;
    return blocked(
      "below-order-minimum",
      `The short this holding supports is ${why}. Hedging it needs a larger position.`,
    );
  }

  const shortNotionalUsd = Number(sized.notionalUsd);
  const size = Number(sized.size);

  const shortLiquidationRise = liquidationDistance({
    entryPriceUsd: markPrice,
    size,
    collateralUsd: marginUsd,
    isShort: true,
    market,
  });
  const drop = borrowLiquidationDrop(borrowRoute, borrowRatio);

  const fundingEstimate = estimateFundingFromInterest(
    shortNotionalUsd,
    market,
    true,
  );
  const fundingUsdPerYear =
    (shortNotionalUsd * fundingEstimate.hourlyRatePercent * HOURS_PER_YEAR) / 100;
  const borrowCostUsdPerYear =
    input.borrowAprPercent != null
      ? (borrowedUsd * input.borrowAprPercent) / 100
      : null;
  const netUsdPerYear =
    borrowCostUsdPerYear != null
      ? borrowCostUsdPerYear + fundingUsdPerYear
      : null;

  const warnings: string[] = [];
  if (hedgeRoute.match === "proxy" && hedgeRoute.basis) {
    warnings.push(hedgeRoute.basis);
  }
  if (leverageCapped) {
    warnings.push(
      `${market.symbol} caps leverage at ${market.maxLeverage}x, so this margin ` +
        `cannot cover the whole holding. The hedge offsets ` +
        `${(sized.effectiveRatio * 100).toFixed(0)}% of it.`,
    );
  }
  if (!isFeeFree(market)) {
    // Sizing carries no fee term because every Lighter market has been fee-free.
    // If that changes the order costs more than the plan says it does.
    warnings.push(
      `${market.symbol} is no longer fee-free on Lighter, so this plan understates the cost of opening.`,
    );
  }
  if (input.borrowAprPercent == null) {
    warnings.push(
      "Borrow interest is not included in the carry figure, only perp funding.",
    );
  }
  if (input.quotedLossBps == null && funding.plannedLossBps > 0) {
    warnings.push(
      `Margin is sized against a worst-case ${funding.plannedLossBps} bps bridge cost. A live quote will usually beat it.`,
    );
  }
  warnings.push(
    `The holding sits unhedged for about ${funding.latencyMinutesEstimate} minutes ` +
      `between the borrow landing and the short filling.`,
  );

  return {
    kind: "ok",
    xstockSymbol,
    marketSymbol: market.symbol,
    exposureUsd: Number(sized.exposureNotionalUsd),
    borrowRatio,
    borrowedUsd,
    marginUsd,
    fundingLossUsd: borrowedUsd - marginUsd,
    shortNotionalUsd,
    shortSize: sized.size,
    baseAmount: sized.baseAmount,
    leverage,
    coverage: sized.effectiveRatio,
    netExposureUsd: Math.max(0, exposureUsd - shortNotionalUsd),
    leverageCapped,
    sizeLimitedBy: sized.limitedBy,
    unhedgedMinutes: funding.latencyMinutesEstimate,
    risk: {
      borrowHealth: healthAt(borrowRoute, borrowRatio),
      borrowLiquidationDrop: drop,
      shortLiquidationRise,
      worstCaseMove:
        drop != null && shortLiquidationRise != null
          ? Math.min(drop, shortLiquidationRise)
          : (drop ?? shortLiquidationRise),
    },
    carry: {
      borrowCostUsdPerYear,
      fundingUsdPerYear,
      netUsdPerYear,
      netPercentOfExposure:
        netUsdPerYear != null && exposureUsd > 0
          ? (netUsdPerYear / exposureUsd) * 100
          : null,
    },
    warnings,
  };
}

// The borrow ratio that reaches full neutrality at a given leverage, and its
// inverse. Exposed so a UI can move one slider and show the other, and so the
// invariant lives in one place rather than being re-derived per surface.
export function leverageForBorrowRatio(borrowRatio: number): number {
  if (!(borrowRatio > 0)) throw new Error("Borrow ratio must be positive");
  return 1 / borrowRatio;
}

export function borrowRatioForLeverage(leverage: number): number {
  if (!(leverage > 0)) throw new Error("Leverage must be positive");
  return 1 / leverage;
}
