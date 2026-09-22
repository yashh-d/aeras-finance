"use client";

// The full calendar: a month of earnings and macro on one grid, opened from
// the Earnings and Macro cards. An overlay rather than a section, so the
// Terminal underneath keeps its state, and portalled to the body because
// every card is its own stacking context.
//
// What is on it, and where it comes from. Every catalog company's last report
// (with its beat or miss) and next date (with its estimate; projected dates
// carry a tilde) from the earnings rail. This week's releases from the macro
// feed, which is the only week that feed serves, so other weeks show no
// releases and the footer says so. And every FOMC meeting of the year from
// the registry, marked on both days with the decision on the second.
//
// A day cell shows a few entries and a count; clicking the day lists all of
// them below the grid. An earnings entry selects its asset on the Terminal
// and closes the overlay, since the next thing to look at is the chart.

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { AssetLogo } from "@/components/AssetLogo";
import type { EarningsResponse } from "@/lib/calendar/earnings";
import { FOMC_MEETINGS_2026, type MacroResponse } from "@/lib/calendar/macro";
import {
  calendarEvents,
  localDateKey,
  monthGrid,
  type CalendarEvent,
} from "@/lib/calendar/month";
import { xstockByMint, type XStock } from "@/lib/jupiter/xstocks";
import { useNow } from "@/lib/ui/use-now";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CELL_PREVIEW = 3;

type Filter = "all" | "earnings" | "macro";

