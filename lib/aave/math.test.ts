import { describe, expect, it } from "vitest";

import {
  cooldownPhase,
  formatDuration,
  rewardAprFromEmission,
  supplyApyFromLiquidityRate,
  umbrellaTotalApy,
} from "./math";

describe("supplyApyFromLiquidityRate", () => {
  it("is zero for a zero rate", () => {
    expect(supplyApyFromLiquidityRate(0n)).toBe(0);
  });

  it("compounds a 5% ray APR per second the way Aave's UI does", () => {
    // 0.05 * 1e27
    const apy = supplyApyFromLiquidityRate(50_000_000_000_000_000_000_000_000n);
    // e^0.05 - 1 = 5.127%; per-second compounding lands within a hair of it.
    expect(apy).toBeGreaterThan(0.05127);
    expect(apy).toBeLessThan(0.05128);
  });

  it("matches a live reading: 3.58% APR is 3.64% APY", () => {
    const apy = supplyApyFromLiquidityRate(35_800_000_000_000_000_000_000_000n);
    expect(apy * 100).toBeCloseTo(3.645, 2);
  });
});

describe("rewardAprFromEmission", () => {
  it("prices a year of emission over the staked value", () => {
    // 1 USDC-denominated reward per second on $31.536M staked is exactly 100%.
    const apr = rewardAprFromEmission({
      emissionPerSecond: 1_000_000n,
      rewardDecimals: 6,
      rewardPriceE8: 100_000_000n,
      stakedAtomic: 31_536_000_000_000n,
      stakedDecimals: 6,
      stakedPriceE8: 100_000_000n,
    });
    expect(apr).toBeCloseTo(1, 9);
  });

  it("is zero on an empty stake and on an ended distribution", () => {
    expect(
      rewardAprFromEmission({
        emissionPerSecond: 1n,
        rewardDecimals: 6,
        rewardPriceE8: 100_000_000n,
        stakedAtomic: 0n,
        stakedDecimals: 6,
        stakedPriceE8: 100_000_000n,
      }),
    ).toBe(0);
    expect(
      rewardAprFromEmission({
        emissionPerSecond: 0n,
        rewardDecimals: 6,
        rewardPriceE8: 100_000_000n,
        stakedAtomic: 1_000_000n,
        stakedDecimals: 6,
        stakedPriceE8: 100_000_000n,
      }),
    ).toBe(0);
  });

  it("handles a reward token with different decimals from the stake", () => {
    // 18-decimal reward worth $2, emitted at 0.5/s, over $31.536M staked: 100%.
    const apr = rewardAprFromEmission({
      emissionPerSecond: 500_000_000_000_000_000n,
      rewardDecimals: 18,
      rewardPriceE8: 200_000_000n,
      stakedAtomic: 31_536_000_000_000n,
      stakedDecimals: 6,
      stakedPriceE8: 100_000_000n,
    });
    expect(apr).toBeCloseTo(1, 9);
  });
});

describe("umbrellaTotalApy", () => {
  it("adds the two streams", () => {
    expect(umbrellaTotalApy(0.036, 0.042)).toBeCloseTo(0.078, 12);
  });
});

describe("cooldownPhase", () => {
  const twentyDays = 20 * 86_400;
  const twoDays = 2 * 86_400;
  const started = 1_760_000_000;
  const snapshot = {
    amount: 5_000_000n,
    endOfCooldown: started + twentyDays,
    withdrawalWindow: twoDays,
  };

  it("is none without a snapshot", () => {
    expect(
      cooldownPhase({ amount: 0n, endOfCooldown: 0, withdrawalWindow: 0 }, started),
    ).toEqual({ phase: "none" });
  });

  it("is cooling before the end of cooldown", () => {
    expect(cooldownPhase(snapshot, started + 1)).toEqual({
      phase: "cooling",
      redeemableAt: started + twentyDays,
      shares: 5_000_000n,
    });
  });

  it("opens the window exactly at endOfCooldown and keeps it open to the end", () => {
    expect(cooldownPhase(snapshot, started + twentyDays).phase).toBe("window");
    expect(cooldownPhase(snapshot, started + twentyDays + twoDays).phase).toBe(
      "window",
    );
  });

  it("expires one second after the window", () => {
    expect(cooldownPhase(snapshot, started + twentyDays + twoDays + 1)).toEqual({
      phase: "expired",
      shares: 5_000_000n,
    });
  });
});

describe("formatDuration", () => {
  it("reads as days, hours, or minutes", () => {
    expect(formatDuration(20 * 86_400)).toBe("20 days");
    expect(formatDuration(2 * 86_400 + 3 * 3_600)).toBe("2 days 3 hours");
    expect(formatDuration(45 * 60)).toBe("45 minutes");
    expect(formatDuration(1)).toBe("0 minutes");
  });
});
