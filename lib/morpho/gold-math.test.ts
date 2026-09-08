import { describe, expect, it } from "vitest";

import {
  ORACLE_PRICE_SCALE,
  WAD,
  XAUT_USDT_MARKET,
  type MorphoBlueMarket,
} from "./gold-market";
import {
  SUGGESTED_LTV_BUFFER_BPS,
  accrueInterest,
  borrowApyFromRate,
  oraclePriceToUnitPrice,
  priceGoldPosition,
  suggestedBorrowAtomic,
  toAssetsUp,
  toSharesUp,
  type MarketState,
} from "./gold-math";

// These tests exist because gold-math.ts is a port, and a port has exactly one
// failure mode worth guarding: it stops matching the contract. Rounding
// direction is the whole risk. Debt rounds UP and borrowing power rounds DOWN,
// and reversing either produces a position Morpho calls unhealthy while our UI
// calls it fine. Almost every assertion below is ultimately about that.
//
// Two fixtures, for two different jobs.

// ── fixture 1: a real market, frozen ───────────────────────────────────────
//
// Read from the Morpho Blue singleton on Ethereum at block 25,929,208
// (2026-09-07) with the same eth_calls scripts/morpho-gold-check.mts makes.
// Frozen so the arithmetic is tested against real magnitudes: a 2.45M USDT
// borrow side, an 18-decimal-ish share count, a live oracle price and a live
// IRM rate. Nothing here is a round number, which is the point.
const LIVE: MarketState = {
  totalSupplyAssets: 2_755_658_334_829n,
  totalSupplyShares: 2_579_907_442_080_245_000n,
  totalBorrowAssets: 2_457_919_191_178n,
  totalBorrowShares: 2_279_436_254_659_587_376n,
  lastUpdate: 1_788_827_747n,
  fee: 0n,
};
const LIVE_ORACLE_PRICE = 4_425_850_000_000_000_000_000_000_000_000_000_000_000n;
const LIVE_BORROW_RATE_PER_SECOND = 1_402_397_087n;
const LIVE_BLOCK_TIMESTAMP = 1_788_829_079n;

// ── fixture 2: the documented cross-check ──────────────────────────────────
//
// docs/morpho-gold.md records this port being verified against Morpho's own
// indexer on a live $450k position (0x68b5…66b1, 2026-08-26):
//
//   collateral 168.1 XAUt | debt 453,682.872699 USDT | health 1.3226039296
//
// The raw chain inputs behind those figures were not captured at the time, so
// they are RECONSTRUCTED here: share totals in Morpho's exact 1e6 initial ratio
// (which makes toAssetsUp land on the recorded debt exactly), and the oracle
// price the recorded collateral/debt/health triple implies, $4,635.79/oz.
//
// That reconstruction is not circular in the part that matters. The oracle
// price is derived from collateral and health alone; whether feeding it back
// through priceGoldPosition reproduces the recorded DEBT and the recorded
// HEALTH together is a genuine test of the LLTV application, the 1e36 oracle
// scale, the virtual-share conversion and the rounding directions at once.
const DOC_COLLATERAL_ATOMIC = 168_100_000n; // 168.1 XAUt at 6dp
const DOC_DEBT_ATOMIC = 453_682_872_699n; // 453,682.872699 USDT at 6dp
const DOC_HEALTH = 1.3226039296;
const DOC_ORACLE_PRICE =
  4_635_790_000_000_000_000_000_000_000_000_000_000_000n;
const DOC_STATE: MarketState = {
  ...LIVE,
  totalBorrowAssets: 2_457_919_191_178n,
  totalBorrowShares: 2_457_919_191_178_000_000n,
  fee: 0n,
};
// In a market whose shares:assets ratio is exactly 1e6 (Morpho's seed ratio),
// toAssetsUp(shares) collapses to ceil(shares / 1e6), so this is the share
// balance that owes exactly the recorded debt.
const DOC_BORROW_SHARES = DOC_DEBT_ATOMIC * 1_000_000n;

function marketWithLltv(lltv: bigint): MorphoBlueMarket {
  return { ...XAUT_USDT_MARKET, lltv };
}

