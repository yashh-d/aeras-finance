// Aave V4 position math for the Gold spoke, ported from Spoke.sol.
//
// Unlike the Morpho port in lib/morpho/gold-math.ts, the chain does most of
// this for us: `getUserAccountData` returns the health factor computed against
// the hub's live index, so there is no accrue-forward step and the route
// reports the contract's own health. What the chain does not return is
// headroom: how much more can be borrowed, how much collateral can leave, and
// the gold price at which the position is liquidated. Those are solved here
// from the same inputs `_processUserAccountData` uses, with the same scale and
// the same rounding direction (collateral against the user, debt at full
// precision), and lib/aave/gold-math.test.ts pins them to two live positions
// where the chain and Aave's indexer agree to the eighteenth decimal.
//
// Everything is BigInt until the last step. The scales are load-bearing:
//
//   Value           amount × price × 10^(18 − decimals); 1e26 is one USD
//   weighted CF     collateralFactor (bps) × Value
//   health (WAD)    floor(weighted × 1e14 × RAY / totalDebtValueRay)
//
// where totalDebtValueRay is debt in asset units × RAY × price × 10^(18 −
// decimals). See docs/aave-gold.md, "Reads".

import { SUGGESTED_LTV_BUFFER_BPS } from "@/lib/morpho/gold-math";

import { BPS, RAY, VALUE_PER_USD, WAD } from "./gold-market";

export { SUGGESTED_LTV_BUFFER_BPS };

// bpsToWad in WadRayMath: multiply by 1e14.
const BPS_TO_WAD = WAD / BPS;

function mulDivDown(x: bigint, y: bigint, d: bigint): bigint {
  return (x * y) / d;
}

function mulDivUp(x: bigint, y: bigint, d: bigint): bigint {
  return (x * y + d - 1n) / d;
}

// SpokeUtils.toValue: an asset amount in Value units. Reverts on-chain above
// 18 decimals; nothing this app lists is above 18.
export function toValue(
  amountAtomic: bigint,
  decimals: number,
  price: bigint,
): bigint {
  return amountAtomic * price * 10n ** BigInt(18 - decimals);
}

// The inverse, rounded the way the caller asks. `toValue` is exact, so the
// only rounding is here.
function fromValue(
  value: bigint,
  decimals: number,
  price: bigint,
  rounding: "down" | "up",
): bigint {
  const divisor = price * 10n ** BigInt(18 - decimals);
  if (divisor === 0n) return 0n;
  return rounding === "down"
    ? value / divisor
    : (value + divisor - 1n) / divisor;
}

export interface AaveDebtInput {
  // Debt in the reserve's atomic units, drawn plus premium, as
  // `getUserTotalDebt` returns it.
  atomic: bigint;
  decimals: number;
  // Oracle price, ORACLE_DECIMALS places.
  price: bigint;
}

export interface AaveCollateralInput {
  // Supplied assets in atomic units, as `getUserSuppliedAssets` returns them.
  atomic: bigint;
  decimals: number;
  price: bigint;
  // The collateral factor in bps, from the dynamic config the USER is bound
  // to, which can lag the reserve's latest (docs/aave-gold.md, "Dynamic risk
  // configuration").
  collateralFactorBps: bigint;
  // Supplying does not enable collateral. A supply that was never enabled
  // backs nothing, and the position math has to say so rather than show
  // borrowing power that a borrow would then revert on.
  usingAsCollateral: boolean;
}

