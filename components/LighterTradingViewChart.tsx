"use client";

// Lighter's own candles on TradingView's Charting Library.
//
// The pairing Lighter's screen runs: TradingView's chart, Lighter's data. The
// datafeed (lib/lighter/tv-datafeed.ts) serves history from Lighter's candle
// endpoints and polls the live bar. Two series behind a toggle: trades, what
// printed on the book with volume, and mark, the price a position is valued
// and liquidated at. A trader sizing against a liquidation level wants the
// second.
//
// While the Charting Library files are absent (docs/tradingview.md) the same
// bars are drawn on TradingView's open-source renderer through the shared
// VenueChartFrame, under a notice, so the tab charts the venue either way.

import { useMemo, useState } from "react";

import { TradingViewChart } from "@/components/TradingViewChart";
import { VenueChartFrame, type ChartRange } from "@/components/VenueChartFrame";
import { lighterChartBars } from "@/lib/lighter/bars";
import { seriesChangePercent, type CandleSource } from "@/lib/lighter/candles";
import { createLighterDatafeed, lighterTvSymbol } from "@/lib/lighter/tv-datafeed";
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
  // The catalog's live mark, for the fallback header and its mark series.
  markPrice?: number;
  priceDecimals: number;
}) {
  const [source, setSource] = useState<CandleSource>("trades");

  const datafeed = useMemo(
    () => (marketId == null ? null : createLighterDatafeed({ marketId, symbol, priceDecimals })),
    [marketId, symbol, priceDecimals],
  );

  if (marketId == null || !datafeed) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-white/[0.07] bg-[#111415] text-xs text-white/35">
        No Lighter market for this holding
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 justify-end">
        <SourceToggle source={source} onChange={setSource} />
      </div>
      <div className="min-h-0 flex-1">
        <TradingViewChart
          datafeed={datafeed}
          symbol={lighterTvSymbol(symbol, source)}
          footer={`Lighter ${source === "mark" ? "mark price" : "trades"}`}
          fallback={
            <LightweightFallback
              marketId={marketId}
              symbol={symbol}
              markPrice={markPrice}
              priceDecimals={priceDecimals}
              source={source}
            />
          }
        />
      </div>
    </div>
  );
}

function SourceToggle({
  source,
  onChange,
}: {
  source: CandleSource;
  onChange: (source: CandleSource) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-white/[0.07] p-0.5">
      {SOURCES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
            s.id === source ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// The same series on TradingView's open-source Lightweight Charts, for a
// checkout without the Charting Library files.
function LightweightFallback({
  marketId,
  symbol,
  markPrice,
  priceDecimals,
  source,
}: {
  marketId: number;
  symbol: string;
  markPrice?: number;
  priceDecimals: number;
  source: CandleSource;
}) {
  const [range, setRange] = useState<ChartRange>("1D");
  const { series, loading, error } = useCandles(marketId, range, source);

  const candles = useMemo(() => series?.candles ?? [], [series]);
  const bars = useMemo(() => lighterChartBars(candles), [candles]);
  const change = seriesChangePercent(candles);
  const lastClose = candles[candles.length - 1]?.c ?? null;
  const last = source === "mark" ? (markPrice ?? lastClose) : (lastClose ?? markPrice ?? null);

  const empty =
    error && candles.length === 0
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
    />
  );
}
