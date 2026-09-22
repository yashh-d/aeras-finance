"use client";

// The chart card for a bare Lighter market, one with no catalog asset behind
// it. The same header as the asset detail, the picker and the leverage pill
// with the mark and Lighter's 24h at the right, then the market's own candles
// as a line or as candles. No tabs: there is no company here, so no
// financials, filings or headlines to tab to.

import { useState } from "react";

import { PerpChart } from "@/components/HomeCharts";
import { LighterChart } from "@/components/LighterChart";
import { TerminalAssetPicker } from "@/components/TerminalAssetPicker";
import type { TicketMode } from "@/components/TerminalTicket";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { PERPS_CANDLE_RANGES } from "@/lib/lighter/candles";
import type { LighterMarket } from "@/lib/lighter/types";
import { changeColor, formatChange, formatQuotePrice } from "@/lib/terminal/display";
import type { TerminalSelection } from "@/lib/terminal/selection";

type ChartKind = "line" | "candles";

export function TerminalPerpDetail({
  symbol,
  market,
  perpMarkets,
  prices,
  catalogLoading,
  catalogError,
  onPick,
  onPickerOpen,
}: {
  symbol: string;
  // Null while the catalog loads, or if the market has gone inactive.
  market: LighterMarket | null;
  perpMarkets: readonly LighterMarket[];
  prices: JupiterPriceMap | null;
  catalogLoading: boolean;
  catalogError: string | null;
  onPick: (selection: TerminalSelection, mode: TicketMode) => void;
  onPickerOpen?: (open: boolean) => void;
}) {
  const [chartKind, setChartKind] = useState<ChartKind>("line");
  const mark = market ? Number(market.markPrice) || null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <TerminalAssetPicker
            value={{ kind: "perp", symbol }}
            mode="perps"
            prices={prices}
            perpMarkets={perpMarkets}
            onSelect={onPick}
            onOpenChange={onPickerOpen}
            variant="detail"
          />
          {market && (
            <span
              title={`Up to ${market.maxLeverage}x on ${market.symbol} on Lighter`}
              className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white/70"
            >
              {market.maxLeverage}x
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="font-mono text-[2rem] font-light tabular-nums leading-none text-white">
            {formatQuotePrice(mark)}
          </div>
          <div
            className={`mt-1.5 font-mono text-sm tabular-nums ${changeColor(market?.dailyPriceChange ?? null)}`}
          >
            {formatChange(market?.dailyPriceChange ?? null)}{" "}
            <span className="text-white/40">24h</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end border-t border-white/10 pt-3">
        <div className="inline-flex shrink-0 rounded-lg border border-white/10 p-0.5 text-xs">
          {(["line", "candles"] as ChartKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setChartKind(k)}
              aria-pressed={chartKind === k}
              className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${
                chartKind === k ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {!market && !catalogLoading ? (
        <p className="py-8 text-center text-sm text-white/40">
          {catalogError ?? `${symbol} is not a tradeable Lighter market right now.`}
        </p>
      ) : chartKind === "line" ? (
        <PerpChart
          key={symbol}
          symbol={symbol}
          market={market ?? undefined}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          heightClass="h-72"
          showHeading={false}
        />
      ) : market ? (
        <LighterChart
          key={symbol}
          marketId={market.marketId}
          symbol={market.symbol}
          markPrice={Number(market.markPrice)}
          ranges={PERPS_CANDLE_RANGES}
        />
      ) : (
        <p className="py-8 text-center text-sm text-white/40">Loading markets</p>
      )}
    </div>
  );
}
