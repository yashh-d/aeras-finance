"use client";

// Ondo's own data on TradingView's Charting Library.
//
// Ondo's history endpoint is shaped for exactly this chart ("TradingView UDF
// format, as required by the TradingView charting library"), and the
// datafeed (lib/ondo/tv-datafeed.ts) passes a window through
// /api/ondo/history and folds the mark price WebSocket into the live bar.
//
// While the Charting Library files are absent (docs/tradingview.md) the same
// bars are drawn on TradingView's open-source renderer through the shared
// VenueChartFrame, under a notice, so the tab charts the venue either way.

import { useMemo, useState } from "react";

import { TradingViewChart } from "@/components/TradingViewChart";
import { VenueChartFrame, type ChartRange } from "@/components/VenueChartFrame";
import { ondoChartBars } from "@/lib/ondo/bars";
import { createOndoDatafeed } from "@/lib/ondo/tv-datafeed";
import type { OndoMarket } from "@/lib/ondo/types";
import { ondoResolutionLabel, useOndoCandles } from "@/lib/ondo/use-ondo-candles";
import { useOndoMarkPriceStream } from "@/lib/ondo/use-mark-price-stream";
import { marketTicker } from "@/lib/tokens/market-logos";

export function OndoTradingViewChart({ market }: { market: OndoMarket }) {
  const ticker = marketTicker(market.market);
  const decimals = priceDecimals(market);

  const datafeed = useMemo(
    () =>
      createOndoDatafeed({
        market: market.market,
        ticker,
        longName: market.longName,
        priceDecimals: decimals,
      }),
    [market.market, ticker, market.longName, decimals],
  );

  return (
    <TradingViewChart
      datafeed={datafeed}
      symbol={ticker}
      footer="Ondo perp"
      fallback={<LightweightFallback market={market} ticker={ticker} priceDecimals={decimals} />}
    />
  );
}

function LightweightFallback({
  market,
  ticker,
  priceDecimals,
}: {
  market: OndoMarket;
  ticker: string;
  priceDecimals: number;
}) {
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

  const last = mark ?? candles[candles.length - 1]?.close ?? Number(market.price);

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
      symbol={ticker}
      last={Number.isFinite(last) ? last : null}
      changePercent={change}
      priceDecimals={priceDecimals}
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
