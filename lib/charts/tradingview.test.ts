import { describe, expect, it } from "vitest";

import { isTvResolution, tvBarStart, tvPriceScale } from "./tradingview";

describe("tvBarStart", () => {
  it("floors to the bar boundary at each resolution", () => {
    const t = Date.UTC(2026, 8, 19, 13, 47, 21);
    expect(tvBarStart(t, "1")).toBe(Date.UTC(2026, 8, 19, 13, 47));
    expect(tvBarStart(t, "15")).toBe(Date.UTC(2026, 8, 19, 13, 45));
    expect(tvBarStart(t, "60")).toBe(Date.UTC(2026, 8, 19, 13));
    expect(tvBarStart(t, "1D")).toBe(Date.UTC(2026, 8, 19));
  });
});

describe("tvPriceScale", () => {
  it("is a power of ten of the decimal count, bounded", () => {
    expect(tvPriceScale(2)).toBe(100);
    expect(tvPriceScale(5)).toBe(100_000);
    expect(tvPriceScale(12)).toBe(1e8);
    expect(tvPriceScale(-1)).toBe(1);
  });
});

describe("isTvResolution", () => {
  it("admits the library's strings and nothing else", () => {
    expect(isTvResolution("15")).toBe(true);
    expect(isTvResolution("1D")).toBe(true);
    expect(isTvResolution("15m")).toBe(false);
    expect(isTvResolution("D")).toBe(false);
  });
});
