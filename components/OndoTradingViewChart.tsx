"use client";

// Ondo's own candles, drawn with TradingView's charting.
//
// Two Ondo feeds behind one chart. History comes from GET /v1/perps/history
// through app/api/ondo/history (the integration guide's step 6), polled every
// thirty seconds so a new bar opens on time. The live bar between polls is
// the mark price over Ondo's WebSocket (step 7), folded into the last candle
// as it ticks. The socket is optional in effect: if it cannot connect, the
// chart is the history alone and thirty seconds behind, which is what it was.
//
// The market's catalog price is the header's fallback until either feed has
// spoken, so the price is never blank on a market that has one.

import { useMemo, useState } from "react";

import { VenueChartFrame, type ChartRange } from "@/components/VenueChartFrame";
import { ondoChartBars } from "@/lib/ondo/bars";
import type { OndoMarket } from "@/lib/ondo/types";
import { ondoResolutionLabel, useOndoCandles } from "@/lib/ondo/use-ondo-candles";
import { useOndoMarkPriceStream } from "@/lib/ondo/use-mark-price-stream";
import { marketTicker } from "@/lib/tokens/market-logos";

export function OndoTradingViewChart({ market }: { market: OndoMarket }) {
  const [range, setRange] = useState<ChartRange>("1D");
  const { candles, loading, error } = useOndoCandles(market.market, range);
  const mark = useOndoMarkPriceStream(market.market);

  const bars = useMemo(() => ondoChartBars(candles), [candles]);

  const change = useMemo(() => {
    if (candles.length < 2) return null;
    const first = candles[0].open;
    const last = mark ?? candles[candles.length - 1].close;
    return first > 0 ? ((last - first) / first) * 100 : null;
  }, [candles, mark]);

  const last = mark ?? candles[candles.length - 1]?.close ?? Number(market.price) ?? null;

  const empty =
    error && candles.length === 0
      ? "Price history is unavailable for this market."
      : loading
        ? "Loading price history."
        : candles.length === 0
          ? "No price history for this market."
          : null;

  return (
    <VenueChartFrame
      symbol={marketTicker(market.market)}
      last={Number.isFinite(last) ? last : null}
      changePercent={change}
      priceDecimals={priceDecimals(market)}
      range={range}
      onRange={setRange}
      bars={bars}
      fitKey={candles.length > 0 ? `${market.market}:${range}` : null}
      tick={mark}
      empty={empty}
      source={
        candles.length > 0
          ? `${candles.length} bars · ${ondoResolutionLabel(range)} · Ondo${mark != null ? " · live" : ""}`
          : "Ondo perp"
      }
      sourceHref="https://docs.ondoperps.xyz/api-reference/integration_guide"
    />
  );
}

// Ondo states the price tick per market as `quoteIncrement` ("0.01"); the
// scale's precision is its number of decimals.
function priceDecimals(market: OndoMarket): number {
  const inc = Number(market.quoteIncrement);
  if (!Number.isFinite(inc) || inc <= 0) return 2;
  const [, frac = ""] = inc.toFixed(8).replace(/0+$/, "").split(".");
  return Math.min(8, frac.length);
}
