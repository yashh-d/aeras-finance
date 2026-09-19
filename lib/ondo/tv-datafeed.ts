"use client";

// A TradingView Charting Library datafeed over Ondo's own data.
//
// Ondo's history endpoint is already shaped for this: GET /v1/perps/history
// answers TradingView's UDF format "as required by the TradingView charting
// library", so getBars is a window passed through /api/ondo/history, which
// resolves the market's history symbol and converts seconds to milliseconds.
// Live bars are the mark price over Ondo's WebSocket (the guide's step 7),
// through the shared feed in mark-socket.ts: each tick is folded into the
// bar the library is on, and a tick past that bar's end opens the next one.

import {
  tvBarStart,
  tvPriceScale,
  type TvBar,
  type TvDatafeed,
  type TvResolution,
  type TvSymbolInfo,
} from "@/lib/charts/tradingview";

import { subscribeMarkPrice } from "./mark-socket";
import type { OndoCandle } from "./types";

// What app/api/ondo/history admits. Ondo's UDF strings match the library's
// for these; 720 is not among them.
const RESOLUTIONS: TvResolution[] = ["1", "5", "15", "30", "60", "240", "1D"];

async function fetchWindow(
  market: string,
  resolution: TvResolution,
  fromSec: number,
  toSec: number,
  countBack: number,
): Promise<OndoCandle[]> {
  const query = new URLSearchParams({
    market,
    resolution,
    from: String(Math.floor(fromSec)),
    to: String(Math.floor(toSec)),
    countback: String(countBack),
  });
  const res = await fetch(`/api/ondo/history?${query}`, { cache: "no-store" });
  const body = (await res.json()) as { candles?: OndoCandle[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Ondo history failed: ${res.status}`);
  return body.candles ?? [];
}

function toBar(c: OndoCandle): TvBar {
  return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
}

export function createOndoDatafeed({
  market,
  ticker,
  longName,
  priceDecimals,
}: {
  // The order symbol, "SPY-USD.P". The route resolves the history symbol.
  market: string;
  ticker: string;
  longName: string;
  priceDecimals: number;
}): TvDatafeed {
  const subscriptions = new Map<string, () => void>();

  return {
    onReady(callback) {
      setTimeout(() => callback({
        supported_resolutions: RESOLUTIONS,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
      }), 0);
    },

    searchSymbols(_input, _exchange, _type, onResult) {
      onResult([]);
    },

    resolveSymbol(symbolName, onResolve, onError) {
      if (symbolName !== ticker) {
        setTimeout(() => onError(`unknown symbol ${symbolName}`), 0);
        return;
      }
      const info: TvSymbolInfo = {
        name: ticker,
        ticker,
        description: `${longName} perp`,
        type: "crypto",
        session: "24x7",
        timezone: "Etc/UTC",
        exchange: "Ondo",
        listed_exchange: "Ondo",
        format: "price",
        pricescale: tvPriceScale(priceDecimals),
        minmov: 1,
        has_intraday: true,
        has_daily: true,
        has_weekly_and_monthly: false,
        supported_resolutions: RESOLUTIONS,
        intraday_multipliers: ["1", "5", "15", "30", "60", "240"],
        volume_precision: 2,
        data_status: "streaming",
        visible_plots_set: "ohlcv",
      };
      setTimeout(() => onResolve(info), 0);
    },

    getBars(_symbolInfo, resolution, period, onResult, onError) {
      fetchWindow(market, resolution, period.from, period.to, period.countBack)
        .then((candles) => {
          const fromMs = period.from * 1000;
          const toMs = period.to * 1000;
          const bars = candles.filter((c) => c.time >= fromMs && c.time < toMs).map(toBar);
          onResult(bars, { noData: bars.length === 0 });
        })
        .catch((err) => onError(err instanceof Error ? err.message : String(err)));
    },

    subscribeBars(_symbolInfo, resolution, onTick, guid) {
      let live: TvBar | null = null;
      const unsubscribe = subscribeMarkPrice(market, (price) => {
        const start = tvBarStart(Date.now(), resolution);
        if (!live || start > live.time) {
          live = { time: start, open: price, high: price, low: price, close: price, volume: 0 };
        } else {
          live = {
            ...live,
            high: Math.max(live.high, price),
            low: Math.min(live.low, price),
            close: price,
          };
        }
        onTick(live);
      });
      subscriptions.set(guid, unsubscribe);
    },

    unsubscribeBars(guid) {
      subscriptions.get(guid)?.();
      subscriptions.delete(guid);
    },
  };
}