describe("SharesMathLib conversions", () => {
  it("rounds shares-to-assets UP, never in the borrower's favour", () => {
    // 1 share against a ratio that cannot divide evenly. The exact quotient is
    // strictly between 0 and 1; a borrower must owe 1, not 0.
    expect(toAssetsUp(1n, 3n, 7n)).toBe(1n);

    // General form: the rounded-up result is never below the exact quotient.
    const shares = 123_456_789n;
    const exact =
      (shares * (LIVE.totalBorrowAssets + 1n)) /
      (LIVE.totalBorrowShares + 1_000_000n);
    const up = toAssetsUp(
      shares,
      LIVE.totalBorrowAssets,
      LIVE.totalBorrowShares,
    );
    expect(up).toBeGreaterThanOrEqual(exact);
    expect(up - exact).toBeLessThanOrEqual(1n);
  });

  it("rounds assets-to-shares UP as well", () => {
    // 1 asset against totals of 7 assets / 3 shares. The virtuals dominate at
    // this magnitude: exact = 1 * (3 + 1e6) / (7 + 1) = 125_000.375, so a
    // rounding-up conversion owes 125_001 and a floor would owe 125_000.
    expect(toSharesUp(1n, 7n, 3n)).toBe(125_001n);

    const assets = 1_000_001n;
    const exact =
      (assets * (LIVE.totalBorrowShares + 1_000_000n)) /
      (LIVE.totalBorrowAssets + 1n);
    expect(
      toSharesUp(assets, LIVE.totalBorrowAssets, LIVE.totalBorrowShares),
    ).toBeGreaterThanOrEqual(exact);
  });

  it("applies the virtual shares and asset on an empty market", () => {
    // Morpho seeds 1e6 virtual shares against 1 virtual asset. On a market with
    // no real liquidity that ratio IS the price, so 1e6 shares owe 1 asset.
    // Dropping the virtuals would divide by zero or return 0.
    expect(toAssetsUp(1_000_000n, 0n, 0n)).toBe(1n);
    expect(toSharesUp(1n, 0n, 0n)).toBe(1_000_000n);
  });

  it("returns zero only for zero shares", () => {
    expect(toAssetsUp(0n, LIVE.totalBorrowAssets, LIVE.totalBorrowShares)).toBe(
      0n,
    );
    // Any non-zero share balance owes at least one atomic unit.
    expect(
      toAssetsUp(1n, LIVE.totalBorrowAssets, LIVE.totalBorrowShares),
    ).toBeGreaterThan(0n);
  });
});

