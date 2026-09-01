"use client";

// Selector plus live stat strip for one Ondo perps market. Presentational: the
// caller owns the catalog and the selection.
//
// Shared by both surfaces that show a market. The perps tab already holds the
// catalog in its own hook, and the hedge tab fetches its own, so neither should
// be forced to adopt the other's data flow just to reuse the header.
//
// The cells come from PerpsTerminal rather than being defined here, so an Ondo
// stat and a Lighter stat are the same object on screen. Only the figures
// behind them differ, which is the point: Ondo states a funding rate and a
// disabled flag, Lighter states a fee of zero.
//
// The rail scrolls sideways rather than wrapping. Wrapping added a row at some
// widths and not others, which changed the height of everything below it as the
// window moved.

import { MarketSelector } from "@/components/MarketSelector";
import { TerminalStat } from "@/components/PerpsTerminal";
import { marketTicker } from "@/lib/tokens/market-logos";
import type { OndoMarket } from "@/lib/ondo/types";

function stat(
  v: string | null | undefined,
  fmt: (n: number) => string,
): string {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? fmt(n) : "—";
}

const usd = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: n < 1 ? 4 : 2,
    maximumFractionDigits: n < 1 ? 4 : 2,
  })}`;

const compact = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(2)}M`
      : n >= 1e3
        ? `$${(n / 1e3).toFixed(2)}K`
        : `$${n.toFixed(0)}`;

export function MarketHeader({
  markets,
  selected,
  onSelect,
  loading,
}: {
  markets: OndoMarket[];
  selected: OndoMarket | null;
  onSelect: (market: OndoMarket) => void;
  loading?: boolean;
}) {
  const change = Number(selected?.priceChangePercent);
  const changeUp = !Number.isFinite(change) || change >= 0;

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <MarketSelector
            markets={markets}
            selected={selected}
            onSelect={onSelect}
            loading={loading}
          />
        </div>

        {selected && (
          <div className="flex min-w-0 flex-1 items-center gap-6 overflow-x-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TerminalStat
              label="Mark price"
              value={stat(selected.price, usd)}
              emphasis
            />
            <TerminalStat
              label="24h change"
              value={
                Number.isFinite(change)
                  ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
                  : "—"
              }
              tone={changeUp ? "positive" : "negative"}
            />
            <TerminalStat
              label="24h volume"
              value={stat(selected.usdVolume, compact)}
            />
            <TerminalStat
              label="Open interest"
              value={stat(selected.openInterestUsd, compact)}
            />
            <TerminalStat
              label="Funding"
              value={stat(
                selected.fundingRate,
                (n) => `${(n * 100).toFixed(4)}%`,
              )}
              hint="hourly"
            />
            <TerminalStat
              label="Taker fee"
              value={stat(
                selected.takerFee,
                (n) => `${(n * 10_000).toFixed(1)} bps`,
              )}
            />
            <TerminalStat
              label="Max leverage"
              value={
                selected.maxLeverage ? `${selected.maxLeverage}×` : "—"
              }
            />
            {/* Markets follow the underlying exchange calendars, so a closed
                market is the normal overnight state rather than a fault. A
                market order needs an open book, so it is worth stating on the
                header rather than only in the ticket's warning. */}
            <TerminalStat
              label="State"
              value={selected.isClosed ? "Closed" : "Open"}
              tone={selected.isClosed ? "negative" : undefined}
            />
          </div>
        )}
      </div>

      {selected && !selected.tradeable && (
        <p className="mt-2 text-[11px] text-aeras-warning">
          {marketTicker(selected.market)} is disabled by Ondo right now, so it
          cannot be traded even though it is listed.
        </p>
      )}
    </>
  );
}
