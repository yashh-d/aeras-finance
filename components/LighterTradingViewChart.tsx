"use client";

// Lighter's own candles, drawn with TradingView's charting.
//
// Lighter's screen charts its order book on TradingView's technology, and a
// perp is opened, marked and liquidated against that book, so the perps tab
// draws the same thing: the market's own bars, not the underlying on some
// other exchange. The bars come from lib/lighter/candles.ts through the same
// hook the hedge tab uses; the rendering is the shared CandleChartCanvas
// rather than the hand-rolled recharts candlestick in components/LighterChart.tsx,
// which stays on the hedge tab where the plot is a glance beside a form.
//
// Two series, one toggle. Trades (/candles) is what printed on the book, with
// volume. Mark (/markPriceCandles) is the price a position is valued and
// liquidated at, sampled rather than traded, so it has no volume and never
// gaps. A trader sizing against a liquidation level wants the second, and
// the catalog's live mark is folded into its last bar between polls; it is
// not folded into a trades bar, where it would draw a print that never
// happened.
//
// The range buttons are Lighter's own range table, so each range fetches the
// finest resolution that fits under the endpoint's cap.

import { useMemo, useState } from "react";

import { VenueChartFrame, type ChartRange } from "@/components/VenueChartFrame";
import { lighterChartBars } from "@/lib/lighter/bars";
import { seriesChangePercent, type CandleSource } from "@/lib/lighter/candles";
import { useCandles } from "@/lib/lighter/use-candles";

const SOURCES: readonly { id: CandleSource; label: string }[] = [
  { id: "trades", label: "Trades" },
  { id: "mark", label: "Mark" },
];

export function LighterTradingViewChart({
  marketId,
  symbol,
  markPrice,
  priceDecimals,
}: {
  marketId: number | null;
  symbol: string;
  // The catalog's live mark. Shown in the header while the first candle
  // response is in flight, and ticked into the last bar of the mark series.
  markPrice?: number;
  priceDecimals: number;
}) {
  const [range, setRange] = useState<ChartRange>("1D");
  const [source, setSource] = useState<CandleSource>("trades");
  const { series, loading, error } = useCandles(marketId, range, source);

  const candles = useMemo(() => series?.candles ?? [], [series]);
  const bars = useMemo(() => lighterChartBars(candles), [candles]);
  const change = seriesChangePercent(candles);
  const lastClose = candles[candles.length - 1]?.c ?? null;
  const last = source === "mark" ? (markPrice ?? lastClose) : (lastClose ?? markPrice ?? null);

  const empty =
    marketId == null
      ? "No Lighter market for this holding"
      : error && candles.length === 0
        ? "Price history unavailable"
        : loading || candles.length === 0
          ? "Loading price history"
          : null;

  return (
    <VenueChartFrame
      symbol={symbol}
      last={last}
      changePercent={change}
      priceDecimals={priceDecimals}
      range={range}
      onRange={setRange}
      bars={bars}
      fitKey={series ? `${series.marketId}:${series.range}:${series.source}` : null}
      tick={source === "mark" ? markPrice : null}
      empty={empty}
      source={
        series && candles.length > 0
          ? `${candles.length} bars · ${series.resolution} · Lighter ${series.source === "mark" ? "mark price" : "trades"}`
          : "Lighter perp"
      }
      sourceHref="https://lighter.xyz/blog/tradingview"
      controls={
        <div className="flex gap-0.5 rounded-lg border border-white/[0.07] p-0.5">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSource(s.id)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                s.id === source
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      }
    />
  );
}
