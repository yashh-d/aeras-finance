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
import {
  AssetTile,
  Sparkline,
  ViewToggle,
  formatAssetPrice,
  priceDisplay,
} from "@/components/AssetTile";
import { hasLendingMarket } from "@/lib/borrow/availability";
import { useViewMode } from "@/lib/ui/use-view-mode";
import { ChevronRight } from "lucide-react";

const SPARKLINE_REFRESH_MS = 60_000;

// Home's own remembered list-or-grid choice. Markets keeps a separate key: the
// two surfaces show different things, so the preference is per surface.
const HOME_VIEW_STORAGE_KEY = "aeras.home.assets.view";

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

  const [view, setView] = useViewMode(HOME_VIEW_STORAGE_KEY);

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
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Assets
        </div>
        <div className="flex items-center gap-3">
          {error ? (
            <span className="inline-flex items-center gap-1 text-xs text-aeras-warning">
              <span className="inline-block size-1.5 rounded-full bg-aeras-warning" />
              Price feed offline
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-white/50">
              <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
              Live
            </span>
          )}
          <ViewToggle view={view} onChange={setView} />
        </div>
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
          {view === "grid" ? (
            // Two up on a phone, three in the two-thirds card on desktop. Four
            // would take the tile under the width its price row needs.
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {g.assets.map((x) => (
                <AssetTile
                  key={x.mint}
                  xstock={x}
                  entry={prices?.[x.mint]}
                  sparkline={sparks?.[x.mint]}
                  selected={selectedMint === x.mint}
                  onClick={() => onSelect(x)}
                />
              ))}
            </div>
          ) : (
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
          )}
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

// One asset as a row, and the default view. Same grammar as the Borrow and
// Markets rows: full-width control, hover wash, chevron. The first attempt at a
// grid here was bubbles, which made every asset the same visual weight and left
// nowhere for price or change to sit; that is why the row is still the default
// and why AssetTile below gives both their own line.
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
  const { price, change, positive, changeColor, sparkStroke } =
    priceDisplay(entry);

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
          {price == null ? "\u2014" : `$${formatAssetPrice(price)}`}
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
