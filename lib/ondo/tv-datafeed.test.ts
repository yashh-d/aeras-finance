import { afterEach, describe, expect, it, vi } from "vitest";

import type { TvBar, TvSymbolInfo } from "@/lib/charts/tradingview";

vi.mock("./mark-socket", () => {
  const listeners = new Set<(p: number) => void>();
  return {
    subscribeMarkPrice: (_market: string, cb: (p: number) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    __emit: (p: number) => listeners.forEach((cb) => cb(p)),
    __count: () => listeners.size,
  };
});

import * as socket from "./mark-socket";
import { createOndoDatafeed } from "./tv-datafeed";

const emit = (socket as unknown as { __emit: (p: number) => void }).__emit;
const count = (socket as unknown as { __count: () => number }).__count;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const feed = createOndoDatafeed({
  market: "SPY-USD.P",
  ticker: "SPY",
  longName: "SPDR S&P 500",
  priceDecimals: 2,
});

function resolve(name: string): Promise<TvSymbolInfo> {
  return new Promise((res, rej) => feed.resolveSymbol(name, res, rej));
}

describe("ondo datafeed", () => {
  it("passes the window through to the history route", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candles: [{ time: 1_500_000, open: 1, high: 2, low: 1, close: 2, volume: 9 }],
      }),
    }));
    vi.stubGlobal("fetch", fetch);
    const info = await resolve("SPY");
    const bars = await new Promise<TvBar[]>((res, rej) =>
      feed.getBars(info, "60", { from: 1_000, to: 2_000, countBack: 1, firstDataRequest: true }, res, rej),
    );
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toContain("market=SPY-USD.P");
    expect(url).toContain("from=1000");
    expect(url).toContain("to=2000");
    expect(bars[0]).toMatchObject({ time: 1_500_000, close: 2, volume: 9 });
  });

  it("folds ticks into the live bar and opens a new one past the boundary", async () => {
    // Resolved before the clock is faked: resolveSymbol answers on a timer.
    const info = await resolve("SPY");
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 19, 13, 47));
    const ticks: TvBar[] = [];
    feed.subscribeBars(info, "15", (bar) => ticks.push(bar), "g1", () => {});
    expect(count()).toBe(1);

    emit(100);
    emit(103);
    emit(99);
    expect(ticks[2]).toMatchObject({
      time: Date.UTC(2026, 8, 19, 13, 45),
      open: 100,
      high: 103,
      low: 99,
      close: 99,
    });

    vi.setSystemTime(Date.UTC(2026, 8, 19, 14, 1));
    emit(101);
    expect(ticks[3]).toMatchObject({ time: Date.UTC(2026, 8, 19, 14, 0), open: 101, close: 101 });

    feed.unsubscribeBars("g1");
    expect(count()).toBe(0);
  });
});