export interface AaveGoldPositionMath {
  collateralAtomic: bigint;
  // The market's own debt, atomic. Other reserves' debt still counts against
  // health (see `totalDebtValue`) but is not repayable through this card.
  debtAtomic: bigint;
  // Collateral value in USD, ORACLE_DECIMALS places (so 1e8 is one dollar).
  // Reported in the oracle's own unit rather than in debt tokens because the
  // debt asset is not exactly a dollar and the liquidation check uses USD.
  collateralValueUsd: bigint;
  // All debt across reserves in the same unit.
  totalDebtValueUsd: bigint;
  // The most debt this collateral supports, in the market's debt token,
  // rounded down. Borrowing all of it lands exactly on health 1.0, which is
  // the liquidation threshold: there is no separate LTV in Aave V4.
  maxBorrowAtomic: bigint;
  availableToBorrowAtomic: bigint;
  // Collateral removable while keeping health at or above 1.0, rounded against
  // the user.
  withdrawableCollateralAtomic: bigint;
  // debt / collateral value. Null with no collateral counted.
  ltv: number | null;
  // Health in WAD, exactly as the contract computes it from these inputs, and
  // null with no debt (the contract returns uint256 max; the UI shows "no
  // debt"). The route reports the chain's own figure beside this one.
  healthFactorWad: bigint | null;
  healthFactor: number | null;
  // Collateral price at which health crosses 1.0, ORACLE_DECIMALS places,
  // rounded up. Null with no debt or no counted collateral.
  liquidationPriceRaw: bigint | null;
  liquidationPrice: number | null;
}

// Price a position with one collateral reserve and any number of debts.
export function priceAaveGoldPosition(args: {
  collateral: AaveCollateralInput;
  // Every reserve the user owes on, the market's own debt reserve included.
  debts: AaveDebtInput[];
  // Which entry of `debts` is this market's debt reserve, so the market-local
  // figures can be split out. Undefined when the user owes nothing there.
  marketDebt?: AaveDebtInput;
  // The debt token this market draws, for sizing `maxBorrowAtomic`.
  debtDecimals: number;
  debtPrice: bigint;
}): AaveGoldPositionMath {
  const { collateral } = args;

  // Collateral only counts when enabled and when its factor is above zero,
  // mirroring the two guards in _processUserAccountData.
  const counted =
    collateral.usingAsCollateral && collateral.collateralFactorBps > 0n;
  const collateralValue = counted
    ? toValue(collateral.atomic, collateral.decimals, collateral.price)
    : 0n;
  const weighted = collateral.collateralFactorBps * collateralValue;

  // Debt at full precision: the contract uses shares × index without rounding.
  // `getUserTotalDebt` hands back the rounded-up asset amount, so scaling it
  // to RAY here overstates debt by less than one atomic unit, which is the
  // safe direction.
  let totalDebtValueRay = 0n;
  for (const d of args.debts) {
    totalDebtValueRay += toValue(d.atomic * RAY, d.decimals, d.price);
  }

  const healthFactorWad =
    totalDebtValueRay > 0n
      ? mulDivDown(weighted * BPS_TO_WAD, RAY, totalDebtValueRay)
      : null;

  // Health is floor(weighted × 1e14 × RAY / totalDebtValueRay) and stays at or
  // above WAD while totalDebtValue ≤ weighted / BPS, that is while the debt's
  // Value is at most the collateral's Value times the factor. The most this
  // collateral supports, in the market's debt token, rounded down.
  const maxDebtValue = weighted / BPS;
  const maxBorrowAtomic = fromValue(
    maxDebtValue,
    args.debtDecimals,
    args.debtPrice,
    "down",
  );
  const totalDebtValue = totalDebtValueRay / RAY;
  const totalDebtInDebtToken = fromValue(
    totalDebtValue,
    args.debtDecimals,
    args.debtPrice,
    "up",
  );
  const availableToBorrowAtomic =
    maxBorrowAtomic > totalDebtInDebtToken
      ? maxBorrowAtomic - totalDebtInDebtToken
      : 0n;

  // Collateral that must stay: the Value that keeps collateralFactor ×
  // collateralValue ≥ totalDebtValue, rounded up, then converted back to
  // tokens rounded up. Solved from the RAY-scaled debt so no precision is lost
  // before the division.
  let withdrawableCollateralAtomic = collateral.atomic;
  if (totalDebtValueRay > 0n) {
    if (!counted) {
      // Debt exists but this collateral is not what backs it (or backs nothing
      // at all). The contract would let it leave only if other collateral
      // covers the debt, which this single-reserve view cannot see; refuse.
      withdrawableCollateralAtomic = 0n;
    } else {
      const requiredValue = mulDivUp(
        totalDebtValueRay,
        BPS,
        collateral.collateralFactorBps * RAY,
      );
      const required = fromValue(
        requiredValue,
        collateral.decimals,
        collateral.price,
        "up",
      );
      withdrawableCollateralAtomic =
        collateral.atomic > required ? collateral.atomic - required : 0n;
    }
  }

  // Solve collateralFactor × toValue(collateral, price) = totalDebtValue for
  // the price, rounded up so the reported figure is never below the one the
  // contract would liquidate at.
  const liquidationPriceRaw =
    totalDebtValueRay > 0n && counted && collateral.atomic > 0n
      ? mulDivUp(
          totalDebtValueRay,
          BPS,
          collateral.collateralFactorBps *
            RAY *
            collateral.atomic *
            10n ** BigInt(18 - collateral.decimals),
        )
      : null;

  const usdScale = VALUE_PER_USD / 10n ** 8n; // Value → 8-decimal USD
  const collateralValueUsd = collateralValue / usdScale;
  const totalDebtValueUsd = totalDebtValue / usdScale;

  return {
    collateralAtomic: collateral.atomic,
    debtAtomic: args.marketDebt?.atomic ?? 0n,
    collateralValueUsd,
    totalDebtValueUsd,
    maxBorrowAtomic,
    availableToBorrowAtomic,
    withdrawableCollateralAtomic,
    ltv:
      collateralValue > 0n
        ? Number(totalDebtValue) / Number(collateralValue)
        : null,
    healthFactorWad,
    healthFactor:
      healthFactorWad === null ? null : Number(healthFactorWad) / Number(WAD),
    liquidationPriceRaw,
    liquidationPrice:
      liquidationPriceRaw === null
        ? null
        : Number(liquidationPriceRaw) / 10 ** 8,
  };
}

