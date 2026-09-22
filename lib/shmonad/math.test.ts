import { describe, expect, it } from "vitest";

import {
  apyFromGrowth,
  feeRateAtUtilization,
  feeRateFromRay,
  instantCapacityShares,
  monToShares,
  rateMonPerShare,
  sharesToMon,
  stakeableAfterReserve,
  unstakePhase,
  withTolerance,
} from "./math";

// Every figure below was read from the shMON contract on Monad mainnet on
// 2026-09-22 at block 106,886,926 and is recorded in docs/shmonad-plan.md.
// The tests pin the math to those readings rather than to whatever the
// functions return today, so they catch drift instead of restating it.

const CONVERT_TO_ASSETS_1E18 = 1623863471383778647n; // MON per shMON
const PREVIEW_DEPOSIT_1E18 = 615771599201007806n; // shMON per MON
const FEE_RATE_RAY = 9185666628676110910000000n; // 0.9186%
const SLOPE_RAY = 10000000000000000000000000n; // 1.00%
const Y_INTERCEPT_RAY = 50000000000000000000000n; // 0.005%
const UTILIZATION_WAD = 913566640436094698n; // 91.36%
const POOL_AVAILABLE_MON = 581891603294207565780929n;

describe("exchange rate", () => {
  it("reads the rate as MON per shMON", () => {
    expect(rateMonPerShare(CONVERT_TO_ASSETS_1E18)).toBeCloseTo(1.623863, 6);
  });

  it("converts shares to MON and MON to shares at the contract's own figures", () => {
    expect(sharesToMon(10n ** 18n, CONVERT_TO_ASSETS_1E18)).toBe(CONVERT_TO_ASSETS_1E18);
    expect(monToShares(10n ** 18n, PREVIEW_DEPOSIT_1E18)).toBe(PREVIEW_DEPOSIT_1E18);
    // 1000 MON stakes to about 615.77 shMON, which redeems to just under
    // 1000 MON gross: the round trip rounds down at both ends.
    const shares = monToShares(1000n * 10n ** 18n, PREVIEW_DEPOSIT_1E18);
    const back = sharesToMon(shares, CONVERT_TO_ASSETS_1E18);
    expect(back).toBeLessThanOrEqual(1000n * 10n ** 18n);
    expect(back).toBeGreaterThan(999n * 10n ** 18n);
  });
});

describe("instant exit fee", () => {
  it("reads a RAY fee as a decimal", () => {
    expect(feeRateFromRay(FEE_RATE_RAY)).toBeCloseTo(0.0091857, 7);
  });

  it("reproduces the contract's fee from the curve and the utilization", () => {
    const fee = feeRateAtUtilization(SLOPE_RAY, Y_INTERCEPT_RAY, UTILIZATION_WAD);
    // The two contract reads landed a block apart, so agreement is to a few
    // parts in a hundred million rather than exact.
    const rel = Number(fee - FEE_RATE_RAY) / Number(FEE_RATE_RAY);
    expect(Math.abs(rel)).toBeLessThan(1e-6);
  });

  it("caps the fee at intercept plus slope past full utilization", () => {
    const twice = feeRateAtUtilization(SLOPE_RAY, Y_INTERCEPT_RAY, 2n * 10n ** 18n);
    expect(twice).toBe(SLOPE_RAY + Y_INTERCEPT_RAY);
    expect(feeRateFromRay(twice)).toBeCloseTo(0.01005, 8);
  });

  it("floors a previewed net figure by the tolerance", () => {
    expect(withTolerance(10_000n, 25)).toBe(9_975n);
  });
});

describe("APY from share price growth", () => {
  it("annualises the 7-day window measured on 2026-09-22", () => {
    // block 105,374,926 -> 106,886,926, 126.9 hours apart.
    const r = apyFromGrowth(1621184296758721965n, 1623863499756773368n, 126.9 * 3600);
    expect(r).not.toBeNull();
    expect(r!.growth).toBeCloseTo(0.001653, 5);
    expect(r!.apr).toBeCloseTo(0.1141, 3);
    expect(r!.apy).toBeCloseTo(0.1207, 3);
  });

  it("annualises the 1-day window measured the same day", () => {
    const r = apyFromGrowth(1623470602847994120n, 1623863496293943989n, 18.1 * 3600);
    expect(r!.apy).toBeCloseTo(0.124, 2);
  });

  it("returns null for inputs that cannot produce a rate", () => {
    expect(apyFromGrowth(0n, 1n, 100)).toBeNull();
    expect(apyFromGrowth(1n, 2n, 0)).toBeNull();
  });
});

describe("instant capacity", () => {
  it("caps a position at what the pool can pay at the gross rate", () => {
    const owned = 1_000_000n * 10n ** 18n; // a million shMON
    const cap = instantCapacityShares(owned, POOL_AVAILABLE_MON, CONVERT_TO_ASSETS_1E18);
    // 581,892 MON / 1.6239 MON per share = about 358,338 shares.
    expect(Number(cap) / 1e18).toBeCloseTo(358338, -1);
    expect(cap).toBeLessThan(owned);
  });

  it("returns the whole position when the pool covers it", () => {
    const owned = 100n * 10n ** 18n;
    expect(instantCapacityShares(owned, POOL_AVAILABLE_MON, CONVERT_TO_ASSETS_1E18)).toBe(owned);
  });

  it("is zero with nothing owned", () => {
    expect(instantCapacityShares(0n, POOL_AVAILABLE_MON, CONVERT_TO_ASSETS_1E18)).toBe(0n);
  });
});

describe("gas reserve", () => {
  it("keeps the reserve back and never goes negative", () => {
    const reserve = 10n ** 17n;
    expect(stakeableAfterReserve(10n ** 18n, reserve)).toBe(9n * 10n ** 17n);
    expect(stakeableAfterReserve(reserve, reserve)).toBe(0n);
    expect(stakeableAfterReserve(1n, reserve)).toBe(0n);
  });
});

describe("queued exit phase", () => {
  it("is none without a request, pending until the simulation passes, then ready", () => {
    expect(unstakePhase({ amountMon: 0n, completionEpoch: 0n }, false)).toEqual({ phase: "none" });
    expect(unstakePhase({ amountMon: 0n, completionEpoch: 1405n }, true)).toEqual({ phase: "none" });
    expect(unstakePhase({ amountMon: 5n, completionEpoch: 1409n }, false)).toEqual({
      phase: "pending",
      amountMon: 5n,
      completionEpoch: 1409n,
    });
    expect(unstakePhase({ amountMon: 5n, completionEpoch: 1409n }, true)).toEqual({
      phase: "ready",
      amountMon: 5n,
      completionEpoch: 1409n,
    });
  });
});