export function TerminalCalendar({
  open,
  onClose,
  earnings,
  macro,
  onSelect,
  initialDay,
}: {
  open: boolean;
  onClose: () => void;
  earnings: EarningsResponse | null;
  macro: MacroResponse | null;
  onSelect: (xstock: XStock) => void;
  // The day to open on, as a date key. Read once when the component mounts,
  // so the caller keys this component per opening to land on a new day.
  initialDay?: string | null;
}) {
  // From the shared clock rather than Date.now() in render: it ticks, and it
  // is null on the server so nothing here renders before hydration.
  const now = useNow();
  const today = now == null ? null : localDateKey(now);
  const [cursor, setCursor] = useState(() => {
    const d = initialDay ? parseKey(initialDay) : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(initialDay ?? null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const byDay = useMemo(
    () =>
      calendarEvents({
        earnings: earnings?.rows ?? [],
        macro: macro?.events ?? [],
        fomc: FOMC_MEETINGS_2026,
      }),
    [earnings, macro],
  );

  if (!open || typeof document === "undefined") return null;

  const grid = monthGrid(cursor.year, cursor.month);
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const keep = (e: CalendarEvent) =>
    filter === "all" || (filter === "earnings" ? e.kind === "earnings" : e.kind !== "earnings");
  const dayEvents = (key: string) => (byDay.get(key) ?? []).filter(keep);

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    setSelectedDay(null);
  }

  function pickAsset(mint: string) {
    const x = xstockByMint(mint);
    if (!x) return;
    onSelect(x);
    onClose();
  }

  const agenda = selectedDay ? dayEvents(selectedDay) : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Full calendar"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-white/10 bg-aeras-hero-from p-5 text-white shadow-2xl lg:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="Previous month"
              className="rounded-lg border border-white/10 p-1.5 text-white/60 transition-colors hover:text-white"
            >
              <ChevronLeft className="size-4" />
            </button>
            <h2 className="min-w-[11rem] text-center font-light text-xl tracking-tight text-white">
              {monthLabel}
            </h2>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="Next month"
              className="rounded-lg border border-white/10 p-1.5 text-white/60 transition-colors hover:text-white"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                setCursor({ year: d.getFullYear(), month: d.getMonth() });
                setSelectedDay(localDateKey(d.getTime()));
              }}
              className="ml-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 transition-colors hover:text-white"
            >
              Today
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
              {(
                [
                  ["all", "All"],
                  ["earnings", "Earnings"],
                  ["macro", "Macro"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  aria-pressed={filter === id}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    filter === id ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close calendar"
              className="rounded-lg border border-white/10 p-1.5 text-white/60 transition-colors hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/[0.06]">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="bg-aeras-hero-from px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-white/40"
            >
              {d}
            </div>
          ))}
          {grid.map((cell) => {
            const events = dayEvents(cell.key);
            const isToday = cell.key === today;
            const isSelected = cell.key === selectedDay;
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => setSelectedDay(isSelected ? null : cell.key)}
                aria-pressed={isSelected}
                className={`flex min-h-[6.5rem] flex-col items-stretch gap-1 bg-aeras-hero-from p-1.5 text-left transition-colors hover:bg-white/[0.04] ${
                  cell.inMonth ? "" : "opacity-40"
                } ${isSelected ? "bg-white/[0.06]" : ""}`}
              >
                <span
                  className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums ${
                    isToday ? "bg-aeras-blue font-medium text-white" : "text-white/60"
                  }`}
                >
                  {cell.day}
                </span>
                {events.slice(0, CELL_PREVIEW).map((e, i) => (
                  <CellEntry key={i} event={e} />
                ))}
                {events.length > CELL_PREVIEW && (
                  <span className="text-[10px] text-white/40">
                    +{events.length - CELL_PREVIEW} more
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {selectedDay && (
          <div className="mt-5">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
              {formatDayLabel(selectedDay)}
            </div>
            {agenda.length === 0 ? (
              <p className="py-3 text-sm text-white/40">Nothing on this day.</p>
            ) : (
              <div className="mt-1 divide-y divide-white/[0.07]">
                {agenda.map((e, i) => (
                  <AgendaRow key={i} event={e} onPick={pickAsset} />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>,
    document.body,
  );
}

function CellEntry({ event }: { event: CalendarEvent }) {
  if (event.kind === "earnings") {
    const x = xstockByMint(event.row.mint);
    return (
      <span className="flex items-center gap-1 truncate text-[11px]">
        <AssetLogo
          xstock={{ symbol: event.row.symbol, name: event.row.name, logo: x?.logo }}
          size={14}
        />
        <span className="truncate font-medium text-white">
          {event.estimated ? "~" : ""}
          {event.row.symbol}
        </span>
        {event.phase === "reported" && event.report?.verdict && (
          <span
            className={`ml-auto shrink-0 text-[10px] ${
              event.report.verdict === "beat"
                ? "text-aeras-positive"
                : event.report.verdict === "miss"
                  ? "text-aeras-negative"
                  : "text-white/60"
            }`}
          >
            {event.report.verdict === "beat" ? "Beat" : event.report.verdict === "miss" ? "Miss" : "Met"}
          </span>
        )}
      </span>
    );
  }
  if (event.kind === "fomc") {
    return (
      <span className="flex items-center gap-1 truncate text-[11px] text-white">
        <span aria-hidden="true">🇺🇸</span>
        <span className="truncate font-medium">
          {event.decisionDay ? "FOMC decision" : "FOMC day 1"}
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 truncate text-[11px] text-white/80">
      <span aria-hidden="true">{event.event.flag}</span>
      <span className="truncate">{event.event.title}</span>
    </span>
  );
}

function AgendaRow({
  event,
  onPick,
}: {
  event: CalendarEvent;
  onPick: (mint: string) => void;
}) {
  if (event.kind === "earnings") {
    const x = xstockByMint(event.row.mint);
    const line =
      event.phase === "reported" && event.report
        ? `Reported ${formatEps(event.report.eps)} EPS` +
          (event.report.consensus != null ? ` against ${formatEps(event.report.consensus)} expected` : "")
        : event.row.nextConsensus != null
          ? `Est. ${formatEps(event.row.nextConsensus)} EPS${event.estimated ? ", date projected" : ""}`
          : event.estimated
            ? "Next report, date projected"
            : "Next report";
    return (
      <button
        type="button"
        onClick={() => onPick(event.row.mint)}
        className="-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <AssetLogo
          xstock={{ symbol: event.row.symbol, name: event.row.name, logo: x?.logo }}
          size={26}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium tracking-tight text-white">
            {event.row.symbol} <span className="font-normal text-white/50">{event.row.name}</span>
          </div>
          <div className="text-[11px] text-white/45">{line}</div>
        </div>
        {event.phase === "reported" && event.report?.verdict && (
          <span
            className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
              event.report.verdict === "beat"
                ? "bg-aeras-positive/15 text-aeras-positive"
                : event.report.verdict === "miss"
                  ? "bg-aeras-negative/15 text-aeras-negative"
                  : "bg-white/10 text-white/70"
            }`}
          >
            {event.report.verdict === "beat"
              ? `Beat +${Math.abs(event.report.surprisePct ?? 0).toFixed(1)}%`
              : event.report.verdict === "miss"
                ? `Miss ${Math.abs(event.report.surprisePct ?? 0).toFixed(1)}%`
                : "Met"}
          </span>
        )}
      </button>
    );
  }
  if (event.kind === "fomc") {
    return (
      <div className="flex items-center gap-3 py-2.5">
        <span className="w-6 text-center" aria-hidden="true">🇺🇸</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium tracking-tight text-white">
            {event.decisionDay ? "FOMC decision" : "FOMC meeting, day one"}
          </div>
          <div className="text-[11px] text-white/45">
            {event.decisionDay
              ? `Statement at 2:00 PM ET${event.meeting.projections ? ", with economic projections" : ""}`
              : `Two-day meeting, ${event.meeting.start} to ${event.meeting.end}`}
          </div>
        </div>
      </div>
    );
  }
  const m = event.event;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-6 text-center" aria-hidden="true">{m.flag}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium tracking-tight text-white">{m.title}</span>
          {m.impact === "High" && (
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-aeras-warning" title="High impact" />
          )}
        </div>
        <div className="font-mono text-[11px] tabular-nums text-white/45">
          {[m.previous != null ? `Prev ${m.previous}` : null, m.forecast != null ? `Est ${m.forecast}` : null]
            .filter(Boolean)
            .join(" · ") || "No figure"}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-white/70">
        {new Date(m.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
      </span>
    </div>
  );
}

function formatEps(eps: number): string {
  return `${eps < 0 ? "-" : ""}$${Math.abs(eps).toFixed(2)}`;
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDayLabel(key: string): string {
  return parseKey(key).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
