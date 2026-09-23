"use client";

// The dropdown a play's detail view opens with, for a play that lets the
// user change what it does: the collateral, what a ladder buys next, or
// where an earn play's loan goes. A trigger with the mark, symbol and
// chevron where the static symbol pill sat, and a panel with search, group
// tabs and rows drawn the way the Home chart's picker
// (components/ChartAssetPicker.tsx) draws them: a mark, a name, a symbol
// and which shelf it sits on. The rows choose what the ticket opens on, not
// what it signs; the ticket still prices and signs everything.

import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import {
  XSTOCK_CATEGORIES,
  type XStock,
  type XStockCategory,
} from "@/lib/jupiter/xstocks";

const GROUP_TAG: Record<XStockCategory, string> = {
  stocks: "Equity",
  indices: "Index",
  metals: "Metal",
};

// One row: what AssetLogo draws, the name under it, the shelf tag at the
// right edge, and the catalog group when the set spans more than one.
export interface PickerRow {
  key: string;
  symbol: string;
  name: string;
  logo?: string;
  tag: string;
  group?: XStockCategory;
}

export function assetRow(x: XStock): PickerRow {
  return { key: x.mint, symbol: x.symbol, name: x.name, logo: x.logo, tag: GROUP_TAG[x.category], group: x.category };
}

export function PlayAssetPicker({
  label,
  choices,
  value,
  onChange,
}: {
  // What the choice is, for the trigger's eyebrow and the panel's placeholder.
  label: string;
  choices: readonly PickerRow[];
  value: PickerRow;
  onChange: (next: PickerRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<XStockCategory | "all">("all");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Only the shelves the choice set spans get a tab; one shelf gets none.
  const groups = useMemo(
    () => XSTOCK_CATEGORIES.filter((c) => choices.some((x) => x.group === c.id)),
    [choices],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return choices.filter((x) => {
      if (group !== "all" && x.group !== group) return false;
      if (!q) return true;
      return x.symbol.toLowerCase().includes(q) || x.name.toLowerCase().includes(q);
    });
  }, [choices, group, query]);

  // Clamped during render rather than reset in an effect: filtering can
  // shrink the list under the highlight.
  const active = Math.max(0, Math.min(cursor, rows.length - 1));

  // Closing resets the filters, so reopening starts from the full list.
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setGroup("all");
    setCursor(0);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Close on a press anywhere outside. A document listener rather than a
  // backdrop, for the same reason ChartAssetPicker gives: the glass card
  // this sits in is the containing block for fixed descendants.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  function choose(x: PickerRow) {
    onChange(x);
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value.name}`}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] py-1 pl-1.5 pr-2 text-left transition-colors hover:border-white/20 hover:bg-white/[0.08]"
      >
        <AssetLogo xstock={value} size={20} />
        <span className="min-w-0">
          <span className="block text-[9px] font-medium uppercase leading-none tracking-[0.12em] text-white/40">
            {label}
          </span>
          <span className="block truncate text-xs font-medium leading-tight text-white">
            {value.symbol}
          </span>
        </span>
        <ChevronDown
          className={`size-3 shrink-0 text-white/40 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 z-50 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-white/10 bg-aeras-hero-from shadow-2xl"
          onKeyDown={onPanelKey}
        >
          <div className="p-3">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
              <Search className="size-4 shrink-0 text-white/40" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                placeholder={`Search ${choices.length} choices`}
                className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-white/35"
              />
            </div>
          </div>

          {groups.length > 1 && (
            <div className="flex gap-4 overflow-x-auto border-b border-white/10 px-4">
              {[{ id: "all" as const, label: "All" }, ...groups].map((g) => (
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
          )}

          <div ref={listRef} role="listbox" className="max-h-72 overflow-y-auto">
            {rows.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-white/40">
                Nothing matches &ldquo;{query}&rdquo;.
              </p>
            )}
            {rows.map((x, i) => {
              const current = x.key === value.key;
              return (
                <button
                  key={x.key}
                  data-row
                  type="button"
                  role="option"
                  aria-selected={current}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(x)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <AssetLogo xstock={x} size={28} />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-sm font-medium ${current ? "text-aeras-blue" : "text-white"}`}
                    >
                      {x.name}
                    </div>
                    <div className="truncate text-[11px] text-white/45">{x.symbol}</div>
                  </div>
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
                    {x.tag}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
