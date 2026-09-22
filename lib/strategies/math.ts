// Pure arithmetic for the three buy strategies. No I/O, no React, so every
// function here is unit-tested in math.test.ts against the venue numbers in
// docs/jupiter-borrow.md. Nothing else in the repo should compute a strategy
// rate: the tiles, the tickets and the Borrow and Earn tabs have to agree to
// the decimal, and one source is the only way to guarantee that.
//
// Units: every rate is a decimal (0.05 is 5%), every ratio is a fraction of 1,
// every leverage is a multiple (2 is 2x). Format for display at the edge.

import type { BorrowRoute } from "@/lib/borrow/route";
import { safeMaxBorrowRatio } from "@/lib/borrow/route";

// Default borrow ratio for Buy + Earn and the ladder, as a fraction of the
// route's collateral factor. Half the factor puts health near 2.3 on a 75% LT
// market, which leaves room for a bad week without a liquidation.
export const DEFAULT_BORROW_RATIO_OF_CF = 0.5;

// A ladder round that would borrow less than this is not worth a signature.
export const LADDER_FLOOR_USD = 5;

// Same buffer maxLeverageForVault in lib/jupiter/multiply.ts applies to the
// collateral factor: the resulting LTV has to land under CF after slippage.
const LEVERAGE_CF_BUFFER = 0.05;

// The borrow ratio a route defaults to. Never above the safe ceiling the borrow
// forms already use, so a strategy can never draw more than a plain borrow.
export function defaultBorrowRatio(route: BorrowRoute): number {
  return Math.min(
    route.collateralFactor * DEFAULT_BORROW_RATIO_OF_CF,
    safeMaxBorrowRatio(route),
  );
}

// The ratio Trader mode borrows at: the safe ceiling the borrow forms and the
// ratio slider already enforce (90% of the collateral factor), floored to the
// slider's hundredth so the card, the slider and the run agree to the digit.
// The biggest net rate a Buy + Earn can show, and the smallest cushion: on
// the September 2026 Jupiter numbers health lands near 1.3 and the price can
// fall about 21 to 23% before liquidation. See docs/trader-mode-plan.md, D11.
export function maxBorrowRatio(route: BorrowRoute): number {
  return Math.floor(safeMaxBorrowRatio(route) * 100) / 100;
}

// Leverage reached when debt is `ratio` of the collateral value, and back.
// exposure = equity / (1 - ratio), debt = exposure - equity.
export function leverageForRatio(ratio: number): number {
  if (ratio <= 0) return 1;
  if (ratio >= 1) return Infinity;
  return 1 / (1 - ratio);
}

export function ratioForLeverage(leverage: number): number {
  if (leverage <= 1) return 0;
  return (leverage - 1) / leverage;
}

// Highest leverage a route allows, on the same terms as the looping panel:
// collateral factor less a five-point buffer, converted to a multiple. On the
// September 2026 numbers that is 2.5x for a 65% factor and 3.3x for 75%.
export function maxLeverageForRoute(route: BorrowRoute): number {
  const targetLtv = Math.max(0, route.collateralFactor - LEVERAGE_CF_BUFFER);
  return leverageForRatio(targetLtv);
}

// Leverage presets an asset can actually reach. 3x is dropped where the
// ceiling is below it rather than rendered as a button that cannot work.
export function leveragePresets(route: BorrowRoute): number[] {
  const max = maxLeverageForRoute(route);
  const presets = [2, 3].filter((l) => l <= max);
  const maxRounded = Math.floor(max * 10) / 10;
  if (!presets.some((p) => Math.abs(p - maxRounded) < 0.05)) {
    presets.push(maxRounded);
  }
  return presets;
}

export interface EarnNetApyInputs {
  // Debt as a fraction of collateral value.
  borrowRatio: number;
  // What the borrowed USDC earns, decimal.
  earnApy: number;
  // What the debt costs, decimal.
  borrowApr: number;
  // What the posted collateral earns at the venue, decimal. Zero on Jupiter.
  collateralSupplyApy: number;
}

