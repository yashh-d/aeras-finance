// Ondo candles as chart bars. See lib/charts/bars.ts for the shape.
//
// app/api/ondo/history already converts Ondo's seconds to milliseconds, so
// an OndoCandle reaches here in the same unit a LighterCandle does.

import { toChartBars, type ChartBar } from "@/lib/charts/bars";

import type { OndoCandle } from "./types";

export function ondoChartBars(candles: readonly OndoCandle[]): ChartBar[] {
  return toChartBars(
    candles.map((candle) => ({
      t: candle.time,
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
      v: candle.volume,
    })),
  );
}
