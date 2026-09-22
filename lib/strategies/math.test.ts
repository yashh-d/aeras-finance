import { describe, expect, it } from "vitest";

import { safeMaxBorrowRatio, type BorrowRoute } from "@/lib/borrow/route";
import {
  defaultBorrowRatio,
  maxBorrowRatio,
  earnNetApy,
  ladderProjection,
  leverageForRatio,
  leveragePresets,
  liquidationDrop,
  maxLeverageForRoute,
  minHealth,
  positionHealth,
  ratioForLeverage,
} from "./math";

// TSLAx on Jupiter, per docs/jupiter-borrow.md: CF 65%, LT 75%.
const tsla: BorrowRoute = {
  venue: "jupiter",
  venueLabel: "Jupiter Lend",
  collateralSymbol: "TSLAx",
  collateralMint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  collateralDecimals: 8,
  collateralFactor: 0.65,
  liquidationThreshold: 0.75,
};

// SPYx on Jupiter: CF 75%, LT 85%.
const spy: BorrowRoute = { ...tsla, collateralSymbol: "SPYx", collateralFactor: 0.75, liquidationThreshold: 0.85 };

describe("leverage", () => {
  it("round-trips ratio and multiple", () => {
    expect(leverageForRatio(0.5)).toBeCloseTo(2);
    expect(ratioForLeverage(2)).toBeCloseTo(0.5);
    expect(ratioForLeverage(3)).toBeCloseTo(2 / 3);
    expect(leverageForRatio(ratioForLeverage(2.5))).toBeCloseTo(2.5);
  });

  it("matches maxLeverageForVault's buffer on the docs numbers", () => {
    // 1 / (1 - (0.65 - 0.05)) = 2.5
    expect(maxLeverageForRoute(tsla)).toBeCloseTo(2.5);
    // 1 / (1 - (0.75 - 0.05)) = 3.33
    expect(maxLeverageForRoute(spy)).toBeCloseTo(3.333, 2);
  });

  it("drops 3x where the ceiling is below it", () => {
    expect(leveragePresets(tsla)).toEqual([2, 2.5]);
    expect(leveragePresets(spy)).toEqual([2, 3, 3.3]);
  });
});

describe("borrow ratio", () => {
  it("defaults to half the collateral factor", () => {
    expect(defaultBorrowRatio(tsla)).toBeCloseTo(0.325);
  });

  it("borrows at the safe ceiling in Trader mode, floored to the slider's hundredth", () => {
    // 0.65 * 0.9 = 0.585 -> 0.58; 0.75 * 0.9 = 0.675 -> 0.67.
    expect(maxBorrowRatio(tsla)).toBeCloseTo(0.58);
    expect(maxBorrowRatio(spy)).toBeCloseTo(0.67);
    expect(maxBorrowRatio(tsla)).toBeLessThanOrEqual(safeMaxBorrowRatio(tsla));
    expect(maxBorrowRatio(spy)).toBeLessThanOrEqual(safeMaxBorrowRatio(spy));
    // Health and the liquidation drop at that ratio, so nobody reads the
    // figure as riskless: LT / ratio, and 1 - ratio / LT.
    expect(tsla.liquidationThreshold / maxBorrowRatio(tsla)).toBeCloseTo(1.293, 2);
    expect(1 - maxBorrowRatio(tsla) / tsla.liquidationThreshold).toBeCloseTo(0.227, 2);
  });
});

describe("earn", () => {
  it("earns the spread on the borrowed slice plus the collateral rate", () => {
    const net = earnNetApy({
      borrowRatio: 0.5,
      earnApy: 0.07,
      borrowApr: 0.05,
      collateralSupplyApy: 0.01,
    });
    expect(net).toBeCloseTo(0.01 + 0.5 * 0.02);
  });

  it("goes negative when borrowing costs more than the vault pays", () => {
    expect(
      earnNetApy({ borrowRatio: 0.5, earnApy: 0.04, borrowApr: 0.06, collateralSupplyApy: 0 }),
    ).toBeLessThan(0);
  });
});

describe("ladder", () => {
  it("is a geometric series that converges to equity / (1 - ratio)", () => {
    const p = ladderProjection({ equityUsd: 1000, borrowRatio: 0.5, floorUsd: 1, maxRounds: 20 });
    expect(p.limitUsd).toBeCloseTo(2000);
    expect(p.exposureUsd).toBeLessThan(2000);
    expect(p.exposureUsd).toBeGreaterThan(1990);
    expect(p.leverage).toBeCloseTo(p.exposureUsd / 1000);
    // Debt is exposure less equity, whichever rounds ran.
    expect(p.debtUsd).toBeCloseTo(p.exposureUsd - 1000, 6);
  });

  it("stops borrowing at the floor and the last round buys without borrowing", () => {
    const p = ladderProjection({ equityUsd: 100, borrowRatio: 0.5, floorUsd: 20 });
    // 100 -> borrow 50 -> buy 50, borrow 25 -> buy 25, borrow 12.5 < 20: stop.
    expect(p.rounds.map((r) => r.buyUsd)).toEqual([100, 50, 25]);
    expect(p.rounds.map((r) => r.borrowUsd)).toEqual([50, 25, 0]);
    expect(p.debtUsd).toBe(75);
    expect(p.exposureUsd).toBe(175);
  });

  it("captures most of the limit in five rounds at Jupiter's safe ratio", () => {
    const ratio = 0.65 * 0.9;
    const p = ladderProjection({ equityUsd: 1000, borrowRatio: ratio, floorUsd: 0.01, maxRounds: 5 });
    expect(p.exposureUsd / p.limitUsd).toBeGreaterThan(0.9);
  });
});

describe("health", () => {
  it("is LT over LTV, and infinite with no debt", () => {
    expect(positionHealth({ collateralUsd: 100, debtUsd: 50, liquidationThreshold: 0.75 })).toBeCloseTo(1.5);
    expect(positionHealth({ collateralUsd: 100, debtUsd: 0, liquidationThreshold: 0.75 })).toBe(Infinity);
  });

  it("takes the weakest position", () => {
    expect(
      minHealth([
        { collateralUsd: 100, debtUsd: 50, liquidationThreshold: 0.75 },
        { collateralUsd: 100, debtUsd: 70, liquidationThreshold: 0.75 },
      ]),
    ).toBeCloseTo(0.75 / 0.7);
  });

  it("liquidation drop matches lib/borrow/route's definition", () => {
    // ratio 0.5 on LT 0.75: 1 - 0.5 / 0.75
    expect(liquidationDrop({ collateralUsd: 100, debtUsd: 50, liquidationThreshold: 0.75 })).toBeCloseTo(1 - 0.5 / 0.75);
    expect(liquidationDrop({ collateralUsd: 100, debtUsd: 0, liquidationThreshold: 0.75 })).toBeNull();
  });
});
