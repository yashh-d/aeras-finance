import { describe, expect, it } from "vitest";

import type { LighterMarket } from "./types";
import { clampLeverage, maxNotionalUsd } from "./ticket-math";

function market(maxLeverage: number, orderQuoteLimit = "1000000"): LighterMarket {
  return {
    maxLeverage,
    minInitialMarginFraction: 1 / maxLeverage,
    initialMarginFraction: 0.1,
    maintenanceMarginFraction: 0.03,
    orderQuoteLimit,
  } as unknown as LighterMarket;
}

describe("maxNotionalUsd", () => {
  it("is margin times leverage, clamped to the market maximum and the order cap", () => {
    expect(maxNotionalUsd(100, 5, market(20))).toBe(500);
    expect(maxNotionalUsd(100, 50, market(20))).toBe(2000);
    expect(maxNotionalUsd(100, 5, market(20, "300"))).toBe(300);
    expect(maxNotionalUsd(-5, 5, market(20))).toBe(0);
  });
});

describe("clampLeverage", () => {
  it("keeps leverage a whole number inside 1 and the market maximum", () => {
    expect(clampLeverage(0, market(20))).toBe(1);
    expect(clampLeverage(7.9, market(20))).toBe(7);
    expect(clampLeverage(99, market(20))).toBe(20);
  });
});
