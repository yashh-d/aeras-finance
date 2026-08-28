"use client";

import { useEffect, useState } from "react";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { fetchSparklines, type SparklinesResponse } from "@/lib/jupiter/charts";
import {
  XSTOCK_CATEGORIES,
  XSTOCKS,
  type XStock,
} from "@/lib/jupiter/xstocks";
import { AssetLogo, LendingBadge } from "@/components/AssetLogo";
import { hasLendingMarket } from "@/lib/borrow/availability";
import { ChevronRight } from "lucide-react";

const SPARKLINE_REFRESH_MS = 60_000;

// Rows shown per asset class on Home. The card sits beside the wallet in a
// fixed-height row, so this is a display budget rather than a view of the
// catalog: anything past it belongs on Markets, which is built to page through
// the whole list. Registry order is the curation, so the first few are the ones
// worth surfacing.
const HOME_GROUP_ROWS = 9;

export function AssetGrid({
  prices,
  pricesError,
  selectedMint,
  onSelect,
  onSeeAll,
}: {
  prices: JupiterPriceMap | null;
  pricesError: string | null;
  selectedMint: string;
  onSelect: (xstock: XStock) => void;
  // Sends the user to the Markets tab, where the full catalog lives.
  onSeeAll: () => void;
}) {
  const [sparks, setSparks] = useState<SparklinesResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSparks() {
      try {
        const next = await fetchSparklines();
        if (!cancelled) setSparks(next);
      } catch {
        // Sparklines are nice-to-have; don't surface as a grid error.
      }
    }

    loadSparks();
    const id = setInterval(loadSparks, SPARKLINE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const error = pricesError;

  // Registry order within a class, category order across them. Empty classes
  // are dropped rather than rendered as a label with nothing under it.
  const groups = XSTOCK_CATEGORIES.map((c) => {
    const assets = XSTOCKS.filter((x) => x.category === c.id);
    return { ...c, assets: assets.slice(0, HOME_GROUP_ROWS), total: assets.length };
  }).filter((g) => g.assets.length > 0);
  const hidden = XSTOCKS.length - groups.reduce((n, g) => n + g.assets.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Assets
        </div>
        {error ? (
          <span className="inline-flex items-center gap-1 text-xs text-aeras-warning">
            <span className="inline-block size-1.5 rounded-full bg-aeras-warning" />
            Price feed offline
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-white/50">
            <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
            Live · 10s
          </span>
        )}
      </div>
      {/* Grouped by asset class, using the same categories the Markets tab
          groups by. No filter pills here: a label between runs is enough to
          stop the index funds and the metal reading as more single-name
          equities at the bottom of the list, and the overflow link below does
          the narrowing that pills would. */}
      {groups.map((g) => (
        <div key={g.id}>
          <div className="flex items-baseline justify-between pb-1 pt-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
              {g.label}
            </span>
            {g.total > g.assets.length && (
              <span className="text-[10px] tabular-nums text-white/25">
                {g.assets.length} of {g.total}
              </span>
            )}
          </div>
          <div className="divide-y divide-white/[0.07]">
            {g.assets.map((x) => (
              <AssetRow
                key={x.mint}
                xstock={x}
                entry={prices?.[x.mint]}
                sparkline={sparks?.[x.mint]}
                selected={selectedMint === x.mint}
                onClick={() => onSelect(x)}
              />
            ))}
          </div>
        </div>
      ))}

      {hidden > 0 && (
        <button
          type="button"
          onClick={onSeeAll}
          className="flex w-full items-center justify-center gap-1 pt-1 text-[11px] font-medium text-white/50 transition-colors hover:text-white"
        >
          See all {XSTOCKS.length} in Markets
          <ChevronRight className="size-3" />
        </button>
      )}
    </div>
  );
}

// One asset as a row rather than a tile. Same grammar as the Borrow and Markets
// rows: full-width control, hover wash, chevron. A grid of bubbles made every
// asset the same visual weight and left nowhere for price or change to sit.
//
// Clicking opens the drilled-in view (chart + ticket) in place of this list, so
// the chevron points right: it navigates, it does not disclose.
function AssetRow({
  xstock,
  entry,
  sparkline,
  selected,
  onClick,
}: {
  xstock: XStock;
  entry: JupiterPriceMap[string] | undefined;
  sparkline: number[] | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  const price = entry?.usdPrice;
  const change = entry?.priceChange24h;
  const positive = change == null ? null : change >= 0;
  const changeColor =
    positive == null
      ? "text-white/40"
      : positive
        ? "text-aeras-positive"
        : "text-aeras-negative";
  const sparkStroke =
    positive == null
      ? "stroke-aeras-100"
      : positive
        ? "stroke-aeras-positive"
        : "stroke-aeras-negative";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 py-2.5 text-left transition-colors ${
        selected ? "bg-white/[0.03]" : "hover:bg-white/5"
      }`}
    >
      <AssetLogo xstock={xstock} size={28} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium tracking-tight text-white">
          {xstock.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate text-[11px] text-white/45">
            {xstock.symbol}
          </span>
          {hasLendingMarket(xstock.mint) && <LendingBadge size={12} />}
        </div>
      </div>

      <div className="hidden sm:block">
        <Sparkline values={sparkline} strokeClassName={sparkStroke} />
      </div>

      <div className="w-[5.5rem] shrink-0 text-right">
        <div className="font-mono text-sm tabular-nums text-white">
          {price == null ? "\u2014" : `$${formatPrice(price)}`}
        </div>
        <div className={`font-mono text-[11px] tabular-nums ${changeColor}`}>
          {change == null
            ? "\u2014"
            : `${positive ? "+" : ""}${change.toFixed(2)}%`}
        </div>
      </div>

      <ChevronRight className="size-4 shrink-0 text-white/30" />
    </button>
  );
}

function Sparkline({
  values,
  strokeClassName,
}: {
  values: number[] | undefined;
  strokeClassName: string;
}) {
  const W = 60;
  const H = 18;
  if (!values || values.length < 2) {
    return <div className="h-[18px] w-[60px]" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = W / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = H - ((v - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="overflow-visible"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClassName}
      />
    </svg>
  );
}

function formatPrice(price: number): string {
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}
