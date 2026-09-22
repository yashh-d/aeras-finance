"use client";

// The asset tile the grid view draws, the list/grid toggle beside it, and the
// price and sparkline helpers both the tile and the list row read.
//
// Shared by Home (components/AssetGrid.tsx) and Markets (the Markets tab in
// app/app/page.tsx) rather than written twice, so the two grids cannot disagree
// about what a tile looks like or about what counts as up.

import { LayoutGrid, List } from "lucide-react";

import { AssetLogo, LendingBadge } from "@/components/AssetLogo";
import { hasLendingMarket } from "@/lib/borrow/availability";
import { formatUsdPrice } from "@/lib/format";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { XStock } from "@/lib/jupiter/xstocks";
import type { ViewMode } from "@/lib/ui/use-view-mode";

export function AssetTile({
  xstock,
  entry,
  sparkline,
  selected,
  held,
  onClick,
}: {
  xstock: XStock;
  entry: JupiterPriceMap[string] | undefined;
  sparkline: number[] | undefined;
  selected: boolean;
  // What the user holds, when the surface knows. Markets carries a Holdings
  // column in its list view, so its tiles state the same thing rather than
  // dropping it on the way to the grid. Home has no balances here and passes
  // nothing, which renders no line at all rather than a zero.
  held?: number;
  onClick: () => void;
}) {
  const { price, change, positive, changeColor, sparkStroke } =
    priceDisplay(entry);

  return (
    // No overflow-hidden: LendingBadge hangs its hover card above itself and
    // clipping the tile would cut it off.
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
      <div className="flex items-start justify-between gap-2">
        <AssetLogo xstock={xstock} size={26} />
        {hasLendingMarket(xstock.mint) && <LendingBadge size={12} />}
      </div>

      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium tracking-tight text-white">
          {xstock.name}
        </div>
        <div className="truncate text-[11px] text-white/45">
          {xstock.symbol}
        </div>
      </div>

      <Sparkline values={sparkline} strokeClassName={sparkStroke} stretch />

      {/* A step down from the row's 14/11, because two tiles across a phone
          leave about 105px here and the four-digit gold prices ($4315.09) need
          every one of them: at the row's sizes they push the change 8px past
          the tile edge. flex-wrap is the backstop, so an unexpectedly long
          figure drops to its own line rather than overflowing. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-1.5">
        <span className="font-mono text-[13px] tabular-nums text-white">
          {price == null ? "—" : `$${formatAssetPrice(price)}`}
        </span>
        <span className={`font-mono text-[10px] tabular-nums ${changeColor}`}>
          {change == null
            ? "—"
            : `${positive ? "+" : ""}${change.toFixed(2)}%`}
        </span>
      </div>

      {/* Only when there is something to state. A row of "0" against every
          tile in the catalog is noise, and the list view leaves the cell blank
          for the same reason. */}
      {held != null && held > 0 && (
        <div className="font-mono text-[10px] tabular-nums text-white/45">
          {formatHeld(held)} held
        </div>
      )}
    </button>
  );
}

export function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Asset layout"
      className="flex items-center gap-0.5 rounded-lg border border-white/[0.08] p-0.5"
    >
      <ViewToggleButton
        icon={List}
        label="List view"
        active={view === "list"}
        onClick={() => onChange("list")}
      />
      <ViewToggleButton
        icon={LayoutGrid}
        label="Grid view"
        active={view === "grid"}
        onClick={() => onChange("grid")}
      />
    </div>
  );
}

function ViewToggleButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof List;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`inline-flex size-6 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-white/[0.09] text-white"
          : "text-white/40 hover:bg-white/5 hover:text-white/70"
      }`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

// Shared by the row and the tile so the two views cannot disagree about what
// counts as up.
export function priceDisplay(entry: JupiterPriceMap[string] | undefined) {
  const price = entry?.usdPrice;
  const change = entry?.priceChange24h;
  const positive = change == null ? null : change >= 0;
  return {
    price,
    change,
    positive,
    changeColor:
      positive == null
        ? "text-white/40"
        : positive
          ? "text-aeras-positive"
          : "text-aeras-negative",
    sparkStroke:
      positive == null
        ? "stroke-aeras-100"
        : positive
          ? "stroke-aeras-positive"
          : "stroke-aeras-negative",
  };
}

export function Sparkline({
  values,
  strokeClassName,
  stretch = false,
}: {
  values: number[] | undefined;
  strokeClassName: string;
  // Fill the container's width instead of sitting at a fixed 60px. Used by the
  // tile, where the sparkline is the full-width element.
  stretch?: boolean;
}) {
  const W = 60;
  const H = 18;
  if (!values || values.length < 2) {
    return (
      <div className={stretch ? "h-[22px] w-full" : "h-[18px] w-[60px]"} />
    );
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
      width={stretch ? undefined : W}
      height={stretch ? undefined : H}
      // Stretching means the viewBox no longer matches the box's aspect ratio,
      // so the line has to be allowed to distort to fill it. non-scaling-stroke
      // below keeps that distortion off the stroke width, which would otherwise
      // come out thin and uneven.
      preserveAspectRatio={stretch ? "none" : undefined}
      className={
        stretch ? "h-[22px] w-full overflow-visible" : "overflow-visible"
      }
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect={stretch ? "non-scaling-stroke" : undefined}
        className={strokeClassName}
      />
    </svg>
  );
}

export function formatAssetPrice(price: number): string {
  return formatUsdPrice(price);
}

// Share counts, not dollars. Tokenised equities are 6 or 8 decimals and a
// holding is usually fractional, so trailing zeros are trimmed rather than
// padded to a fixed width.
function formatHeld(amount: number): string {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
