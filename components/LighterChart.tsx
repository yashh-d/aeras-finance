"use client";

// Lighter's price history: the data layer around components/CandleChart.tsx.
//
// The drawing lives there and is shared with the Ondo column, so the two venues
// cannot drift apart visually. What stays here is what is Lighter's alone: the
// candle hook, the range set, and the fact that a market may not exist for a
// holding at all.

import { useState } from "react";

import {
  CandleChart,
  type ChartMarker,
} from "@/components/CandleChart";
import { CANDLE_RANGES, type CandleRange } from "@/lib/lighter/candles";
import { useCandles } from "@/lib/lighter/use-candles";

export type LighterChartMarker = ChartMarker;

export function LighterChart({
  marketId,
  symbol,
  markPrice,
  marker,
  fill,
  ranges = CANDLE_RANGES,
}: {
  marketId: number | null;
  symbol: string;
  // The catalog's live mark. Shown while the first candle response is still in
  // flight so the header is never empty, and it is the fresher of the two.
  markPrice?: number;
  marker?: LighterChartMarker;
  // Take the height of whatever contains this rather than the fixed 224px the
  // hedge tab wants. The perps tab used this to stretch into its chart column
  // before it moved to TradingView; the hedge tab passes nothing.
  fill?: boolean;
  // Which ranges the picker offers. Defaults to the hedge tab's five short ones,
  // which is all a 224px plot has room for and all a hedge decision needs. The
  // perps tab passes PERPS_CANDLE_RANGES for the longer set.
  ranges?: readonly CandleRange[];
}) {
  const [range, setRange] = useState<CandleRange>("1D");
  const { series, loading, error } = useCandles(marketId, range);
  const candles = series?.candles ?? [];

  const notice =
    marketId == null
      ? "No Lighter market for this holding"
      : error && candles.length === 0
        ? "Price history unavailable"
        : loading && candles.length === 0
          ? "Loading price history"
          : null;

  return (
    <CandleChart
      symbol={symbol}
      price={markPrice}
      candles={candles}
      ranges={ranges}
      range={range}
      onRangeChange={setRange}
      marker={marker}
      fill={fill}
      venueLabel="Lighter perp"
      resolutionLabel={series?.resolution}
      notice={notice}
    />
  );
}
