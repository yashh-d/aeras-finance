// Venue candles in the shape TradingView's Lightweight Charts consumes.
//
// The library wants seconds, ascending, one bar per timestamp, and throws on
// anything else. Both venues send milliseconds by the time a candle reaches a
// component (Lighter natively, Ondo converted in its route), and Lighter has
// been seen to repeat the live bar at the tail of a response, so the series
// is sorted and the later of two equal timestamps wins. Kept out of the
// components so the arithmetic can be asserted without a canvas.

import type { UTCTimestamp } from "lightweight-charts";

export interface OhlcvRow {
  // Unix milliseconds.
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  // Base volume. Zero draws nothing in the histogram.
  v: number;
}

export interface ChartBar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function toChartBars(rows: readonly OhlcvRow[]): ChartBar[] {
  const byTime = new Map<number, OhlcvRow>();
  for (const row of rows) byTime.set(Math.floor(row.t / 1000), row);
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, row]) => ({
      time: time as UTCTimestamp,
      open: row.o,
      high: row.h,
      low: row.l,
      close: row.c,
      volume: row.v,
    }));
}

// The live bar after a tick lands on it. The tick becomes the close and
// widens the range if it falls outside it; the open and the time stay.
export function applyTick(bar: ChartBar, price: number): ChartBar {
  return {
    ...bar,
    high: Math.max(bar.high, price),
    low: Math.min(bar.low, price),
    close: price,
  };
}
