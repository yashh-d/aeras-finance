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
// The range buttons are Lighter's own range table, so each range fetches the
// finest resolution that fits under the endpoint's 501-bar cap.

import { useMemo, useState } from "react";

import { VenueChartFrame, type ChartRange } from "@/components/VenueChartFrame";
import { lighterChartBars } from "@/lib/lighter/bars";
import { seriesChangePercent } from "@/lib/lighter/candles";
import { useCandles } from "@/lib/lighter/use-candles";

export function LighterTradingViewChart({
  marketId,
  symbol,
  markPrice,
  priceDecimals,
}: {
  marketId: number | null;
  symbol: string;
  // The catalog's live mark, shown while the first candle response is in
  // flight so the header is never empty, and folded into the last bar
  // between polls since the catalog refreshes faster than the candles do.
  markPrice?: number;
  priceDecimals: number;
}) {
  const [range, setRange] = useState<ChartRange>("1D");
  const { series, loading, error } = useCandles(marketId, range);

  const candles = useMemo(() => series?.candles ?? [], [series]);
  const bars = useMemo(() => lighterChartBars(candles), [candles]);
  const change = seriesChangePercent(candles);
  const last = markPrice ?? candles[candles.length - 1]?.c ?? null;

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
      fitKey={series ? `${series.marketId}:${series.range}` : null}
      tick={markPrice}
      empty={empty}
      source={
        series && candles.length > 0
          ? `${candles.length} bars · ${series.resolution} · Lighter`
          : "Lighter perp"
      }
      sourceHref="https://lighter.xyz/blog/tradingview"
    />
  );
}
