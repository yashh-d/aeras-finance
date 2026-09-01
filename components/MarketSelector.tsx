"use client";

// Market browser for the perps tab. A trigger showing the selected market, and
// a panel with search, category tabs and a sortable-by-volume table.
//
// The catalog is 52 markets across five asset classes, which is too many for a
// plain <select> and too few to need virtualisation. Everything is filtered in
// memory off one fetch.

import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MarketLogo } from "@/components/MarketLogo";
import {
  MARKET_CATEGORIES,
  marketTicker,
  type MarketCategoryId,
} from "@/lib/tokens/market-logos";
import type { OndoMarket } from "@/lib/ondo/types";

function fmtPrice(v: string | null | undefined): string {
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n === 0) return "—";
  // Sub-dollar markets need more places or ONDO reads as $0.00.
  const places = n < 1 ? 4 : 2;
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
}

function fmtCompactUsd(v: string | null | undefined): string {
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n === 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(v: string | null | undefined): { text: string; up: boolean } {
  const n = Number(v);
  if (!v || !Number.isFinite(n)) return { text: "—", up: true };
  return { text: `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`, up: n >= 0 };
}

function fmtFunding(v: string | null | undefined): string {
  const n = Number(v);
  if (!v || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(5)}%`;
}

export function MarketSelector({
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketCategoryId>("all");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const tag = MARKET_CATEGORIES.find((c) => c.id === category)?.tag ?? null;
    const q = query.trim().toLowerCase();
    return markets
      .filter((m) => (tag ? m.tags.includes(tag) : true))
      .filter((m) =>
        q
          ? marketTicker(m.market).toLowerCase().includes(q) ||
            m.longName.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => Number(b.usdVolume ?? 0) - Number(a.usdVolume ?? 0));
  }, [markets, category, query]);

  // Clamped during render rather than reset in an effect: filtering can shrink
  // the list under the highlight, and correcting that in an effect costs an
  // extra render pass and trips the cascading-render lint rule.
  const active = Math.max(0, Math.min(cursor, rows.length - 1));

  // Closing resets the filters, so reopening always starts from the full
  // catalog. Done here rather than in an effect on `open`: an effect would fire
  // after the close has already painted, which both flashes the stale filter and
  // trips the cascading-render rule.
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCategory("all");
    setCursor(0);
  }, []);

  // Focusing the input is a DOM side effect, which is what an effect is for.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Cmd-K opens. Undocumented in the panel now that the shortcut footer is
  // gone, but kept: it costs nothing and the arrow, Enter and Escape handling
  // below is what makes the list navigable once it is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function onPanelKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(() => {
        const next = e.key === "ArrowDown" ? active + 1 : active - 1;
        const clamped = Math.max(0, Math.min(rows.length - 1, next));
        listRef.current
          ?.querySelectorAll("[data-row]")
          [clamped]?.scrollIntoView({ block: "nearest" });
        return clamped;
      });
    }
    if (e.key === "Enter" && rows[active]) {
      onSelect(rows[active]);
      close();
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        {selected ? (
          <>
            <MarketLogo market={selected.market} size={34} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-base font-semibold tracking-tight text-white">
                  {marketTicker(selected.market)}
                </span>
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70">
                  {Math.round(Number(selected.maxLeverage))}x
                </span>
              </div>
              <div className="truncate text-[11px] text-white/50">
                {selected.longName}
              </div>
            </div>
          </>
        ) : (
          <span className="text-sm text-white/50">
            {loading ? "Loading markets" : "Select a market"}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={close}
            aria-hidden="true"
          />
          <div
            className="absolute left-0 z-50 mt-2 w-[min(92vw,900px)] overflow-hidden rounded-2xl border border-white/10 bg-aeras-hero-from shadow-2xl"
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
                  placeholder={`Search ${markets.length} markets`}
                  className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-white/35"
                />
              </div>
            </div>

            <div className="flex gap-4 border-b border-white/10 px-4">
              {MARKET_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategory(c.id);
                    setCursor(0);
                  }}
                  className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${
                    category === c.id
                      ? "border-white text-white"
                      : "border-transparent text-white/50 hover:text-white/80"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
              <div className="col-span-4">Market</div>
              <div className="col-span-2 text-right">Price</div>
              <div className="col-span-2 text-right">24h</div>
              <div className="col-span-2 text-right">Volume</div>
              <div className="col-span-2 text-right">Funding</div>
            </div>

            <div
              ref={listRef}
              className="max-h-[52vh] overflow-y-auto border-t border-white/10"
            >
              {rows.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-white/40">
                  No market matches &ldquo;{query}&rdquo;.
                </p>
              )}
              {rows.map((m, i) => {
                const change = fmtPct(m.priceChangePercent);
                return (
                  <button
                    key={m.market}
                    data-row
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => {
                      onSelect(m);
                      close();
                    }}
                    className={`grid w-full grid-cols-12 items-center gap-2 px-4 py-2.5 text-left transition-colors ${
                      i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                    } ${m.tradeable ? "" : "opacity-45"}`}
                  >
                    <div className="col-span-4 flex items-center gap-2.5">
                      <MarketLogo market={m.market} size={28} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-white">
                            {marketTicker(m.market)}
                          </span>
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                            {Math.round(Number(m.maxLeverage))}x
                          </span>
                          {!m.tradeable && (
                            <span className="text-[10px] text-aeras-warning">
                              Disabled
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-white/45">
                          {m.longName}
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2 text-right font-mono text-sm text-white">
                      {fmtPrice(m.price)}
                    </div>
                    <div
                      className={`col-span-2 text-right font-mono text-xs ${
                        change.up ? "text-aeras-positive" : "text-aeras-negative"
                      }`}
                    >
                      {change.text}
                    </div>
                    <div className="col-span-2 text-right font-mono text-xs text-white/60">
                      {fmtCompactUsd(m.usdVolume)}
                    </div>
                    <div className="col-span-2 text-right font-mono text-xs text-white/60">
                      {fmtFunding(m.fundingRate)}
                    </div>
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
