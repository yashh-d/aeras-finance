import { afterEach, describe, expect, it, vi } from "vitest";

import type { TvBar, TvSymbolInfo } from "@/lib/charts/tradingview";

import { createLighterDatafeed, lighterTvSymbol } from "./tv-datafeed";

function mockFetch(candles: unknown[]) {
  const fetch = vi.fn(async (input: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ candles }),
    url: input,
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const feed = createLighterDatafeed({ marketId: 7, symbol: "SPY", priceDecimals: 2 });

function resolve(name: string): Promise<TvSymbolInfo> {
  return new Promise((res, rej) => feed.resolveSymbol(name, res, rej));
}

describe("lighter datafeed", () => {
  it("names the mark series with a suffix", () => {
    expect(lighterTvSymbol("SPY", "trades")).toBe("SPY");
    expect(lighterTvSymbol("SPY", "mark")).toBe("SPY:MARK");
  });

  it("resolves both series and refuses others", async () => {
    const trades = await resolve("SPY");
    expect(trades).toMatchObject({ exchange: "Lighter", pricescale: 100, visible_plots_set: "ohlcv" });
    const mark = await resolve("SPY:MARK");
    expect(mark.visible_plots_set).toBe("ohlc");
    await expect(resolve("TSLA")).rejects.toMatch(/unknown symbol/);
  });

  it("asks the history route in Lighter's resolution and keeps bars inside the window", async () => {
    const fetch = mockFetch([
      { t: 900_000, o: 1, h: 1, l: 1, c: 1, v: 1 },
      { t: 1_000_000, o: 1, h: 2, l: 1, c: 2, v: 3 },
      { t: 2_000_000, o: 2, h: 2, l: 2, c: 2, v: 0 },
    ]);
    const info = await resolve("SPY");
    const bars = await new Promise<TvBar[]>((res, rej) =>
      feed.getBars(info, "15", { from: 1_000, to: 2_000, countBack: 2, firstDataRequest: true }, res, rej),
    );
    expect(String(fetch.mock.calls[0][0])).toContain("resolution=15m");
    expect(String(fetch.mock.calls[0][0])).toContain("source=trades");
    expect(bars).toEqual([{ time: 1_000_000, open: 1, high: 2, low: 1, close: 2, volume: 3 }]);
  });

  it("drops volume from the mark series", async () => {
    mockFetch([{ t: 1_000_000, o: 1, h: 2, l: 1, c: 2, v: 0 }]);
    const info = await resolve("SPY:MARK");
    const bars = await new Promise<TvBar[]>((res, rej) =>
      feed.getBars(info, "5", { from: 1_000, to: 2_000, countBack: 1, firstDataRequest: true }, res, rej),
    );
    expect(bars[0]).not.toHaveProperty("volume");
  });
});
