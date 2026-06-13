"use client";

import { useEffect, useState } from "react";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { fetchSparklines, type SparklinesResponse } from "@/lib/jupiter/charts";
import { XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";

const SPARKLINE_REFRESH_MS = 60_000;

export function AssetGrid({
  prices,
  pricesError,
  selectedMint,
  onSelect,
}: {
  prices: JupiterPriceMap | null;
  pricesError: string | null;
  selectedMint: string;
  onSelect: (xstock: XStock) => void;
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

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Assets
        </div>
        {error ? (
          <span className="inline-flex items-center gap-1 text-xs text-aeras-warning">
            <span className="inline-block size-1.5 rounded-full bg-aeras-warning" />
            Price feed offline
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-aeras-300">
            <span className="inline-block size-1.5 rounded-full bg-aeras-positive" />
            Live · 10s
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {XSTOCKS.map((x) => (
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
    </div>
  );
}

function AssetTile({
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
      ? "text-aeras-100"
      : positive
        ? "text-aeras-positive"
        : "text-aeras-negative";
  const sparkStroke =
    positive == null
      ? "stroke-aeras-100"
      : positive
        ? "stroke-aeras-positive"
        : "stroke-aeras-negative";
  const changeSign = positive ? "+" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group text-left rounded-xl border px-3.5 py-3 transition-colors ${
        selected
          ? "border-[1.5px] border-aeras-blue bg-aeras-blue-wash"
          : "border-aeras-border bg-white hover:border-aeras-border-strong"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium tracking-tight text-aeras-900">
          {xstock.symbol}
        </span>
        <span className={`font-mono text-xs tabular-nums ${changeColor}`}>
          {change == null ? "—" : `${changeSign}${change.toFixed(2)}%`}
        </span>
      </div>
      <div className="truncate text-xs text-aeras-300">{xstock.name}</div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="font-mono text-sm tabular-nums text-aeras-900">
          {price == null ? "—" : `$${formatPrice(price)}`}
        </div>
        <Sparkline values={sparkline} strokeClassName={sparkStroke} />
      </div>
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