describe("accrueInterest", () => {
  it("is a no-op when no time has passed", () => {
    expect(
      accrueInterest(LIVE, LIVE_BORROW_RATE_PER_SECOND, LIVE.lastUpdate),
    ).toBe(LIVE);
  });

  it("is a no-op when the clock runs backwards", () => {
    // A server clock behind the last on-chain write must not un-accrue debt.
    expect(
      accrueInterest(
        LIVE,
        LIVE_BORROW_RATE_PER_SECOND,
        LIVE.lastUpdate - 3_600n,
      ),
    ).toBe(LIVE);
  });

  it("is a no-op on a market with nothing borrowed", () => {
    const empty: MarketState = { ...LIVE, totalBorrowAssets: 0n };
    expect(
      accrueInterest(empty, LIVE_BORROW_RATE_PER_SECOND, LIVE.lastUpdate + 1n),
    ).toBe(empty);
  });

  it("truncates the Taylor series at three terms, and floors", () => {
    // Hand-computed against Morpho's MathLib, which is the only way to prove
    // the truncation rather than assume it:
    //   first  = rate*elapsed              = 1e9 * 1e3        = 1e12
    //   second = first^2 / (2*WAD)         = 1e24 / 2e18      = 500_000
    //   third  = second*first / (3*WAD)    = 5e17 / 3e18      = 0  (floored)
    //   factor = 1_000_000_500_000
    //   interest = wMulDown(1e12, factor)  = 1.0000005e24/1e18 = 1_000_000 (floored)
    // A four-term expansion, or rounding instead of flooring, both miss this.
    const state: MarketState = {
      totalSupplyAssets: 2_000_000_000_000n,
      totalSupplyShares: 2_000_000_000_000_000_000n,
      totalBorrowAssets: 1_000_000_000_000n,
      totalBorrowShares: 1_000_000_000_000_000_000n,
      lastUpdate: 0n,
      fee: 0n,
    };
    const next = accrueInterest(state, 1_000_000_000n, 1_000n);

    expect(next.totalBorrowAssets - state.totalBorrowAssets).toBe(1_000_000n);
    // Interest lands on both sides of the book, and only on the assets.
    expect(next.totalSupplyAssets - state.totalSupplyAssets).toBe(1_000_000n);
    expect(next.totalBorrowShares).toBe(state.totalBorrowShares);
    expect(next.lastUpdate).toBe(1_000n);
  });

  it("mints supply shares for the fee, priced excluding the fee itself", () => {
    const withFee: MarketState = {
      totalSupplyAssets: 2_000_000_000_000n,
      totalSupplyShares: 2_000_000_000_000_000_000n,
      totalBorrowAssets: 1_000_000_000_000n,
      totalBorrowShares: 1_000_000_000_000_000_000n,
      lastUpdate: 0n,
      fee: WAD / 10n, // 10%
    };
    const noFee: MarketState = { ...withFee, fee: 0n };

    const a = accrueInterest(withFee, 1_000_000_000n, 1_000n);
    const b = accrueInterest(noFee, 1_000_000_000n, 1_000n);

    // The fee does not change how much interest accrues, only who owns it.
    expect(a.totalBorrowAssets).toBe(b.totalBorrowAssets);
    expect(a.totalSupplyAssets).toBe(b.totalSupplyAssets);
    // It does mint new supply shares to the fee recipient.
    expect(a.totalSupplyShares).toBeGreaterThan(b.totalSupplyShares);

    // Priced against supply EXCLUDING the fee, so the fee earner takes no cut
    // of their own fee. Pricing it against the full post-fee supply would mint
    // strictly fewer shares; assert we are on the larger side of that.
    const interest = a.totalBorrowAssets - withFee.totalBorrowAssets;
    const feeAmount = (interest * withFee.fee) / WAD;
    const mintedAgainstFullSupply =
      (feeAmount * (withFee.totalSupplyShares + 1_000_000n)) /
      (a.totalSupplyAssets + 1n);
    expect(a.totalSupplyShares - withFee.totalSupplyShares).toBeGreaterThan(
      mintedAgainstFullSupply,
    );
  });

  it("grows debt monotonically with elapsed time", () => {
    const hour = accrueInterest(
      LIVE,
      LIVE_BORROW_RATE_PER_SECOND,
      LIVE.lastUpdate + 3_600n,
    );
    const day = accrueInterest(
      LIVE,
      LIVE_BORROW_RATE_PER_SECOND,
      LIVE.lastUpdate + 86_400n,
    );
    expect(hour.totalBorrowAssets).toBeGreaterThan(LIVE.totalBorrowAssets);
    expect(day.totalBorrowAssets).toBeGreaterThan(hour.totalBorrowAssets);
  });

  it("makes stale totals UNDER-report debt, the documented failure", () => {
    // docs/morpho-gold.md: reading debt from un-accrued totals understates it,
    // which reads as a healthier position than the borrower has. This pins the
    // direction of that error so the read path can never quietly drop accrual.
    const accrued = accrueInterest(
      LIVE,
      LIVE_BORROW_RATE_PER_SECOND,
      LIVE_BLOCK_TIMESTAMP,
    );
    const position = {
      supplyShares: 0n,
      borrowShares: 1_000_000_000_000_000n,
      collateral: DOC_COLLATERAL_ATOMIC,
    };

    const stale = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: LIVE,
      oraclePrice: LIVE_ORACLE_PRICE,
    });
    const fresh = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: accrued,
      oraclePrice: LIVE_ORACLE_PRICE,
    });

    expect(fresh.debtAtomic).toBeGreaterThan(stale.debtAtomic);
    expect(fresh.healthFactor!).toBeLessThan(stale.healthFactor!);
  });
});

