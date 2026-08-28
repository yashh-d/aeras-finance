// Morpho Blue position math, ported exactly from the contracts.
//
// This is a port, not an approximation. Every function below mirrors a specific
// Morpho library so an off-chain number and the on-chain check agree at the
// last atomic unit: SharesMathLib for the share conversions, MathLib for the
// fixed-point helpers and the Taylor-series interest accrual, and
// Morpho._isHealthy for the solvency test. Rounding direction is part of the
// port. `toAssetsUp` for debt and `mulDivDown` for borrowing power are not
// stylistic choices; rounding either the other way produces a position the
// contract calls unhealthy while our UI calls it fine.
//
// Everything is BigInt. A position priced through a JS float loses the low
// digits, which is the same class of bug lib/trustware/amounts.ts guards.

import { ORACLE_PRICE_SCALE, WAD, type MorphoBlueMarket } from "./gold-market";

// ── MathLib ────────────────────────────────────────────────────────────────

function mulDivDown(x: bigint, y: bigint, d: bigint): bigint {
  return (x * y) / d;
}

function mulDivUp(x: bigint, y: bigint, d: bigint): bigint {
  return (x * y + d - 1n) / d;
}

function wMulDown(x: bigint, y: bigint): bigint {
  return mulDivDown(x, y, WAD);
}

// Morpho's continuous-compounding approximation: the first three terms of
// e^(rate*elapsed) - 1. Truncating at three terms is what the contract does, so
// reproducing the truncation is what keeps this exact rather than merely close.
function wTaylorCompounded(rate: bigint, elapsed: bigint): bigint {
  const firstTerm = rate * elapsed;
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD);
  return firstTerm + secondTerm + thirdTerm;
}

// ── SharesMathLib ──────────────────────────────────────────────────────────
//
// Morpho seeds every market with virtual shares and a virtual asset so an empty
// market cannot be share-price manipulated by the first depositor. They are not
// real balances, but they are part of every conversion and omitting them skews
// small positions badly.
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

export function toAssetsUp(
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  return mulDivUp(
    shares,
    totalAssets + VIRTUAL_ASSETS,
    totalShares + VIRTUAL_SHARES,
  );
}

export function toSharesUp(
  assets: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  return mulDivUp(
    assets,
    totalShares + VIRTUAL_SHARES,
    totalAssets + VIRTUAL_ASSETS,
  );
}

function toSharesDown(
  assets: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  return mulDivDown(
    assets,
    totalShares + VIRTUAL_SHARES,
    totalAssets + VIRTUAL_ASSETS,
  );
}

// ── interest accrual ───────────────────────────────────────────────────────

// The market totals as the singleton stores them.
export interface MarketState {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  // Unix seconds of the last accrual.
  lastUpdate: bigint;
  // Protocol fee on accrued interest, WAD-scaled.
  fee: bigint;
}

// Bring a market's totals forward to `nowSeconds`, exactly as
// Morpho._accrueInterest would.
//
// Why bother: `market(id)` returns the totals as of the last write that touched
// this market, which can be hours ago on a quiet market. Reading debt from
// stale totals **under-reports it**, because interest has accrued that the
// stored number does not include. Under-reported debt reads as a healthier
// position than the borrower has, which is the one direction a liquidation
// warning must never err in. So the read path accrues before it prices.
export function accrueInterest(
  state: MarketState,
  borrowRatePerSecond: bigint,
  nowSeconds: bigint,
): MarketState {
  const elapsed = nowSeconds - state.lastUpdate;
  if (elapsed <= 0n || state.totalBorrowAssets === 0n) return state;

  const interest = wMulDown(
    state.totalBorrowAssets,
    wTaylorCompounded(borrowRatePerSecond, elapsed),
  );
  const totalBorrowAssets = state.totalBorrowAssets + interest;
  const totalSupplyAssets = state.totalSupplyAssets + interest;
  let totalSupplyShares = state.totalSupplyShares;

  if (state.fee !== 0n) {
    const feeAmount = wMulDown(interest, state.fee);
    // The fee is priced against supply EXCLUDING itself, so the fee earner does
    // not take a cut of their own fee.
    totalSupplyShares += toSharesDown(
      feeAmount,
      totalSupplyAssets - feeAmount,
      totalSupplyShares,
    );
  }

  return {
    ...state,
    totalBorrowAssets,
    totalSupplyAssets,
    totalSupplyShares,
    lastUpdate: nowSeconds,
  };
}

// Convert a per-second WAD rate into the compounded annual rate Morpho's own UI
// shows. Returned as a decimal (0.0463 = 4.63%), matching the Kamino and
// Jupiter APY convention in this repo.
export function borrowApyFromRate(borrowRatePerSecond: bigint): number {
  const SECONDS_PER_YEAR = 31_536_000;
  const perSecond = Number(borrowRatePerSecond) / Number(WAD);
  return Math.expm1(perSecond * SECONDS_PER_YEAR);
}

// ── position ───────────────────────────────────────────────────────────────

export interface RawPosition {
  supplyShares: bigint;
  borrowShares: bigint;
  // Raw collateral tokens. Not shares: collateral earns nothing and converts
  // one-for-one.
  collateral: bigint;
}

