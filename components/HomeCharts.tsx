"use client";

// Price charts for the bottom-left of Home, each its own card with its own
// picker, and a card-shaped button below them to add another.
//
// The picker (ChartAssetPicker) sits where the chart's title was, so the
// control that chooses the series is the thing that names it. It browses five
// groups: equities, commodities, RWA, perps, crypto.
//
// Two data sources draw through one view. Catalog and chart-only assets fetch
// from Coingecko through PriceChart; a perp fetches Lighter's own candles and
// hands them to the same PriceSeriesView, so a BTC perp beside Apple reads as
// the same kind of chart rather than a different terminal.
//
// Which asset each slot shows, and how many there are, is owned by the page,
// not here: the asset grid steers the first slot when a row is clicked, and
// that has to happen in the same state the pickers write to or the two would
// fight.

import { Plus, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { ChartAssetPicker } from "@/components/ChartAssetPicker";
import {
  PriceChart,
  PriceSeriesView,
  type PriceSeriesIdentity,
} from "@/components/PriceChart";
import {
  chartSubjectByKey,
  MAX_HOME_CHARTS,
  type ChartSelection,
} from "@/lib/jupiter/chart-assets";
import type { ChartRange, OhlcCandle } from "@/lib/jupiter/charts";
import type { LighterMarket } from "@/lib/lighter/types";
import { useCandles } from "@/lib/lighter/use-candles";
import { useLighterCatalog } from "@/lib/lighter/use-catalog";
import { marketLogo } from "@/lib/tokens/market-logos";
import { GLASS_SURFACE } from "@/lib/ui/surface";

export function HomeCharts({
  selections,
  onChange,
  onAdd,
  onRemove,
}: {
  selections: readonly ChartSelection[];
  onChange: (index: number, next: ChartSelection) => void;
  // Absent means the set is fixed: no add button, no remove controls.
  onAdd?: () => void;
  onRemove?: (index: number) => void;
}) {
  const catalog = useLighterCatalog();
  // The card whose picker is open. Each card's glass surface is a stacking
  // context of its own (GLASS_SURFACE carries `isolate`), so a panel hanging
  // below one card would paint under the next; lifting the open card's z-index
  // is what keeps the panel on top.
  const [openSlot, setOpenSlot] = useState<number | null>(null);

  // The last chart cannot be removed: an empty column would leave nothing to
  // add from, since the add button sits under the charts.
  const removable = onRemove != null && selections.length > 1;

  return (
    <div className="space-y-6">
      {selections.map((selection, i) => (
        <div
          key={i}
          className={`${GLASS_SURFACE} p-5 text-white lg:p-6 ${
            openSlot === i ? "relative z-30" : ""
          }`}
        >
          <ChartSlot
            selection={selection}
            markets={catalog.markets}
            marketsLoading={catalog.loading}
            marketsError={catalog.error}
            onChange={(next) => onChange(i, next)}
            onOpenChange={(open) =>
              setOpenSlot((prev) => (open ? i : prev === i ? null : prev))
            }
            actions={
              removable ? (
                <button
                  type="button"
                  aria-label="Remove chart"
                  onClick={() => {
                    setOpenSlot(null);
                    onRemove(i);
                  }}
                  className="ml-1 text-white/35 transition-colors hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : undefined
            }
          />
        </div>
      ))}

      {onAdd && selections.length < MAX_HOME_CHARTS && (
        // The same surface as the cards above it, so it reads as the place
        // the next chart will appear rather than as a control panel.
        <button
          type="button"
          onClick={onAdd}
          className={`${GLASS_SURFACE} flex w-full items-center justify-center gap-2 py-4 text-sm font-medium text-white/50 transition-colors hover:text-white`}
        >
          <Plus className="h-4 w-4" />
          Add chart
        </button>
      )}
    </div>
  );
}

function ChartSlot({
  selection,
  markets,
  marketsLoading,
  marketsError,
  onChange,
  onOpenChange,
  actions,
}: {
  selection: ChartSelection;
  markets: LighterMarket[];
  marketsLoading: boolean;
  marketsError: string | null;
  onChange: (next: ChartSelection) => void;
  onOpenChange: (open: boolean) => void;
  actions?: ReactNode;
}) {
  const picker = (
    <ChartAssetPicker
      value={selection}
      markets={markets}
      marketsLoading={marketsLoading}
      onChange={onChange}
      onOpenChange={onOpenChange}
    />
  );

  if (selection.kind === "perp") {
    return (
      <PerpChart
        symbol={selection.symbol}
        market={markets.find((m) => m.symbol === selection.symbol)}
        catalogLoading={marketsLoading}
        catalogError={marketsError}
        title={picker}
        actions={actions}
      />
    );
  }

  const subject = chartSubjectByKey(selection.key);
  if (!subject) {
    // A key that no registry knows. Cannot happen through the picker, so it
    // is a stale selection from somewhere else; the picker is still shown so
    // the slot can be recovered.
    return (
      <PriceSeriesView
        identity={{ symbol: "?", name: "Unknown asset" }}
        candles={null}
        loading={false}
        error="No such asset"
        range="1D"
        onRange={() => {}}
        title={picker}
        actions={actions}
        variant="detailed"
        heightClass={PLOT_HEIGHT}
      />
    );
  }
  return (
    <PriceChart
      ticker={subject}
      title={picker}
      actions={actions}
      variant="detailed"
      heightClass={PLOT_HEIGHT}
    />
  );
}

// Taller than the dashboard default: the detailed variant spends the bottom
// 26px of the plot box on the x-axis labels, and the line should not pay for
// them.
const PLOT_HEIGHT = "h-48";

// Lighter's candles, redrawn in the Coingecko chart's shape. Millisecond bar
// times become seconds here, which is the one conversion between the two.
// Exported for the Terminal, whose chart switches to this when the ticket
// switches to perps: the perp is a different market from the xStock and is
// priced by its own book, so it gets its own series rather than a relabel.
export function PerpChart({
  symbol,
  market,
  catalogLoading,
  catalogError,
  title,
  actions,
  heightClass = PLOT_HEIGHT,
  showHeading,
}: {
  symbol: string;
  market: LighterMarket | undefined;
  catalogLoading: boolean;
  catalogError: string | null;
  title?: ReactNode;
  actions?: ReactNode;
  heightClass?: string;
  showHeading?: boolean;
}) {
  const [range, setRange] = useState<ChartRange>("1D");
  const { series, loading, error } = useCandles(market?.marketId ?? null, range);

  const candles = useMemo<OhlcCandle[] | null>(
    () =>
      series
        ? series.candles.map((c) => ({
            t: Math.floor(c.t / 1000),
            o: c.o,
            h: c.h,
            l: c.l,
            c: c.c,
            v: c.v,
          }))
        : null,
    [series],
  );

  const identity: PriceSeriesIdentity = {
    symbol,
    name: `${symbol} perp`,
    logo: marketLogo(symbol),
  };
  const shownError =
    error ??
    catalogError ??
    (!catalogLoading && !market ? `No Lighter market for ${symbol}` : null);

  return (
    <PriceSeriesView
      identity={identity}
      candles={candles}
      loading={catalogLoading || loading}
      error={shownError}
      range={range}
      onRange={setRange}
      title={title}
      actions={actions}
      variant="detailed"
      heightClass={heightClass}
      showHeading={showHeading}
    />
  );
}
