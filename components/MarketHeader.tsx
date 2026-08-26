"use client";

// Selector plus live stat strip for one perps market. Presentational: the
// caller owns the catalog and the selection.
//
// Shared by both surfaces that show a market. The perps tab already holds the
// catalog in its own hook, and the hedge tab fetches its own, so neither should
// be forced to adopt the other's data flow just to reuse the header.

import { MarketSelector } from "@/components/MarketSelector";
import { marketTicker } from "@/lib/tokens/market-logos";
import type { OndoMarket } from "@/lib/ondo/types";

function stat(
  v: string | null | undefined,
  fmt: (n: number) => string,
): string {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? fmt(n) : "\u2014";
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
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <MarketSelector
          markets={markets}
          selected={selected}
          onSelect={onSelect}
          loading={loading}
        />

        {selected && (
          <>
            <Stat label="Price" value={stat(selected.price, usd)} mono />
            <Stat
              label="24h Change"
              value={
                Number.isFinite(change)
                  ? `${change >= 0 ? "\u25b2" : "\u25bc"} ${Math.abs(change).toFixed(2)}%`
                  : "\u2014"
              }
              tone={changeUp ? "positive" : "negative"}
              mono
            />
            <Stat
              label="24h Volume"
              value={stat(selected.usdVolume, compact)}
              mono
            />
            <Stat
              label="Open Interest"
              value={stat(selected.openInterestUsd, compact)}
              mono
            />
            <Stat
              label="Funding"
              value={stat(
                selected.fundingRate,
                (n) => `${(n * 100).toFixed(5)}%`,
              )}
              mono
            />
          </>
        )}
      </div>

      {selected && !selected.tradeable && (
        <p className="mt-3 text-[11px] text-aeras-warning">
          {marketTicker(selected.market)} is disabled by Ondo right now, so it
          cannot be traded even though it is listed.
        </p>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  mono?: boolean;
}) {
  const color =
    tone === "positive"
      ? "text-aeras-positive"
      : tone === "negative"
        ? "text-aeras-negative"
        : "text-white";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">
        {label}
      </div>
      <div className={`mt-0.5 text-sm ${mono ? "font-mono" : ""} ${color}`}>
        {value}
      </div>
    </div>
  );
}
