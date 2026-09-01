"use client";

// Market browser for the Lighter side of the perps tab.
//
// A separate component from MarketSelector rather than a generic one over both
// venues. That component reads `tags`, `longName` and `priceChangePercent`, and
// Lighter's catalog carries none of the three: orderBookDetails returns a bare
// symbol, so there are no categories to tab between and no company name to
// search. Making one component serve both would mean threading four accessors
// through it to render fewer columns.
//
// What it does share is MarketLogo. Lighter names its markets by bare ticker
// ("SPY", "BTC"), which is exactly what the logo table is keyed by, and the
// couple of hundred markets with no mark fall through to the monogram badge
// that component already draws.
//
// Every figure shown is one the venue states directly. Open interest is left
// out on purpose: the field's units are not documented and it is not worth
// printing a number next to a dollar sign on a guess.

import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MarketLogo } from "@/components/MarketLogo";
import type { LighterMarket } from "@/lib/lighter/types";

function fmtPrice(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  // Sub-dollar markets need more places or a token reads as $0.00.
  const places = n < 1 ? 5 : 2;
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
}

function fmtCompactUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

export function LighterMarketSelector({
  markets,
  selected,
  onSelect,
  loading,
}: {
  markets: LighterMarket[];
  selected: LighterMarket | null;
  onSelect: (market: LighterMarket) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return markets
      .filter((m) => (q ? m.symbol.toLowerCase().includes(q) : true))
      .sort((a, b) => b.dailyQuoteVolume - a.dailyQuoteVolume);
  }, [markets, query]);

  // Clamped during render rather than reset in an effect: filtering can shrink
  // the list under the highlight, and correcting that in an effect costs an
  // extra render pass.
  const active = Math.max(0, Math.min(cursor, rows.length - 1));

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
            <MarketLogo market={selected.symbol} size={34} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-base font-semibold tracking-tight text-white">
                  {selected.symbol}
                </span>
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70">
                  {selected.maxLeverage}x
                </span>
              </div>
              <div className="truncate text-[11px] text-white/50">
                Perpetual · Lighter
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
            className="absolute left-0 z-50 mt-2 w-[min(92vw,720px)] overflow-hidden rounded-2xl border border-white/10 bg-aeras-hero-from shadow-2xl"
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

            <div className="grid grid-cols-12 gap-2 border-t border-white/10 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
              <div className="col-span-6">Market</div>
              <div className="col-span-3 text-right">Price</div>
              <div className="col-span-3 text-right">24h Volume</div>
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
              {rows.map((m, i) => (
                <button
                  key={m.marketId}
                  data-row
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => {
                    onSelect(m);
                    close();
                  }}
                  className={`grid w-full grid-cols-12 items-center gap-2 px-4 py-2.5 text-left transition-colors ${
                    i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="col-span-6 flex items-center gap-2.5">
                    <MarketLogo market={m.symbol} size={28} />
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-white">
                        {m.symbol}
                      </span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                        {m.maxLeverage}x
                      </span>
                    </div>
                  </div>
                  <div className="col-span-3 text-right font-mono text-sm text-white">
                    {fmtPrice(m.markPrice)}
                  </div>
                  <div className="col-span-3 text-right font-mono text-xs text-white/60">
                    {fmtCompactUsd(m.dailyQuoteVolume)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
