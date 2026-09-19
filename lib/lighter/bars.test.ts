import { describe, expect, it } from "vitest";

import { lighterChartBars } from "./bars";
import type { LighterCandle } from "./candles";

function candle(tMs: number, c: number, v = 1): LighterCandle {
  return { t: tMs, o: c - 1, h: c + 1, l: c - 2, c, v, quoteVolume: v * c, traded: v > 0 };
}

describe("lighterChartBars", () => {
  it("maps the wire fields and converts to seconds", () => {
    const [bar] = lighterChartBars([candle(1_758_240_000_000, 10)]);
    expect(bar).toEqual({ time: 1_758_240_000, open: 9, high: 11, low: 8, close: 10, volume: 1 });
  });

  it("zeroes the volume of an untraded bar", () => {
    const [bar] = lighterChartBars([candle(1_000, 10, 0)]);
    expect(bar.volume).toBe(0);
  });
});