describe("borrowApyFromRate", () => {
  it("compounds the live per-second rate into an annual decimal", () => {
    // 1_402_397_087 / 1e18 per second over 31,536,000 seconds, compounded.
    const apy = borrowApyFromRate(LIVE_BORROW_RATE_PER_SECOND);
    const perSecond = 1_402_397_087 / 1e18;
    expect(apy).toBeCloseTo(Math.expm1(perSecond * 31_536_000), 12);
    // Sanity: a mid-single-digit borrow rate, returned as a decimal not a percent.
    expect(apy).toBeGreaterThan(0.04);
    expect(apy).toBeLessThan(0.05);
  });

  it("returns zero for a zero rate", () => {
    expect(borrowApyFromRate(0n)).toBe(0);
  });

  it("is monotonic in the rate", () => {
    expect(borrowApyFromRate(2_000_000_000n)).toBeGreaterThan(
      borrowApyFromRate(1_000_000_000n),
    );
  });

  it("compounds rather than merely multiplying", () => {
    // A large rate is where simple annualisation and compounding diverge
    // visibly. expm1(x) > x for x > 0.
    const rate = 30_000_000_000n; // ~94.6% simple
    const simple = (Number(rate) / 1e18) * 31_536_000;
    expect(borrowApyFromRate(rate)).toBeGreaterThan(simple);
  });
});

