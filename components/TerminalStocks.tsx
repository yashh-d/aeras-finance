"use client";

// The catalog as a grid of cards, grouped by asset class the way Home and
// Markets group it. A card selects its asset for the chart and ticket; it does
// not trade on its own, so it carries no controls, just the figures a reader
// scans a market page for: name, price, change and the last day's shape.

import { AssetLogo } from "@/components/AssetLogo";
import { Sparkline } from "@/components/Sparkline";
import type { SparklinesResponse } from "@/lib/jupiter/charts";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  XSTOCK_CATEGORIES,
  XSTOCKS,
  type XStock,
} from "@/lib/jupiter/xstocks";
import { changeColor, formatChange, formatQuotePrice } from "@/lib/terminal/display";

export function TerminalStocks({
  prices,
  sparks,
  selectedMint,
  onSelect,
}: {
  prices: JupiterPriceMap | null;
  sparks: SparklinesResponse | null;
  selectedMint: string;
  onSelect: (xstock: XStock) => void;
}) {
  const groups = XSTOCK_CATEGORIES.map((c) => ({
    ...c,
    assets: XSTOCKS.filter((x) => x.category === c.id),
  })).filter((g) => g.assets.length > 0);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.id}>
          <div className="flex items-baseline gap-2 pb-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
              {g.label}
            </span>
            <span className="text-[10px] tabular-nums text-white/25">
              {g.assets.length}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
            {g.assets.map((x) => (
              <StockCard
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
    </div>
  );
}

function StockCard({
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
  const price = entry?.usdPrice ?? null;
  const change = entry?.priceChange24h ?? null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
        selected
          ? "border-white/20 bg-white/[0.05]"
          : "border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-center gap-2">
        <AssetLogo xstock={xstock} size={24} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium tracking-tight text-white">
            {xstock.name}
          </div>
          <div className="truncate text-[11px] text-white/45">{xstock.symbol}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-1.5">
        <span className="font-mono text-[13px] tabular-nums text-white">
          {formatQuotePrice(price)}
        </span>
        <span className={`font-mono text-[10px] tabular-nums ${changeColor(change)}`}>
          {formatChange(change)}
        </span>
      </div>
      <Sparkline values={sparkline} stretch />
    </button>
  );
}
