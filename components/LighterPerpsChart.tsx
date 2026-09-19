"use client";

// Lighter's own candles on TradingView's Lightweight Charts.
//
// A perp is opened, marked and liquidated against the venue's book, so the
// perps tab draws the venue's own bars. Two series behind a toggle: trades
// (/candles), what printed on the book with volume, and mark
// (/markPriceCandles), the price a position is valued and liquidated at,
// sampled rather than traded and drawn without volume. The catalog's live
// mark is folded into the mark series' last bar between polls; it is not
// folded into a trades bar, where it would draw a print that never happened.
//
// The range buttons are Lighter's own range table, so each range fetches the
// finest resolution that fits under the endpoint's bar cap. The hedge tab
// keeps its recharts candlestick (components/LighterChart.tsx); this is the
// perps tab's chart.

import { useMemo, useState } from "react";

import { VenueChartFrame, type ChartRange } from "@/components/VenueChartFrame";
import { lighterChartBars } from "@/lib/lighter/bars";
import { seriesChangePercent, type CandleSource } from "@/lib/lighter/candles";
import { useCandles } from "@/lib/lighter/use-candles";

const SOURCES: readonly { id: CandleSource; label: string }[] = [
  { id: "trades", label: "Trades" },
  { id: "mark", label: "Mark" },
];

export function LighterPerpsChart({
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
                s.id === source ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
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