describe("priceGoldPosition", () => {
  const position = {
    supplyShares: 0n,
    borrowShares: DOC_BORROW_SHARES,
    collateral: DOC_COLLATERAL_ATOMIC,
  };

  it("reproduces the figures verified against Morpho's indexer", () => {
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });

    expect(math.collateralAtomic).toBe(DOC_COLLATERAL_ATOMIC);
    expect(math.debtAtomic).toBe(DOC_DEBT_ATOMIC);
    // docs/morpho-gold.md claims agreement to the seventh decimal of health.
    expect(math.healthFactor!).toBeCloseTo(DOC_HEALTH, 7);
    // LTV is debt over collateral value, and must sit below the 77% LLTV for a
    // position this healthy.
    expect(math.ltv!).toBeCloseTo(0.77 / DOC_HEALTH, 7);
    expect(math.ltv!).toBeLessThan(0.77);
  });

  it("reports no debt as null, not as infinite health", () => {
    // The "nothing to liquidate" case. A UI that reads null as Infinity shows a
    // health bar for a position that does not exist.
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: { supplyShares: 0n, borrowShares: 0n, collateral: 1_000_000n },
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    expect(math.debtAtomic).toBe(0n);
    expect(math.healthFactor).toBeNull();
    expect(math.liquidationOraclePrice).toBeNull();
    expect(math.ltv).toBe(0);
    // With no debt the whole collateral is free to leave.
    expect(math.withdrawableCollateralAtomic).toBe(1_000_000n);
  });

  it("reports no collateral as a null LTV rather than a division by zero", () => {
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: { supplyShares: 0n, borrowShares: 0n, collateral: 0n },
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    expect(math.ltv).toBeNull();
    expect(math.collateralValueAtomic).toBe(0n);
    expect(math.maxBorrowAtomic).toBe(0n);
    expect(math.availableToBorrowAtomic).toBe(0n);
  });

  it("rounds borrowing power DOWN and debt UP", () => {
    // Collateral chosen so collateral * price / 1e36 does not divide evenly.
    const odd = {
      supplyShares: 0n,
      borrowShares: 1n,
      collateral: 999_999n,
    };
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: odd,
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });

    const exactValue =
      (odd.collateral * DOC_ORACLE_PRICE) / ORACLE_PRICE_SCALE;
    expect(math.collateralValueAtomic).toBe(exactValue); // floor
    expect(math.maxBorrowAtomic).toBe(
      (exactValue * XAUT_USDT_MARKET.lltv) / WAD,
    ); // floor
    // One share still owes a whole atomic unit.
    expect(math.debtAtomic).toBeGreaterThan(0n);
  });

  it("never offers negative headroom", () => {
    // An underwater position: tiny collateral against the documented debt.
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: { ...position, collateral: 1_000n },
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    expect(math.debtAtomic).toBeGreaterThan(math.maxBorrowAtomic);
    expect(math.availableToBorrowAtomic).toBe(0n);
    expect(math.withdrawableCollateralAtomic).toBe(0n);
    expect(math.healthFactor!).toBeLessThan(1);
  });

  it("puts the position exactly at the limit if the headroom is drawn", () => {
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    // Borrowing every available unit leaves debt == maxBorrow, i.e. health 1.
    expect(math.debtAtomic + math.availableToBorrowAtomic).toBe(
      math.maxBorrowAtomic,
    );
  });

  it("solves the liquidation price so health crosses 1 there", () => {
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    const liq = math.liquidationOraclePrice!;
    expect(liq).toBeGreaterThan(0n);
    // Below today's price, since the position is healthy.
    expect(liq).toBeLessThan(DOC_ORACLE_PRICE);

    // At the solved price the position sits on the threshold, and the residual
    // error is on the SAFE side. The solve rounds the price up, but pricing it
    // back floors twice (collateralValue, then maxBorrow), and the two floors
    // pull health a hair back under 1 rather than over it. So the warning fires
    // fractionally early, never fractionally late, which is the same direction
    // the module rounds debt in and the only acceptable direction here.
    const atLiq = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: liq,
    });
    expect(atLiq.healthFactor!).toBeLessThanOrEqual(1);
    expect(atLiq.healthFactor!).toBeGreaterThan(1 - 1e-9);

    // A percent above it, the position is comfortably solvent.
    const above = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: (liq * 101n) / 100n,
    });
    expect(above.healthFactor!).toBeGreaterThan(1);

    // A percent below it, the position is genuinely liquidatable.
    const below = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: (liq * 99n) / 100n,
    });
    expect(below.healthFactor!).toBeLessThan(1);
  });

  it("leaves exactly enough collateral behind to cover the debt", () => {
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    const withdrawable = math.withdrawableCollateralAtomic;
    expect(withdrawable).toBeGreaterThan(0n);
    expect(withdrawable).toBeLessThan(DOC_COLLATERAL_ATOMIC);

    // Withdrawing all of it must leave the position solvent.
    const after = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: { ...position, collateral: DOC_COLLATERAL_ATOMIC - withdrawable },
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    expect(after.healthFactor!).toBeGreaterThanOrEqual(1);

    // Withdrawing one atomic unit more must not.
    const overdrawn = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: {
        ...position,
        collateral: DOC_COLLATERAL_ATOMIC - withdrawable - 1n,
      },
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    expect(overdrawn.healthFactor!).toBeLessThan(1);
  });

  it("treats a zero oracle price as no borrowing power, not free money", () => {
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: 0n,
    });
    expect(math.collateralValueAtomic).toBe(0n);
    expect(math.maxBorrowAtomic).toBe(0n);
    expect(math.availableToBorrowAtomic).toBe(0n);
    expect(math.ltv).toBeNull();
    // Debt still stands, and none of the collateral can leave.
    expect(math.debtAtomic).toBe(DOC_DEBT_ATOMIC);
    expect(math.withdrawableCollateralAtomic).toBe(0n);
  });

  it("scales borrowing power with LLTV", () => {
    const at50 = priceGoldPosition({
      market: marketWithLltv(WAD / 2n),
      position,
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    const at77 = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position,
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    expect(at50.maxBorrowAtomic).toBeLessThan(at77.maxBorrowAtomic);
    expect(at50.maxBorrowAtomic).toBe(at50.collateralValueAtomic / 2n);
  });

  it("prices a real position against the live market snapshot", () => {
    // Same arithmetic run against the frozen chain read rather than the
    // reconstructed vector: 1 XAUt of collateral, a share of the real borrow
    // book, at the real oracle price and the real block timestamp.
    const state = accrueInterest(
      LIVE,
      LIVE_BORROW_RATE_PER_SECOND,
      LIVE_BLOCK_TIMESTAMP,
    );
    const math = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: {
        supplyShares: 0n,
        borrowShares: 1_000_000_000_000_000n,
        collateral: 1_000_000n,
      },
      state,
      oraclePrice: LIVE_ORACLE_PRICE,
    });

    // One ounce of collateral is worth the oracle's gold price, in USDT atoms.
    expect(math.collateralValueAtomic).toBe(4_425_850_000n);
    expect(math.maxBorrowAtomic).toBe((4_425_850_000n * 77n) / 100n);
    expect(math.debtAtomic).toBeGreaterThan(0n);
    expect(math.healthFactor).not.toBeNull();
  });
});