export interface GoldPositionMath {
  // Collateral held, in XAUt atomic units (6dp).
  collateralAtomic: bigint;
  // Debt owed right now, in USDT atomic units (6dp), interest accrued and
  // rounded UP the way the contract rounds it.
  debtAtomic: bigint;
  // What the collateral is worth in loan-asset units, at the market's own
  // oracle. This is the number liquidations are judged against, and it is not
  // the same as a market price feed; see `oraclePrice`.
  collateralValueAtomic: bigint;
  // The most that could be owed against this collateral before liquidation.
  maxBorrowAtomic: bigint;
  // Still borrowable at the protocol limit. Borrowing this much puts the
  // position exactly at the liquidation threshold, so it is a ceiling to show,
  // never a default to fill in.
  availableToBorrowAtomic: bigint;
  // Collateral removable while leaving the debt covered.
  withdrawableCollateralAtomic: bigint;
  // debt / collateralValue, as a decimal. Null with no collateral.
  ltv: number | null;
  // maxBorrow / debt, as a decimal. Above 1 is solvent, and Morpho liquidates
  // at 1. Null with no debt, which is the "nothing to liquidate" case rather
  // than an infinitely healthy one, so the UI must render it as "no debt".
  healthFactor: number | null;
  // The oracle price at which this position becomes liquidatable, scaled the
  // same way the oracle scales. Null with no debt.
  liquidationOraclePrice: bigint | null;
}

// Price a borrower's position. `oraclePrice` is the market oracle's raw output,
// already scaled by ORACLE_PRICE_SCALE.
export function priceGoldPosition(args: {
  market: MorphoBlueMarket;
  position: RawPosition;
  // Market totals, already accrued forward. Passing stale totals silently
  // under-reports the debt.
  state: MarketState;
  oraclePrice: bigint;
}): GoldPositionMath {
  const { market, position, state, oraclePrice } = args;

  // Rounded UP, matching Morpho._isHealthy. A borrower always owes the
  // rounded-up number.
  const debtAtomic =
    position.borrowShares === 0n
      ? 0n
      : toAssetsUp(
          position.borrowShares,
          state.totalBorrowAssets,
          state.totalBorrowShares,
        );

  // Rounded DOWN, again matching the contract: borrowing power is never
  // rounded in the borrower's favour.
  const collateralValueAtomic = mulDivDown(
    position.collateral,
    oraclePrice,
    ORACLE_PRICE_SCALE,
  );
  const maxBorrowAtomic = wMulDown(collateralValueAtomic, market.lltv);

  const availableToBorrowAtomic =
    maxBorrowAtomic > debtAtomic ? maxBorrowAtomic - debtAtomic : 0n;

  // The collateral that must stay behind to cover the debt, rounded up, then
  // whatever is left over is free to leave.
  let withdrawableCollateralAtomic = position.collateral;
  if (debtAtomic > 0n) {
    const required =
      oraclePrice === 0n || market.lltv === 0n
        ? position.collateral
        : mulDivUp(debtAtomic, ORACLE_PRICE_SCALE * WAD, oraclePrice * market.lltv);
    withdrawableCollateralAtomic =
      position.collateral > required ? position.collateral - required : 0n;
  }

  const ltv =
    collateralValueAtomic > 0n
      ? Number(debtAtomic) / Number(collateralValueAtomic)
      : null;

  const healthFactor =
    debtAtomic > 0n ? Number(maxBorrowAtomic) / Number(debtAtomic) : null;

  // Solve maxBorrow == debt for the price.
  const liquidationOraclePrice =
    debtAtomic > 0n && position.collateral > 0n && market.lltv > 0n
      ? mulDivUp(
          debtAtomic,
          ORACLE_PRICE_SCALE * WAD,
          position.collateral * market.lltv,
        )
      : null;

  return {
    collateralAtomic: position.collateral,
    debtAtomic,
    collateralValueAtomic,
    maxBorrowAtomic,
    availableToBorrowAtomic,
    withdrawableCollateralAtomic,
    ltv,
    healthFactor,
    liquidationOraclePrice,
  };
}

// ── borrow sizing ──────────────────────────────────────────────────────────

// How far below the liquidation threshold a suggested borrow sits, in basis
// points of LTV. At a 77% LLTV this suggests borrowing to 57%, which survives a
// 26% drop in gold before liquidation.
//
// This is a suggestion the form pre-fills, not a cap. Users can borrow up to
// the protocol limit; they just should not arrive there by accident, and gold
// moving 20% inside a year is ordinary rather than exceptional.
export const SUGGESTED_LTV_BUFFER_BPS = 2_000;

// The borrow amount to pre-fill: LLTV less the buffer, applied to the
// collateral value, less anything already owed.
export function suggestedBorrowAtomic(math: GoldPositionMath, market: MorphoBlueMarket): bigint {
  const targetLtv = market.lltv - (WAD * BigInt(SUGGESTED_LTV_BUFFER_BPS)) / 10_000n;
  if (targetLtv <= 0n) return 0n;
  const target = wMulDown(math.collateralValueAtomic, targetLtv);
  return target > math.debtAtomic ? target - math.debtAtomic : 0n;
}

// Convert an oracle price into a human "one ounce costs N loan tokens" figure.
// The oracle scale already folds in both tokens' decimals, so this only has to
// undo ORACLE_PRICE_SCALE and re-apply the collateral's own unit.
export function oraclePriceToUnitPrice(
  oraclePrice: bigint,
  collateralDecimals: number,
  loanDecimals: number,
): number {
  const oneUnit = 10n ** BigInt(collateralDecimals);
  const valueAtomic = mulDivDown(oneUnit, oraclePrice, ORACLE_PRICE_SCALE);
  return Number(valueAtomic) / 10 ** loanDecimals;
}
