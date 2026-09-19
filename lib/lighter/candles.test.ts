import { describe, expect, it } from "vitest";

import {
  candleWindow,
  parseCandles,
  parseMarketPriceCharts,
  parseMarkPriceCandles,
} from "./candles";

describe("parseCandles", () => {
  it("reads omitted zero fields as zero, per the spec", () => {
    // "Zero values are omitted from the response": an untraded bar has no v
    // or V on the wire. Lightweight Charts rejects an undefined volume.
    const [bar] = parseCandles({
      code: 200,
      r: "5m",
      c: [{ t: 1_758_240_000_000, o: 1, h: 1, l: 1, c: 1, i: 7 }],
    });
    expect(bar).toEqual({
      t: 1_758_240_000_000,
      o: 1,
      h: 1,
      l: 1,
      c: 1,
      v: 0,
      quoteVolume: 0,
      traded: false,
    });
  });

  it("marks a bar with volume as traded", () => {
    const [bar] = parseCandles({
      code: 200,
      c: [{ t: 1, o: 1, h: 2, l: 1, c: 2, v: 3, V: 5, i: 1 }],
    });
    expect(bar.traded).toBe(true);
    expect(bar.quoteVolume).toBe(5);
  });

  it("throws on a non-200 code", () => {
    expect(() => parseCandles({ code: 20001, message: "invalid param" })).toThrow(
      "invalid param",
    );
  });
});

describe("parseMarkPriceCandles", () => {
  it("carries no volume and treats samples as the bar being real", () => {
    const [sampled, empty] = parseMarkPriceCandles({
      code: 200,
      r: "15m",
      c: [
        { t: 1, o: 1, h: 2, l: 1, c: 2, sc: 42 },
        { t: 2, o: 2, h: 2, l: 2, c: 2 },
      ],
    });
    expect(sampled).toMatchObject({ v: 0, quoteVolume: 0, traded: true });
    expect(empty.traded).toBe(false);
  });
});

describe("parseMarketPriceCharts", () => {
  it("keys hourly prices by market id and parses the strings", () => {
    const charts = parseMarketPriceCharts({
      code: 200,
      resolution: "1h",
      price_charts: [
        { market_id: 0, prices: ["100.5", "101"] },
        { market_id: 3, prices: [] },
      ],
    });
    expect(charts[0]).toEqual([100.5, 101]);
    expect(charts[3]).toBeUndefined();
  });
});

describe("candleWindow", () => {
  it("keeps every range under the endpoint's 500-bar cap", () => {
    for (const range of ["1H", "1D", "1W", "1M", "3M"] as const) {
      expect(candleWindow(range, Date.now()).bars).toBeLessThanOrEqual(500);
    }
  });
});
