import { describe, expect, it } from "vitest";

import { hasLendingMarket } from "@/lib/borrow/availability";
import { XSTOCKS } from "@/lib/jupiter/xstocks";

import { borrowMarketsFor } from "./borrow-markets";

describe("borrowMarketsFor", () => {
  it("agrees with hasLendingMarket for every catalog asset", () => {
    for (const x of XSTOCKS) {
      expect(borrowMarketsFor(x.mint).length > 0, x.symbol).toBe(hasLendingMarket(x.mint));
    }
  });

  it("lists Tesla on both venues with Borrow-tab keys and whole-percent parameters", () => {
    const tesla = XSTOCKS.find((x) => x.symbol === "TSLAx")!;
    const markets = borrowMarketsFor(tesla.mint);
    const venues = markets.map((m) => m.venue);
    expect(venues).toContain("Jupiter Lend");
    for (const m of markets) {
      expect(m.key).toMatch(/^(jup|kamino)-/);
      expect(m.maxLtvPct).toBeGreaterThan(0);
      expect(m.maxLtvPct).toBeLessThan(100);
      expect(m.liquidationThresholdPct).toBeGreaterThanOrEqual(m.maxLtvPct);
    }
  });

  it("is empty for a mint no venue lists", () => {
    expect(borrowMarketsFor("nope")).toEqual([]);
  });
});
