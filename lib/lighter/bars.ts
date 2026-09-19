// Lighter candles as chart bars. See lib/charts/bars.ts for the shape.

import { toChartBars, type ChartBar } from "@/lib/charts/bars";

import type { LighterCandle } from "./candles";

export function lighterChartBars(candles: readonly LighterCandle[]): ChartBar[] {
  return toChartBars(
    candles.map((candle) => ({
      t: candle.t,
      o: candle.o,
      h: candle.h,
      l: candle.l,
      c: candle.c,
      // Lighter emits a flat bar for an untraded interval so the series has
      // no gaps. Its volume is zero already, but `traded` is the field that
      // says so, and it is what the old chart keyed on.
      v: candle.traded ? candle.v : 0,
    })),
  );
}
