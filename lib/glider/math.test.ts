import { describe, expect, it } from "vitest";

import {
  assetReturn,
  cagr,
  equalWeightBasketReturn,
  MIN_CAGR_YEARS,
  yearsBetween,
  type PricePoint,
} from "./math";

// A series that compounds at `rate` a year, one point per day, starting on
// `from`. Trading days are simulated as every day, which the arithmetic
// treats identically.
function compounding(from: string, days: number, rate: number, start = 100): PricePoint[] {
  const out: PricePoint[] = [];
  const t0 = Date.parse(from);
  for (let i = 0; i < days; i++) {
    const date = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    const years = i / 365.25;
    out.push({ date, close: start * Math.pow(1 + rate, years) });
  }
  return out;
}

describe("cagr", () => {
  it("doubles in one year", () => {
    expect(cagr(100, 200, 1)).toBeCloseTo(1, 10);
  });
  it("reads a ten-year AAPL window", () => {
    // Nasdaq closes, 2016-09-21 and 2026-09-18, split-adjusted.
    expect(cagr(28.3875, 336.13, 9.99)!).toBeCloseTo(0.2804, 3);
  });
  it("is null when it cannot be computed", () => {
    expect(cagr(0, 10, 1)).toBeNull();
    expect(cagr(10, 0, 1)).toBeNull();
    expect(cagr(10, 20, 0)).toBeNull();
  });
});

describe("assetReturn", () => {
  it("annualises a long series", () => {
    const r = assetReturn(compounding("2016-09-21", 3653, 0.2))!;
    expect(r.kind).toBe("cagr");
    expect(r.value).toBeCloseTo(0.2, 3);
    expect(r.years).toBeCloseTo(10, 1);
    expect(r.sessions).toBe(3653);
  });
  it("reports a cumulative figure for a short series", () => {
    // SpaceX: 68 sessions from listing, 160.95 -> 152.71.
    const series: PricePoint[] = [
      { date: "2026-06-12", close: 160.95 },
      { date: "2026-07-15", close: 170 },
      { date: "2026-09-18", close: 152.71 },
    ];
    const r = assetReturn(series)!;
    expect(r.kind).toBe("since-listing");
    expect(r.value).toBeCloseTo(152.71 / 160.95 - 1, 6);
    expect(r.years).toBeLessThan(MIN_CAGR_YEARS);
  });
  it("is null for fewer than two points", () => {
    expect(assetReturn([{ date: "2026-01-01", close: 1 }])).toBeNull();
  });
});

describe("equalWeightBasketReturn", () => {
  it("returns the common rate when every constituent compounds alike", () => {
    const a = compounding("2016-09-21", 3653, 0.25);
    const b = compounding("2016-09-21", 3653, 0.25, 40);
    const r = equalWeightBasketReturn({ A: a, B: b })!;
    expect(r.cagr).toBeCloseTo(0.25, 3);
    expect(r.tickers).toEqual(["A", "B"]);
    expect(r.excluded).toEqual([]);
  });
  it("compounds two steady rates at their geometric mean", () => {
    // Rebalancing daily into whichever grew less holds the mix at equal
    // weight, so the basket earns the mean of the daily log returns: the
    // geometric mean of the two rates, below their arithmetic mean.
    const slow = compounding("2016-09-21", 3653, 0.1);
    const fast = compounding("2016-09-21", 3653, 0.4);
    const r = equalWeightBasketReturn({ slow, fast })!;
    expect(r.cagr).toBeGreaterThan(0.1);
    expect(r.cagr).toBeLessThan(0.4);
    expect(r.cagr).toBeCloseTo(Math.sqrt(1.1 * 1.4) - 1, 3);
  });
  it("excludes a series shorter than the minimum window and names it", () => {
    const long = compounding("2016-09-21", 3653, 0.2);
    const listed = compounding("2026-06-12", 68, -0.5, 160);
    const r = equalWeightBasketReturn({ AAPL: long, SPCX: listed })!;
    expect(r.tickers).toEqual(["AAPL"]);
    expect(r.excluded).toEqual(["SPCX"]);
    expect(r.cagr).toBeCloseTo(0.2, 3);
    expect(r.years).toBeCloseTo(10, 1);
  });
  it("aligns on the dates every series has", () => {
    const a = compounding("2016-09-21", 3653, 0.2);
    const b = compounding("2016-09-21", 3653, 0.2).filter((_, i) => i % 2 === 0);
    const r = equalWeightBasketReturn({ a, b })!;
    expect(r.cagr).toBeCloseTo(0.2, 3);
  });
  it("is null with nothing long enough", () => {
    expect(equalWeightBasketReturn({ X: compounding("2026-06-12", 10, 0.1) })).toBeNull();
  });
});

describe("yearsBetween", () => {
  it("counts leap years", () => {
    expect(yearsBetween("2016-09-21", "2026-09-21")).toBeCloseTo(10, 2);
  });
});
