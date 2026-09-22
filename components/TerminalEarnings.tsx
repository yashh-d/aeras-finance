"use client";

// Earnings for the catalog's companies. A company that reported in the last
// few weeks shows its print against consensus, as a beat or a miss; the rest
// show the next date and, where the vendor has one, the consensus going in.
// A row selects its asset, since the natural next question is the chart.
//
// Dates are projections more often than not (see lib/calendar/earnings.ts),
// and a projected date carries a tilde so it is not read as a booking.

import { useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import {
  earningsViews,
  type EarningsResponse,
  type EarningsView,
} from "@/lib/calendar/earnings";
import { xstockByMint, type XStock } from "@/lib/jupiter/xstocks";
import { relativeTime } from "@/lib/news/format";
import { useNow } from "@/lib/ui/use-now";

const INITIAL_ROWS = 8;

export function TerminalEarnings({
  data,
  loading,
  error,
  onSelect,
  onOpenCalendar,
}: {
  data: EarningsResponse | null;
  loading: boolean;
  error: string | null;
  onSelect: (xstock: XStock) => void;
  // Opens the month calendar with every company on it.
  onOpenCalendar: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const now = useNow();
  const views = data && now != null ? earningsViews(data.rows, now) : [];
  const shown = expanded ? views : views.slice(0, INITIAL_ROWS);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Earnings
        </div>
        <button
          type="button"
          onClick={onOpenCalendar}
          className="text-[11px] font-medium text-white/50 transition-colors hover:text-white"
        >
          Full calendar
        </button>
      </div>

      {loading ? (
        <p className="py-4 text-center text-sm text-white/40">Loading earnings</p>
      ) : error && views.length === 0 ? (
        <p className="py-4 text-center text-sm text-aeras-warning">
          Earnings are unavailable right now.
        </p>
      ) : (
        <div className="divide-y divide-white/[0.07]">
          {shown.map((view) => (
            <EarningsRowView key={view.row.mint} view={view} onSelect={onSelect} />
          ))}
        </div>
      )}

      {views.length > INITIAL_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full pt-1 text-center text-[11px] font-medium text-white/50 transition-colors hover:text-white"
        >
          {expanded ? "Show fewer" : `Show all ${views.length}`}
        </button>
      )}

      {data && (
        <p className="text-[10px] text-white/30">
          Nasdaq, updated {relativeTime(data.fetchedAt)}
          {data.missing.length > 0 ? `. No data for ${data.missing.join(", ")}.` : ""}
        </p>
      )}
    </div>
  );
}

function EarningsRowView({
  view,
  onSelect,
}: {
  view: EarningsView;
  onSelect: (xstock: XStock) => void;
}) {
  const { row } = view;
  const xstock = xstockByMint(row.mint);
  return (
    <button
      type="button"
      onClick={() => xstock && onSelect(xstock)}
      className="-mx-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
    >
      <AssetLogo
        xstock={{ symbol: row.symbol, name: row.name, logo: xstock?.logo }}
        size={24}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium tracking-tight text-white">
          {row.symbol}
        </div>
        <div className="truncate text-[11px] text-white/45">
          {view.kind === "reported"
            ? `Reported ${formatEps(view.report.eps)} EPS`
            : row.nextConsensus != null
              ? `Est. ${formatEps(row.nextConsensus)} EPS`
              : view.kind === "upcoming"
                ? "Next report"
                : "Next date not set"}
        </div>
      </div>
      {view.kind === "reported" ? (
        <VerdictPill
          verdict={view.report.verdict}
          surprisePct={view.report.surprisePct}
        />
      ) : view.kind === "upcoming" ? (
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums text-white/70"
          title={row.nextEstimated ? "Projected from past reporting dates" : undefined}
        >
          {row.nextEstimated ? "~" : ""}
          {formatDay(view.at)}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-white/30">—</span>
      )}
    </button>
  );
}

function VerdictPill({
  verdict,
  surprisePct,
}: {
  verdict: "beat" | "miss" | "met" | null;
  surprisePct: number | null;
}) {
  if (!verdict) return null;
  const pct = surprisePct == null ? "" : ` ${Math.abs(surprisePct).toFixed(1)}%`;
  const label =
    verdict === "beat" ? `Beat +${pct.trim()}` : verdict === "miss" ? `Miss${pct}` : "Met";
  const tone =
    verdict === "beat"
      ? "bg-aeras-positive/15 text-aeras-positive"
      : verdict === "miss"
        ? "bg-aeras-negative/15 text-aeras-negative"
        : "bg-white/10 text-white/70";
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${tone}`}
    >
      {label}
    </span>
  );
}

function formatEps(eps: number): string {
  return `${eps < 0 ? "-" : ""}$${Math.abs(eps).toFixed(2)}`;
}

// Stored as midnight UTC, so read back in UTC or the day can shift west.
function formatDay(at: number): string {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
