import { afterEach, describe, expect, it, vi } from "vitest";

import { asResolution, type TvBar, type TvSymbolInfo } from "@/lib/charts/tradingview";

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

  it("widens the window to countBack bars and returns everything before `to`", async () => {
    const fetch = mockFetch([
      { t: 900_000, o: 1, h: 1, l: 1, c: 1, v: 1 },
      { t: 1_000_000, o: 1, h: 2, l: 1, c: 2, v: 3 },
      { t: 2_000_000, o: 2, h: 2, l: 2, c: 2, v: 0 },
    ]);
    const info = await resolve("SPY");
    const bars = await new Promise<TvBar[]>((res, rej) =>
      feed.getBars(
        info,
        asResolution("15"),
        { from: 1_000, to: 2_000, countBack: 300, firstDataRequest: true },
        res,
        rej,
      ),
    );
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toContain("resolution=15m");
    expect(url).toContain("source=trades");
    // 300 fifteen-minute bars before `to` is well before the requested `from`
    // and below zero, which the route refuses, so it is clamped.
    expect(url).toContain("from=0&");
    // A bar before `from` is kept (the library asked for countBack bars); a
    // bar at `to` is not.
    expect(bars.map((b) => b.time)).toEqual([900_000, 1_000_000]);
    expect(bars[1]).toEqual({ time: 1_000_000, open: 1, high: 2, low: 1, close: 2, volume: 3 });
  });

  it("drops volume from the mark series", async () => {
    mockFetch([{ t: 1_000_000, o: 1, h: 2, l: 1, c: 2, v: 0 }]);
    const info = await resolve("SPY:MARK");
    const bars = await new Promise<TvBar[]>((res, rej) =>
      feed.getBars(
        info,
        asResolution("5"),
        { from: 1_000, to: 2_000, countBack: 1, firstDataRequest: true },
        res,
        rej,
      ),
    );
    expect(bars[0]).not.toHaveProperty("volume");
  });

  it("refuses a resolution it does not serve", async () => {
    const info = await resolve("SPY");
    await expect(
      new Promise<TvBar[]>((res, rej) =>
        feed.getBars(
          info,
          "W" as unknown as ReturnType<typeof asResolution>,
          { from: 0, to: 1, countBack: 1, firstDataRequest: true },
          res,
          rej,
        ),
      ),
    ).rejects.toMatch(/unsupported resolution/);
  });
});
