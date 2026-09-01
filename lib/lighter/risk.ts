import { LIGHTER_MARGIN_FRACTION_SCALE } from "./constants";
import type { LighterMarket } from "./types";

// What a hedge costs to open and what would kill it.
//
// Ordinary numbers rather than the BigInt of sizing.ts, deliberately: nothing
// here is submitted anywhere. These figures are shown to a user so they can
// decide, and a display value that is off in the fifteenth decimal place is not
// a risk. An order size that is off in the fifteenth decimal place is.
//
// The important caveat, which the UI has to carry: Lighter margin is cross by
// default (market_margin_mode 0), so a real liquidation price depends on every
// position and every collateral asset in the account, not just this one. The
// estimate below treats the position as if it were alone. That is correct for a
// user whose only position is the hedge, which is the flow we are building, and
// optimistic for anyone who later opens a second position. Recompute from the
// account's own margin figures once positions are live rather than trusting this
// for an account with more than one open market.

// Margin required to open, at the market's default leverage.
export function initialMarginUsd(
  notionalUsd: number,
  market: LighterMarket,
): number {
  return notionalUsd * market.initialMarginFraction;
}

// Margin required to open at a chosen leverage, clamped to what the market
// actually permits. Requesting more leverage than min_initial_margin_fraction
// allows is rejected by the exchange, so it is clamped here rather than
// discovered on submission.
export function marginForLeverage(
  notionalUsd: number,
  leverage: number,
  market: LighterMarket,
): { marginUsd: number; leverage: number; clamped: boolean } {
  if (!(leverage > 0)) throw new Error(`Leverage must be positive, got ${leverage}`);

  const allowed = Math.min(leverage, market.maxLeverage);
  return {
    marginUsd: notionalUsd / allowed,
    leverage: allowed,
    clamped: allowed < leverage,
  };
}

// The same leverage as the integer an UpdateLeverage transaction carries.
//
// InitialMarginFraction is a uint16 on the wire, scaled so 10000 is 100%, and
// lighter-go rejects anything outside 1..10000 (ErrInitialMarginFractionTooLow
// and ...TooHigh). 2x is 5000. Clamped to the market's own maximum through
// marginForLeverage rather than computed inline, so the figure a panel displays
// and the figure the exchange is told cannot drift apart: both come from here.
//
// Rounds DOWN the fraction, which rounds leverage UP toward the market maximum
// only to the nearest tick. The alternative direction would ask for a fraction
// finer than the exchange's own tick and be rejected.
export function wireInitialMarginFraction(
  leverage: number,
  market: LighterMarket,
): { fraction: number; leverage: number } {
  const { leverage: allowed } = marginForLeverage(1, leverage, market);
  const fraction = Math.floor(LIGHTER_MARGIN_FRACTION_SCALE / allowed);

  if (fraction < 1 || fraction > LIGHTER_MARGIN_FRACTION_SCALE) {
    throw new Error(
      `Leverage ${leverage}x maps to margin fraction ${fraction}, outside 1..${LIGHTER_MARGIN_FRACTION_SCALE}`,
    );
  }
  return { fraction, leverage: allowed };
}

// Price at which a lone position is liquidated.
//
//   short:  equity = C + S(P0 - P),  liquidated when equity <= MMF * S * P
//           so  P = (C + S*P0) / (S * (1 + MMF))
//   long:   P = (S*P0 - C) / (S * (1 - MMF))
//
// Returns null for a long that cannot be liquidated by price alone, which
// happens when collateral covers the whole position.
export function liquidationPrice(input: {
  entryPriceUsd: number;
  size: number;
  collateralUsd: number;
  isShort: boolean;
  market: LighterMarket;
}): number | null {
  const { entryPriceUsd, size, collateralUsd, isShort, market } = input;
  if (size <= 0 || entryPriceUsd <= 0) return null;

  const mmf = market.maintenanceMarginFraction;
  const notional = size * entryPriceUsd;

  if (isShort) {
    return (collateralUsd + notional) / (size * (1 + mmf));
  }

  const denominator = size * (1 - mmf);
  if (denominator <= 0) return null;
  const price = (notional - collateralUsd) / denominator;
  return price > 0 ? price : null;
}

// How far the market has to move against the position before it liquidates, as
// a fraction of the entry price. More legible than a bare price for deciding
// whether a hedge is safely collateralized.
export function liquidationDistance(input: {
  entryPriceUsd: number;
  size: number;
  collateralUsd: number;
  isShort: boolean;
  market: LighterMarket;
}): number | null {
  const price = liquidationPrice(input);
  if (price === null) return null;
  return Math.abs(price - input.entryPriceUsd) / input.entryPriceUsd;
}

// A hedge is the one position where liquidation is not the disaster it looks
// like: the short is liquidated precisely when the stock it offsets has gone up,
// so the user is made whole on the holding. The cost is that the hedge
// disappears at the worst moment and the loss on the perp is realized. Surface
// the distance so the user can size collateral against a move they consider
// plausible, not so the position can be presented as safe.

export interface FundingEstimate {
  // Percent per hour, in the units Lighter reports.
  hourlyRatePercent: number;
  annualizedPercent: number;
  // Positive means the position pays, negative means it receives.
  costUsdPerDay: number;
}

// Funding settles hourly and the rate is clamp(premium + interest) / 8, in
// percent. With no live premium the interest component alone is the floor
// estimate, which is what a market at fair value trends toward.
//
// This is an estimate for display. The realized rate moves with the premium
// every hour, and on an equity market it can move sharply over a weekend while
// the underlying is closed. Read the live funding endpoint for anything that
// needs the actual number.
export function estimateFundingFromInterest(
  notionalUsd: number,
  market: LighterMarket,
  isShort: boolean,
): FundingEstimate {
  const baseRate = Number(market.baseInterestRate);
  if (!Number.isFinite(baseRate)) {
    return { hourlyRatePercent: 0, annualizedPercent: 0, costUsdPerDay: 0 };
  }

  const hourly = baseRate / 8;
  // At a zero premium longs pay the interest component and shorts receive it,
  // so a hedge carries at a small credit rather than a cost.
  const signed = isShort ? -hourly : hourly;

  return {
    hourlyRatePercent: signed,
    annualizedPercent: signed * 24 * 365,
    costUsdPerDay: (notionalUsd * signed * 24) / 100,
  };
}

// Fees are currently zero on every market, maker and taker, which is why no fee
// term appears in the sizing math. This asserts that rather than assuming it, so
// a change on Lighter's side surfaces as a failed check instead of a hedge that
// quietly costs more than we told the user.
export function isFeeFree(market: LighterMarket): boolean {
  return Number(market.takerFee) === 0 && Number(market.makerFee) === 0;
}
