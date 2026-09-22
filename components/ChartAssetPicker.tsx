"use client";

// Asset browser for one Home chart. A trigger where the chart's title sits,
// and a panel with search, group tabs and a list, in the shape of the perps
// tab's MarketSelector minus the market statistics. The rows here choose what
// to look at, not what to trade, so a mark, a name and which shelf it sits on
// is the whole row; price, volume and funding belong to the chart and the
// perps tab respectively.
//
// Perps are the one group that needs restraint. Lighter lists over two hundred
// markets, and browsing that many in a list is scrolling, not choosing, so
// with no search typed the perps shown are the busiest by 24h volume. A typed
// search matches every market, so nothing is unreachable, only unlisted.

import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import {
  CHART_GROUPS,
  chartGroupMembers,
  chartKeyOf,
  chartSelectionId,
  chartSubjectByKey,
  type ChartGroupId,
  type ChartSelection,
} from "@/lib/jupiter/chart-assets";
import type { LighterMarket } from "@/lib/lighter/types";
import { marketLogo } from "@/lib/tokens/market-logos";

const PERP_BROWSE_LIMIT = 60;

// Short shelf names for the right edge of a row. Singular, since they label
// one thing, and "Perp" rather than "Perps" for the same reason.
const GROUP_TAG: Record<ChartGroupId, string> = {
  equities: "Equity",
  commodities: "Commodity",
  rwa: "RWA",
  perps: "Perp",
  crypto: "Crypto",
};

interface Row {
  id: string;
  selection: ChartSelection;
  symbol: string;
  name: string;
  logo?: string;
  group: ChartGroupId;
  // Perps only. Shown as the small pill the venue itself puts beside a ticker.
  leverage?: number;
}

export function ChartAssetPicker({
  value,
  markets,
  marketsLoading,
  onChange,
  onOpenChange,
}: {
  value: ChartSelection;
  markets: LighterMarket[];
  marketsLoading: boolean;
  onChange: (next: ChartSelection) => void;
  // Lets the card around this lift itself above its siblings while the panel
  // is open. See HomeCharts.
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ChartGroupId | "all">("all");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  // Everything the picker can offer, before any filter. Perps are ordered by
  // volume so the busiest lead when browsing; the other groups keep their
  // catalog order, which is already curated.
  const allRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    for (const g of CHART_GROUPS) {
      if (g.id === "perps") {
        [...markets]
          .sort(
            (a, b) => Number(b.dailyQuoteVolume) - Number(a.dailyQuoteVolume),
          )
          .forEach((m) => {
            const selection: ChartSelection = { kind: "perp", symbol: m.symbol };
            rows.push({
              id: chartSelectionId(selection),
              selection,
              symbol: m.symbol,
              name: `${m.symbol} perp`,
              logo: marketLogo(m.symbol),
              group: "perps",
              leverage: m.maxLeverage,
            });
          });
      } else {
        chartGroupMembers(g.id).forEach((subject) => {
          const selection: ChartSelection = {
            kind: "asset",
            key: chartKeyOf(subject),
          };
          rows.push({
            id: chartSelectionId(selection),
            selection,
            symbol: subject.symbol,
            name: subject.name,
            logo: subject.logo,
            group: g.id,
          });
        });
      }
    }
    return rows;
  }, [markets]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let perpsSeen = 0;
    return allRows.filter((row) => {
      if (group !== "all" && row.group !== group) return false;
      if (q) {
        return (
          row.symbol.toLowerCase().includes(q) ||
          row.name.toLowerCase().includes(q)
        );
      }
      if (row.group === "perps") {
        perpsSeen += 1;
        return perpsSeen <= PERP_BROWSE_LIMIT;
      }
      return true;
    });
  }, [allRows, group, query]);

  // Clamped during render rather than reset in an effect: filtering can shrink
  // the list under the highlight, and correcting that in an effect costs an
  // extra render pass and trips the cascading-render lint rule.
  const active = Math.max(0, Math.min(cursor, rows.length - 1));

  const valueId = chartSelectionId(value);
  const selectedRow = allRows.find((row) => row.id === valueId);
  // A perp chosen before the catalog has loaded has no row yet, and an asset
  // key is always resolvable, so the label never has to be blank.
  const label =
    selectedRow?.name ??
    (value.kind === "perp"
      ? `${value.symbol} perp`
      : (chartSubjectByKey(value.key)?.name ?? "Select"));

  // Closing resets the filters, so reopening always starts from the full
  // list. Done here rather than in an effect on `open`: an effect would fire
  // after the close has already painted, which both flashes the stale filter
  // and trips the cascading-render rule.
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setGroup("all");
    setCursor(0);
  }, [setOpen]);

  // Focusing the input is a DOM side effect, which is what an effect is for.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Close on a press anywhere outside. A document listener rather than a
  // full-screen backdrop: the card this sits in has a backdrop blur, which
  // makes it the containing block for fixed descendants, so a backdrop would
  // cover the card and nothing beyond it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  function choose(row: Row) {
    onChange(row.selection);
    close();
  }

  function onPanelKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? active + 1 : active - 1;
      const clamped = Math.max(0, Math.min(rows.length - 1, next));
      listRef.current
        ?.querySelectorAll("[data-row]")
        [clamped]?.scrollIntoView({ block: "nearest" });
      setCursor(clamped);
    }
    if (e.key === "Enter" && rows[active]) {
      e.preventDefault();
      choose(rows[active]);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Styled as the label it replaces, so the heading still reads as
          "<name>" over the price; the chevron is what says it opens. */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50 transition-colors hover:text-white"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-white/40 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <>
          <div
            className="absolute left-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-white/10 bg-aeras-hero-from shadow-2xl"
            onKeyDown={onPanelKey}
          >
            <div className="p-3">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
                <Search className="h-4 w-4 shrink-0 text-white/40" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCursor(0);
                  }}
                  placeholder={
                    marketsLoading
                      ? "Search assets"
                      : `Search ${allRows.length} assets and markets`
                  }
                  className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-white/35"
                />
              </div>
            </div>

            <div className="flex gap-4 overflow-x-auto border-b border-white/10 px-4">
              {[{ id: "all" as const, label: "All" }, ...CHART_GROUPS].map(
                (g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setGroup(g.id);
                      setCursor(0);
                    }}
                    className={`-mb-px shrink-0 border-b-2 pb-2.5 text-sm transition-colors ${
                      group === g.id
                        ? "border-white text-white"
                        : "border-transparent text-white/50 hover:text-white/80"
                    }`}
                  >
                    {g.label}
                  </button>
                ),
              )}
            </div>

            <div
              ref={listRef}
              role="listbox"
              className="max-h-72 overflow-y-auto"
            >
              {rows.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-white/40">
                  {marketsLoading && group === "perps"
                    ? "Loading markets"
                    : `Nothing matches "${query}".`}
                </p>
              )}
              {rows.map((row, i) => {
                const current = row.id === valueId;
                return (
                  <button
                    key={row.id}
                    data-row
                    type="button"
                    role="option"
                    aria-selected={current}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(row)}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                      i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <AssetLogo
                      xstock={{ symbol: row.symbol, name: row.name, logo: row.logo }}
                      size={28}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`truncate text-sm font-medium ${
                            current ? "text-aeras-blue" : "text-white"
                          }`}
                        >
                          {row.group === "perps" ? row.symbol : row.name}
                        </span>
                        {row.leverage != null && (
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                            {row.leverage}x
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-white/45">
                        {row.group === "perps" ? "Lighter perpetual" : row.symbol}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
                      {GROUP_TAG[row.group]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