describe("suggestedBorrowAtomic", () => {
  const math = priceGoldPosition({
    market: XAUT_USDT_MARKET,
    position: {
      supplyShares: 0n,
      borrowShares: 0n,
      collateral: DOC_COLLATERAL_ATOMIC,
    },
    state: DOC_STATE,
    oraclePrice: DOC_ORACLE_PRICE,
  });

  it("targets LLTV less the buffer, i.e. 57% at a 77% LLTV", () => {
    expect(SUGGESTED_LTV_BUFFER_BPS).toBe(2_000);
    const suggested = suggestedBorrowAtomic(math, XAUT_USDT_MARKET);
    const impliedLtv =
      Number(suggested) / Number(math.collateralValueAtomic);
    expect(impliedLtv).toBeCloseTo(0.57, 6);
  });

  it("stays strictly inside the protocol limit", () => {
    const suggested = suggestedBorrowAtomic(math, XAUT_USDT_MARKET);
    expect(suggested).toBeLessThan(math.maxBorrowAtomic);
    expect(suggested).toBeLessThanOrEqual(math.availableToBorrowAtomic);
  });

  it("subtracts what is already owed", () => {
    const withDebt = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: {
        supplyShares: 0n,
        borrowShares: DOC_BORROW_SHARES,
        collateral: DOC_COLLATERAL_ATOMIC,
      },
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    expect(suggestedBorrowAtomic(withDebt, XAUT_USDT_MARKET)).toBeLessThan(
      suggestedBorrowAtomic(math, XAUT_USDT_MARKET),
    );
  });

  it("returns zero rather than a negative when debt already exceeds the target", () => {
    const overdrawn = priceGoldPosition({
      market: XAUT_USDT_MARKET,
      position: {
        supplyShares: 0n,
        borrowShares: DOC_BORROW_SHARES,
        collateral: DOC_COLLATERAL_ATOMIC / 2n,
      },
      state: DOC_STATE,
      oraclePrice: DOC_ORACLE_PRICE,
    });
    expect(suggestedBorrowAtomic(overdrawn, XAUT_USDT_MARKET)).toBe(0n);
  });

  it("returns zero when the buffer swallows the whole LLTV", () => {
    // A market whose LLTV is below the 20% buffer has no safe suggestion.
    const tight = marketWithLltv(WAD / 10n); // 10%
    expect(suggestedBorrowAtomic(math, tight)).toBe(0n);
  });
});

describe("oraclePriceToUnitPrice", () => {
  it("reads the live oracle as a dollar gold price", () => {
    expect(oraclePriceToUnitPrice(LIVE_ORACLE_PRICE, 6, 6)).toBeCloseTo(
      4_425.85,
      6,
    );
  });

  it("reads the reconstructed oracle as the documented gold price", () => {
    expect(oraclePriceToUnitPrice(DOC_ORACLE_PRICE, 6, 6)).toBeCloseTo(
      4_635.79,
      6,
    );
  });

  it("misprices by 10^12 if XAUt is read as 18 decimals", () => {
    // The trap documented in gold-market.ts and docs/morpho-gold.md. XAUt is
    // the 6-decimal exception among 18-decimal Ethereum tokens, and reading it
    // wrong quotes gold as effectively free. Pinned so the constant cannot
    // drift back without a test failing.
    const correct = oraclePriceToUnitPrice(LIVE_ORACLE_PRICE, 6, 6);
    const wrong = oraclePriceToUnitPrice(LIVE_ORACLE_PRICE, 18, 6);
    expect(wrong / correct).toBeCloseTo(1e12, 0);
  });

  it("returns zero for a zero price", () => {
    expect(oraclePriceToUnitPrice(0n, 6, 6)).toBe(0);
  });
});
