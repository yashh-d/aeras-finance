"use client";

// Asset browser for the Terminal, in the shape of the perps tab's market
// selector: a trigger where the asset's name sits, and a panel with search,
// category tabs and rows. It is mounted twice, on the detail header and on
// the ticket header, and both pick into the same state, so choosing from
// either moves the chart, the ticket and the news together.
//
// The rows are the catalog, grouped as the catalog groups itself, plus every
// tradeable Lighter market under Perps, busiest first. A market on a catalog
// underlying selects that asset with the ticket in perps mode, so the asset's
// news and financials stay up while its perp is traded; any other market
// selects the bare perp, which has the perp ticket and its chart and nothing
// else. Lighter lists over two hundred markets, so with no search typed the
// perps shown are the busiest sixty; a typed search matches all of them.

import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import { MarketLogo } from "@/components/MarketLogo";
import type { TicketMode } from "@/components/TerminalTicket";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  XSTOCK_CATEGORIES,
  XSTOCKS,
  type XStockCategory,
} from "@/lib/jupiter/xstocks";
import type { LighterMarket } from "@/lib/lighter/types";
import { compactUsd } from "@/lib/company/format";
import { changeColor, formatChange, formatQuotePrice } from "@/lib/terminal/display";
import { perpName, underlyingTicker, xstockForPerp } from "@/lib/terminal/quotes";
import { selectionId, type TerminalSelection } from "@/lib/terminal/selection";
import { marketLogo } from "@/lib/tokens/market-logos";

type Group = XStockCategory | "perps";

const GROUPS: readonly { id: Group; label: string }[] = [
  ...XSTOCK_CATEGORIES,
  { id: "perps", label: "Perps" },
];

const GROUP_TAG: Record<Group, string> = {
  stocks: "Stock",
  indices: "Index",
  metals: "Metal",
  perps: "Perp",
};

const PERP_BROWSE_LIMIT = 60;

interface Row {
  id: string;
  selection: TerminalSelection;
  mode: TicketMode;
  // What the row prints, and what search matches.
  symbol: string;
  name: string;
  // For the monogram fallback: the market's own symbol, not "X-PERP".
  markSymbol: string;
  logo?: string;
  group: Group;
  price: number | null;
  change: number | null;
  leverage?: number;
  // Assets: market cap, from Jupiter's stock data (none for bullion). Perps:
  // Lighter's 24h volume in USD and open interest, base units times the mark.
  marketCapUsd: number | null;
  volumeUsd: number | null;
  openInterestUsd: number | null;
}