// ── rates ──────────────────────────────────────────────────────────────────

// The hub's `drawnRate` is an annual rate in RAY. Between writes the index
// grows linearly at that rate and compounds on every write, which on an
// active hub is many times a day, so the effective annual cost sits between
// the simple rate and continuous compounding. Both are returned: the simple
// rate is what pro.aave.com prints, and the compounded figure is the
// convention every other rate in this app follows.
export function borrowAprFromDrawnRate(drawnRateRay: bigint): number {
  return Number(drawnRateRay) / Number(RAY);
}

export function borrowApyFromDrawnRate(drawnRateRay: bigint): number {
  return Math.expm1(borrowAprFromDrawnRate(drawnRateRay));
}

// ── liquidation ────────────────────────────────────────────────────────────

// `maxLiquidationBonus` is stored as 100_00 + bonus, so 10_666 is a 6.66%
// bonus. The bonus a liquidator actually earns is a Dutch auction between a
// floor at health 1.0 and the maximum at `healthFactorForMaxBonus`:
//
//   floor = (max − 100%) × liquidationBonusFactor
export function liquidationBonusRange(args: {
  maxLiquidationBonusBps: bigint;
  liquidationBonusFactorBps: bigint;
}): { minBps: number; maxBps: number } {
  const max = args.maxLiquidationBonusBps - BPS;
  if (max <= 0n) return { minBps: 0, maxBps: 0 };
  const min = (max * args.liquidationBonusFactorBps) / BPS;
  return { minBps: Number(min), maxBps: Number(max) };
}

// An oracle price as a plain USD number.
export function oraclePriceToUsd(price: bigint): number {
  return Number(price) / 10 ** 8;
}

// The debt this market should pre-fill: the protocol limit less the shared
// buffer, so a user does not land on the liquidation threshold by accident.
// Same buffer the Morpho card uses, so the two gold venues suggest the same
// thing for the same collateral.
export function suggestedAaveBorrowAtomic(math: AaveGoldPositionMath): bigint {
  const ceiling = math.availableToBorrowAtomic;
  return (ceiling * (BPS - BigInt(SUGGESTED_LTV_BUFFER_BPS))) / BPS;
}
