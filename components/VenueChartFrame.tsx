"use client";

// The chrome around a venue's chart: symbol, last price, change, range
// buttons, the plot, and a footer naming the data source. Both perps venues
// render this so the two columns read the same; only the feed differs.

import { CandleChartCanvas } from "@/components/CandleChartCanvas";
import type { ChartBar } from "@/lib/charts/bars";

export type ChartRange = "1H" | "1D" | "1W" | "1M" | "3M";

export const CHART_RANGES: readonly ChartRange[] = ["1H", "1D", "1W", "1M", "3M"];

export function VenueChartFrame({
  symbol,
  last,
  changePercent,
  priceDecimals,
  range,
  onRange,
  bars,
  fitKey,
  tick,
  empty,
  source,
  sourceHref,
  controls,
}: {
  symbol: string;
  last: number | null;
  changePercent: number | null;
  priceDecimals: number;
  range: ChartRange;
  onRange: (range: ChartRange) => void;
  bars: ChartBar[];
  fitKey: string | null;
  tick?: number | null;
  // A message to lay over the plot instead of bars, or null to show them.
  empty: string | null;
  // Footer text on the left ("288 bars · 5m") and the source link on the right.
  source: string;
  sourceHref: string;
  // A venue's own controls, rendered beside the range buttons. Lighter puts
  // its trades/mark toggle here; Ondo has nothing to put.
  controls?: React.ReactNode;
}) {
  const positive = changePercent == null ? null : changePercent >= 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#111415]">
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-3 px-4 pt-3.5">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-medium text-white/90">{symbol}</span>
          <span className="font-mono text-xl font-light tabular-nums text-white">
            {last != null ? formatPrice(last, priceDecimals) : "—"}
          </span>
          {changePercent != null && (
            <span
              className={`font-mono text-xs tabular-nums ${
                positive ? "text-[#119b62]" : "text-[#d93232]"
              }`}
            >
              {positive ? "+" : ""}
              {changePercent.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {controls}
          <div className="flex gap-0.5 rounded-lg border border-white/[0.07] p-0.5">
            {CHART_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRange(r)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
                r === range
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {r}
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* The canvas stays mounted through every state so the chart object
          survives a market switch; the empty state is laid over it. */}
      <div className="relative min-h-0 flex-1 px-1 pb-1 pt-2">
        <CandleChartCanvas
          bars={bars}
          priceDecimals={priceDecimals}
          fitKey={fitKey}
          tick={tick}
        />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#111415] text-xs text-white/35">
            {empty}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.05] px-4 py-1.5 text-[10px] uppercase tracking-[0.12em] text-white/30">
        <span>{source}</span>
        <a
          href={sourceHref}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white/60"
        >
          TradingView charts
        </a>
      </div>
    </div>
  );
}

function formatPrice(price: number, decimals: number): string {
  return price.toLocaleString(undefined, {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: Math.max(2, Math.min(decimals, 8)),
  });
}