export function TerminalAssetPicker({
  value,
  mode,
  prices,
  perpMarkets,
  onSelect,
  onOpenChange,
  variant,
}: {
  value: TerminalSelection;
  mode: TicketMode;
  prices: JupiterPriceMap | null;
  perpMarkets: readonly LighterMarket[];
  onSelect: (selection: TerminalSelection, mode: TicketMode) => void;
  // Lets the card around this lift itself above its siblings while the panel
  // is open; every card is its own stacking context.
  onOpenChange?: (open: boolean) => void;
  // "detail" leads with the name at the chart's size; "ticket" leads with the
  // symbol at the ticket's. Same panel either way.
  variant: "detail" | "ticket";
}) {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group | "all">("all");
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

  const allRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    for (const x of XSTOCKS) {
      const entry = prices?.[x.mint];
      rows.push({
        id: `asset:${x.mint}`,
        selection: { kind: "asset", xstock: x },
        mode: "spot",
        symbol: x.symbol,
        name: x.name,
        markSymbol: x.symbol,
        logo: x.logo,
        group: x.category,
        price: entry?.usdPrice ?? null,
        change: entry?.priceChange24h ?? null,
        marketCapUsd: entry?.stockData?.mcap ?? null,
        volumeUsd: null,
        openInterestUsd: null,
      });
    }
    const byVolume = [...perpMarkets].sort(
      (a, b) => b.dailyQuoteVolume - a.dailyQuoteVolume,
    );
    for (const m of byVolume) {
      const x = xstockForPerp(m.symbol);
      const mark = Number(m.markPrice);
      rows.push({
        id: `perp:${m.symbol}`,
        selection: x ? { kind: "asset", xstock: x } : { kind: "perp", symbol: m.symbol },
        mode: "perps",
        symbol: `${m.symbol}-PERP`,
        name: `${perpName(m.symbol)} perp`,
        markSymbol: m.symbol,
        logo: marketLogo(m.symbol) ?? x?.logo,
        group: "perps",
        price: Number.isFinite(mark) && mark > 0 ? mark : null,
        change: m.dailyPriceChange,
        leverage: m.maxLeverage,
        marketCapUsd: null,
        volumeUsd: m.dailyQuoteVolume,
        openInterestUsd: Number.isFinite(mark) && mark > 0 ? m.openInterest * mark : null,
      });
    }
    return rows;
  }, [prices, perpMarkets]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let perpsSeen = 0;
    return allRows.filter((row) => {
      if (group !== "all" && row.group !== group) return false;
      if (q) {
        return row.symbol.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
      }
      if (row.group === "perps") {
        perpsSeen += 1;
        return perpsSeen <= PERP_BROWSE_LIMIT;
      }
      return true;
    });
  }, [allRows, group, query]);

  // Clamped during render rather than reset in an effect, as ChartAssetPicker
  // does and for the same reason: filtering can shrink the list under the
  // highlight, and correcting that in an effect costs a render.
  const active = Math.max(0, Math.min(cursor, rows.length - 1));

  // The row that is current: the asset itself, the asset's perp when the
  // ticket is in perps mode, or the bare market.
  const currentId =
    value.kind === "perp"
      ? `perp:${value.symbol}`
      : mode === "perps"
        ? `perp:${underlyingTicker(value.xstock)}`
        : selectionId(value);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setGroup("all");
    setCursor(0);
  }, [setOpen]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  function choose(row: Row) {
    onSelect(row.selection, row.mode);
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
      listRef.current?.querySelectorAll("[data-row]")[clamped]?.scrollIntoView({ block: "nearest" });
      setCursor(clamped);
    }
    if (e.key === "Enter" && rows[active]) {
      e.preventDefault();
      choose(rows[active]);
    }
  }

  // What the trigger prints. A perp, whether bare or an asset's, is named as
  // the perp with its venue, since that is the instrument on screen.
  const perpSymbol =
    value.kind === "perp"
      ? value.symbol
      : mode === "perps"
        ? underlyingTicker(value.xstock)
        : null;
  const title =
    value.kind === "perp"
      ? `${perpName(value.symbol)} perp`
      : mode === "perps"
        ? `${value.xstock.name} perp`
        : value.xstock.name;
  const subtitle = perpSymbol ? `${perpSymbol}-PERP · Lighter` : value.kind === "asset" ? value.xstock.symbol : "";
  const headSymbol = perpSymbol ? `${perpSymbol}-PERP` : value.kind === "asset" ? value.xstock.symbol : "";
  const triggerLogo =
    value.kind === "perp"
      ? (marketLogo(value.symbol) ?? undefined)
      : mode === "perps"
        ? (marketLogo(underlyingTicker(value.xstock)) ?? value.xstock.logo)
        : value.xstock.logo;
  const triggerMark = perpSymbol ?? (value.kind === "asset" ? value.xstock.symbol : "");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="-ml-2 flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        {perpSymbol ? (
          <MarketLogo market={perpSymbol} size={variant === "detail" ? 36 : 32} />
        ) : (
          <AssetLogo
            xstock={{ symbol: triggerMark, name: title, logo: triggerLogo }}
            size={variant === "detail" ? 36 : 32}
          />
        )}
        {variant === "detail" ? (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-lg font-medium tracking-tight text-white">{title}</span>
            <span className="truncate text-sm text-white/50">{subtitle}</span>
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight text-white">{headSymbol}</span>
            <span className="truncate text-sm text-white/50">{title}</span>
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 z-50 mt-2 w-[min(92vw,600px)] overflow-hidden rounded-2xl border border-white/10 bg-aeras-hero-from shadow-2xl"
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
                placeholder={`Search ${allRows.length} assets and markets`}
                className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-white/35"
              />
            </div>
          </div>

          <div className="flex gap-4 overflow-x-auto border-b border-white/10 px-4">
            {[{ id: "all" as const, label: "All" }, ...GROUPS].map((g) => (
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
            ))}
          </div>

          <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto">
            {rows.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-white/40">
                Nothing matches &ldquo;{query}&rdquo;.
              </p>
            )}
            {rows.map((row, i) => {
              const isCurrent = row.id === currentId;
              return (
                <button
                  key={row.id}
                  data-row
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(row)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  {row.group === "perps" ? (
                    <MarketLogo market={row.markSymbol} size={28} />
                  ) : (
                    <AssetLogo
                      xstock={{ symbol: row.markSymbol, name: row.name, logo: row.logo }}
                      size={28}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`truncate text-sm font-medium ${
                          isCurrent ? "text-aeras-blue" : "text-white"
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
                  <div className="w-24 shrink-0 text-right">
                    <div className="font-mono text-sm tabular-nums text-white">
                      {formatQuotePrice(row.price)}
                    </div>
                    <div className={`font-mono text-[11px] tabular-nums ${changeColor(row.change)}`}>
                      {formatChange(row.change)}
                    </div>
                  </div>
                  {/* Two figures beyond price: a perp's day volume and open
                      interest, an asset's market cap. Each carries its own
                      label because the columns mean different things on the
                      two kinds of row. */}
                  {row.group === "perps" ? (
                    <>
                      <Figure label="Vol 24h" value={compactUsd(row.volumeUsd)} />
                      <Figure label="OI" value={compactUsd(row.openInterestUsd)} />
                    </>
                  ) : (
                    <>
                      <Figure label="Mkt cap" value={compactUsd(row.marketCapUsd)} />
                      <span className="hidden w-16 shrink-0 sm:block" />
                    </>
                  )}
                  <span className="w-10 shrink-0 text-right text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
                    {GROUP_TAG[row.group]}
                  </span>
                </button>
              );
            })}
            {!query.trim() && (group === "all" || group === "perps") && perpMarkets.length > PERP_BROWSE_LIMIT && (
              <p className="px-4 py-3 text-[11px] text-white/35">
                The busiest {PERP_BROWSE_LIMIT} of {perpMarkets.length} markets. Type to search the rest.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="hidden w-16 shrink-0 text-right sm:block">
      <span className="block text-[9px] font-medium uppercase tracking-[0.12em] text-white/35">
        {label}
      </span>
      <span className="block font-mono text-[11px] tabular-nums text-white/70">{value}</span>
    </span>
  );
}