// Annual return on the equity the user put in. The collateral earns its own
// supply rate on the whole position; the borrowed slice earns the spread.
export function earnNetApy(i: EarnNetApyInputs): number {
  return i.collateralSupplyApy + i.borrowRatio * (i.earnApy - i.borrowApr);
}

// The spread alone, so a tile can say "earn 6.1%, borrow 5.2%" beside the net.
export function earnSpread(earnApy: number, borrowApr: number): number {
  return earnApy - borrowApr;
}

export interface LadderRound {
  round: number;
  // USDC spent buying the asset this round.
  buyUsd: number;
  // USDC drawn against what this round bought.
  borrowUsd: number;
  // Running totals after this round.
  exposureUsd: number;
  debtUsd: number;
}

export interface LadderProjection {
  rounds: LadderRound[];
  exposureUsd: number;
  debtUsd: number;
  // Where the series converges if it ran forever: equity / (1 - ratio).
  limitUsd: number;
  leverage: number;
}

// The sequence of buy-then-borrow rounds from one equity amount. Each round
// buys with the previous round's borrow and borrows `ratio` of that. The series
// is geometric, so it converges quickly: at 58% five rounds capture 90% of the
// limit. Stops when the next borrow would be under the floor or at maxRounds.
export function ladderProjection(args: {
  equityUsd: number;
  borrowRatio: number;
  floorUsd?: number;
  maxRounds?: number;
}): LadderProjection {
  const {
    equityUsd,
    borrowRatio,
    floorUsd = LADDER_FLOOR_USD,
    maxRounds = 12,
  } = args;
  const rounds: LadderRound[] = [];
  let exposure = 0;
  let debt = 0;
  let buy = equityUsd;
  for (let n = 1; n <= maxRounds && buy > 0; n++) {
    const borrow = buy * borrowRatio;
    exposure += buy;
    // A round whose borrow is under the floor still buys; it just does not
    // borrow, and that ends the ladder.
    const borrows = borrow >= floorUsd;
    if (borrows) debt += borrow;
    rounds.push({
      round: n,
      buyUsd: buy,
      borrowUsd: borrows ? borrow : 0,
      exposureUsd: exposure,
      debtUsd: debt,
    });
    if (!borrows) break;
    buy = borrow;
  }
  const limitUsd =
    borrowRatio > 0 && borrowRatio < 1 ? equityUsd / (1 - borrowRatio) : equityUsd;
  return {
    rounds,
    exposureUsd: exposure,
    debtUsd: debt,
    limitUsd,
    leverage: equityUsd > 0 ? exposure / equityUsd : 1,
  };
}

export interface HealthInput {
  collateralUsd: number;
  debtUsd: number;
  // Fraction of 1.
  liquidationThreshold: number;
}

// Health of one position: liquidation threshold over current LTV. Below 1.0 is
// liquidatable. Infinity with no debt.
export function positionHealth(p: HealthInput): number {
  if (p.debtUsd <= 0) return Infinity;
  if (p.collateralUsd <= 0) return 0;
  return (p.liquidationThreshold * p.collateralUsd) / p.debtUsd;
}

// The weakest position decides whether a ladder is safe. Positions are
// isolated per venue and per vault, so there is no cross-margin to average.
export function minHealth(positions: HealthInput[]): number {
  return positions.reduce(
    (min, p) => Math.min(min, positionHealth(p)),
    Infinity,
  );
}

// Fraction the collateral price can fall before a position is liquidatable.
export function liquidationDrop(p: HealthInput): number | null {
  if (p.debtUsd <= 0 || p.collateralUsd <= 0) return null;
  const drop = 1 - p.debtUsd / (p.collateralUsd * p.liquidationThreshold);
  return Math.max(0, drop);
}
