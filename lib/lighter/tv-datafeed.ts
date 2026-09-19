"use client";

// A TradingView Charting Library datafeed over Lighter's candles.
//
// This is what puts Lighter's own bars on TradingView's chart, the pairing
// Lighter's screen runs. History is /api/lighter/history, an explicit window
// at a Lighter resolution. Live bars are polled: Lighter's WebSocket is not
// wired in this app, and a ten-second poll of the last two bars through the
// cached route is a small fraction of the per-IP budget the chart shares.
//
// Two symbols per market, one per candle endpoint. "SPY" is trades, what
// printed on the book, with volume. "SPY:MARK" is the mark price, what a
// position is valued and liquidated at, sampled rather than traded, drawn
// without volume. The chart's own symbol search is disabled; the venue
// component switches between the two.

import {
  TV_RESOLUTIONS,
  tvPriceScale,
  type TvBar,
  type TvDatafeed,
  type TvResolution,
  type TvSymbolInfo,
} from "@/lib/charts/tradingview";

import type { CandleResolution, CandleSource, LighterCandle } from "./candles";

const TO_LIGHTER: Record<TvResolution, CandleResolution> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "240": "4h",
  "720": "12h",
  "1D": "1d",
};

const POLL_MS = 10_000;

export const MARK_SUFFIX = ":MARK";

export function lighterTvSymbol(symbol: string, source: CandleSource): string {
  return source === "mark" ? `${symbol}${MARK_SUFFIX}` : symbol;
}

function splitSymbol(name: string): { symbol: string; source: CandleSource } {
  return name.endsWith(MARK_SUFFIX)
    ? { symbol: name.slice(0, -MARK_SUFFIX.length), source: "mark" }
    : { symbol: name, source: "trades" };
}

function toBar(c: LighterCandle, source: CandleSource): TvBar {
  const bar: TvBar = { time: c.t, open: c.o, high: c.h, low: c.l, close: c.c };
  if (source === "trades") bar.volume = c.v;
  return bar;
}

async function fetchWindow(
  marketId: number,
  resolution: TvResolution,
  source: CandleSource,
  fromSec: number,
  toSec: number,
  countBack: number,
): Promise<LighterCandle[]> {
  const query = new URLSearchParams({
    market: String(marketId),
    resolution: TO_LIGHTER[resolution],
    source,
    from: String(Math.floor(fromSec)),
    to: String(Math.floor(toSec)),
    countback: String(countBack),
  });
  const res = await fetch(`/api/lighter/history?${query}`, { cache: "no-store" });
  const body = (await res.json()) as { candles?: LighterCandle[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Lighter history failed: ${res.status}`);
  return body.candles ?? [];
}

export function createLighterDatafeed({
  marketId,
  symbol,
  priceDecimals,
}: {
  marketId: number;
  symbol: string;
  priceDecimals: number;
}): TvDatafeed {
  const pollers = new Map<string, ReturnType<typeof setInterval>>();

  return {
    onReady(callback) {
      // The library requires this to be answered asynchronously.
      setTimeout(() => callback({
        supported_resolutions: TV_RESOLUTIONS,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
      }), 0);
    },

    searchSymbols(_input, _exchange, _type, onResult) {
      onResult([]);
    },

    resolveSymbol(symbolName, onResolve, onError) {
      const { symbol: base, source } = splitSymbol(symbolName);
      if (base !== symbol) {
        setTimeout(() => onError(`unknown symbol ${symbolName}`), 0);
        return;
      }
      const info: TvSymbolInfo = {
        name: symbolName,
        ticker: symbolName,
        description: source === "mark" ? `${symbol} perp, mark price` : `${symbol} perp`,
        type: "crypto",
        session: "24x7",
        timezone: "Etc/UTC",
        exchange: "Lighter",
        listed_exchange: "Lighter",
        format: "price",
        pricescale: tvPriceScale(priceDecimals),
        minmov: 1,
        has_intraday: true,
        has_daily: true,
        has_weekly_and_monthly: false,
        supported_resolutions: TV_RESOLUTIONS,
        intraday_multipliers: ["1", "5", "15", "30", "60", "240", "720"],
        volume_precision: 4,
        data_status: "streaming",
        visible_plots_set: source === "mark" ? "ohlc" : "ohlcv",
      };
      setTimeout(() => onResolve(info), 0);
    },

    getBars(symbolInfo, resolution, period, onResult, onError) {
      const { source } = splitSymbol(symbolInfo.name);
      fetchWindow(marketId, resolution, source, period.from, period.to, period.countBack)
        .then((candles) => {
          const fromMs = period.from * 1000;
          const toMs = period.to * 1000;
          // The library wants bars inside [from, to) only; a bar outside the
          // window, which the server's cap can produce, is rejected loudly.
          const bars = candles
            .filter((c) => c.t >= fromMs && c.t < toMs)
            .map((c) => toBar(c, source));
          onResult(bars, { noData: bars.length === 0 });
        })
        .catch((err) => onError(err instanceof Error ? err.message : String(err)));
    },

    subscribeBars(symbolInfo, resolution, onTick, guid) {
      const { source } = splitSymbol(symbolInfo.name);
      let lastTime = 0;
      const poll = () => {
        const nowSec = Math.floor(Date.now() / 1000);
        // Three bars back, so a bar that closed between polls is refreshed
        // with its final values before the new one is drawn.
        const span = 3 * (msOf(resolution) / 1000);
        fetchWindow(marketId, resolution, source, nowSec - span, nowSec + 1, 3)
          .then((candles) => {
            for (const c of candles) {
              // Time never runs backwards for the library, so only the bar it
              // is on and anything newer are sent.
              if (c.t < lastTime) continue;
              lastTime = c.t;
              onTick(toBar(c, source));
            }
          })
          .catch(() => {
            // A missed poll costs ten seconds of freshness and nothing else.
          });
      };
      pollers.set(guid, setInterval(poll, POLL_MS));
    },

    unsubscribeBars(guid) {
      const id = pollers.get(guid);
      if (id) clearInterval(id);
      pollers.delete(guid);
    },
  };
}

function msOf(resolution: TvResolution): number {
  return {
    "1": 60_000,
    "5": 300_000,
    "15": 900_000,
    "30": 1_800_000,
    "60": 3_600_000,
    "240": 14_400_000,
    "720": 43_200_000,
    "1D": 86_400_000,
  }[resolution];
}
