"use client";

// The Bitwise Mag7X portfolio, read: what it holds and at what weight, what
// each holding has returned over ten years, what the basket has, what Glider
// pays on top, and what it costs. Everything a user should know before the
// ticket beside this takes their USDC.
//
// Prices come from the Jupiter price map through each holding's matching
// xStock, so the table shares the feed every other surface uses rather than
// carrying a second one for Base. The 24h change is the xStock's too. Both
// are the same share at a different issuer, and Glider values a position at
// its own feed; the ticket shows Glider's figure for a held position.

import { AssetLogo } from "@/components/AssetLogo";
import { GLIDER_STRATEGY_URL, type Mag7xHolding } from "@/lib/glider/constants";
import type { GliderStrategyView, HistoryRow, HistoryView, PerformanceWindow } from "@/lib/glider/types";
import { formatUsdPrice } from "@/lib/format";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { xstockBySymbol } from "@/lib/jupiter/xstocks";
import { INSET_PANEL } from "@/lib/ui/surface";

function pct(decimal: number | null | undefined, digits = 1): string {
  if (decimal == null || !Number.isFinite(decimal)) return "—";
  return `${(decimal * 100).toFixed(digits)}%`;
}

function signedPct(percent: number | null | undefined, digits = 2): string {
  if (percent == null || !Number.isFinite(percent)) return "—";
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(digits)}%`;
}

function usdCompact(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function monthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

function windowValue(windows: PerformanceWindow[] | undefined, id: PerformanceWindow["window"]): number | null {
  return windows?.find((w) => w.window === id)?.percentChange ?? null;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" | "plain" }) {
  const color = tone === "positive" ? "text-aeras-positive" : tone === "negative" ? "text-aeras-negative" : "text-white";
  return (
    <div className={`${INSET_PANEL} px-3 py-2.5`}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">{label}</div>
      <div className={`mt-1 font-mono text-sm tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}

function returnCell(row: HistoryRow | undefined): { text: string; sub: string; tone: "positive" | "negative" | "plain" } {
  if (!row) return { text: "—", sub: "", tone: "plain" };
  if (row.kind === "cagr") {
    return {
      text: `${pct(row.value)} a year`,
      sub: `${row.years.toFixed(1)}y to ${monthYear(row.to)}`,
      tone: row.value >= 0 ? "positive" : "negative",
    };
  }
  return {
    text: `${row.value >= 0 ? "+" : ""}${pct(row.value)}`,
    sub: `since listing ${monthYear(row.from)}`,
    tone: row.value >= 0 ? "positive" : "negative",
  };
}

export function GliderMag7xDetail({
  strategy,
  history,
  historyError,
  prices,
}: {
  strategy: GliderStrategyView;
  history: HistoryView | null;
  historyError: string | null;
  prices: JupiterPriceMap | null;
}) {
  const boost = strategy.boost;
  const liveAll = windowValue(strategy.live?.windows, "all");
  const liveSince = strategy.live?.points[0]?.date ?? null;
  const backtest12 = windowValue(strategy.backtestExcludingSpacex?.windows, "12m");
  const rowsByTicker = new Map((history?.rows ?? []).map((r) => [r.ticker, r]));
  const basket = history?.basket ?? null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Boosted APR"
          value={boost ? pct(boost.apr) : "—"}
          sub={boost ? `campaign ${boost.campaignId}` : "no campaign live"}
          tone={boost ? "positive" : "plain"}
        />
        <Stat
          label="Since listing"
          value={signedPct(liveAll)}
          sub={liveSince ? `from ${monthYear(liveSince)}, all 8 holdings` : undefined}
          tone={liveAll == null ? "plain" : liveAll >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="12m model"
          value={signedPct(backtest12)}
          sub="backtest, excludes SpaceX"
          tone={backtest12 == null ? "plain" : backtest12 >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="On Glider"
          value={usdCompact(strategy.tvlUsd)}
          sub={strategy.users != null ? `${strategy.users.toLocaleString()} investors` : undefined}
        />
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-xs font-medium text-white">Exposure</div>
          <div className="text-[10px] text-white/40">equal weight, rebalanced daily</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
                <th className="pb-2 text-left font-medium">Holding</th>
                <th className="pb-2 text-right font-medium">Weight</th>
                <th className="pb-2 text-right font-medium">Price</th>
                <th className="pb-2 text-right font-medium">10y CAGR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {strategy.holdings.map((h) => (
                <HoldingRow key={h.contract} holding={h} prices={prices} history={rowsByTicker.get(h.ticker)} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11px] text-white/50">
          <span>
            Basket{" "}
            {basket ? (
              <>
                <span className="font-mono text-white">{pct(basket.cagr)} a year</span> over{" "}
                {basket.years.toFixed(0)}y
                {basket.excluded.length > 0 && <>, ex-{basket.excluded.join(", ")}</>}
              </>
            ) : historyError ? (
              "history unavailable"
            ) : (
              "reading…"
            )}
          </span>
          <span>{pct(strategy.fee, 2)} fee · rebalanced daily · Coinbase-issued</span>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-white/40">
        Non-US persons only. No shareholder rights. The boost is a Glider campaign and can end.
        Not usable as collateral here.{" "}
        <a href={GLIDER_STRATEGY_URL} target="_blank" rel="noreferrer" className="text-white/60 underline decoration-white/20 hover:text-white">
          Strategy on Glider
        </a>
      </p>
    </div>
  );
}

function HoldingRow({
  holding,
  prices,
  history,
}: {
  holding: Mag7xHolding;
  prices: JupiterPriceMap | null;
  history: HistoryRow | undefined;
}) {
  const xstock = xstockBySymbol(holding.xstockSymbol);
  const entry = xstock ? prices?.[xstock.mint] : undefined;
  const price = entry?.usdPrice;
  const change = entry?.priceChange24h;
  const ret = returnCell(history);
  const retColor = ret.tone === "positive" ? "text-aeras-positive" : ret.tone === "negative" ? "text-aeras-negative" : "text-white/50";
  return (
    <tr>
      <td className="py-2">
        <div className="flex items-center gap-2">
          {xstock ? (
            <AssetLogo xstock={xstock} size={22} />
          ) : (
            <AssetLogo xstock={{ symbol: holding.ticker, name: holding.name, logo: undefined }} size={22} />
          )}
          <div className="min-w-0">
            <div className="truncate text-white">{holding.name}</div>
            <div className="text-[10px] text-white/40">{holding.symbol}</div>
          </div>
        </div>
      </td>
      <td className="py-2 text-right font-mono tabular-nums text-white">{pct(holding.weight)}</td>
      <td className="py-2 text-right font-mono tabular-nums">
        <div className="text-white">{price == null ? "—" : `$${formatUsdPrice(price)}`}</div>
        <div className={`text-[10px] ${change == null ? "text-white/40" : change >= 0 ? "text-aeras-positive" : "text-aeras-negative"}`}>
          {change == null ? "" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
        </div>
      </td>
      <td className="py-2 text-right font-mono tabular-nums">
        <div className={retColor}>{ret.text}</div>
        <div className="text-[10px] text-white/40">{ret.sub}</div>
      </td>
    </tr>
  );
}
