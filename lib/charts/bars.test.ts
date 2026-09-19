import { describe, expect, it } from "vitest";

import { applyTick, toChartBars, type OhlcvRow } from "./bars";

function row(tMs: number, c: number, v = 1): OhlcvRow {
  return { t: tMs, o: c - 1, h: c + 1, l: c - 2, c, v };
}

describe("toChartBars", () => {
  it("converts milliseconds to seconds and keeps OHLCV", () => {
    const [bar] = toChartBars([row(1_758_240_000_000, 10)]);
    expect(bar.time).toBe(1_758_240_000);
    expect(bar).toMatchObject({ open: 9, high: 11, low: 8, close: 10, volume: 1 });
  });

  it("sorts ascending and keeps the later of two equal timestamps", () => {
    const bars = toChartBars([row(3_000, 30), row(1_000, 10), row(3_000, 31), row(2_000, 20)]);
    expect(bars.map((b) => b.time)).toEqual([1, 2, 3]);
    expect(bars[2].close).toBe(31);
  });
});

describe("applyTick", () => {
  const bar = toChartBars([row(1_000, 10)])[0];

  it("moves the close and widens the range outward only", () => {
    expect(applyTick(bar, 12)).toMatchObject({ open: 9, high: 12, low: 8, close: 12 });
    expect(applyTick(bar, 7)).toMatchObject({ open: 9, high: 11, low: 7, close: 7 });
    expect(applyTick(bar, 10.5)).toMatchObject({ high: 11, low: 8, close: 10.5 });
  });
});
