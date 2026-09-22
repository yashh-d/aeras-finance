"use client";

// This week's economic calendar, and the next Fed decision above it. Rows
// are the releases that move markets: US medium and high impact, high impact
// elsewhere. Times are the viewer's own, which is safe here because the list
// only ever renders after the fetch lands on the client. A release whose
// time has passed is dimmed; the figure it printed is in the news rail, since
// the feed carries forecasts and not actuals.

import { useState } from "react";

import { nextFomc, type MacroEvent, type MacroResponse } from "@/lib/calendar/macro";
import { relativeTime } from "@/lib/news/format";
import { useNow } from "@/lib/ui/use-now";

const INITIAL_ROWS = 10;

export function TerminalMacro({
  data,
  loading,
  error,
  onOpenCalendar,
}: {
  data: MacroResponse | null;
  loading: boolean;
  error: string | null;
  // Opens the month calendar, releases and earnings together.
  onOpenCalendar: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const now = useNow();
  const fomc = now == null ? null : nextFomc(now);
  const events = data?.events ?? [];
  const shown = expanded ? events : events.slice(0, INITIAL_ROWS);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Macro events
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-white/30">This week</span>
          <button
            type="button"
            onClick={onOpenCalendar}
            className="text-[11px] font-medium text-white/50 transition-colors hover:text-white"
          >
            Full calendar
          </button>
        </div>
      </div>

      {fomc && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2">
          <div className="flex items-center gap-2">
            <span aria-hidden="true">🇺🇸</span>
            <div>
              <div className="text-[13px] font-medium tracking-tight text-white">
                Next FOMC decision
              </div>
              <div className="text-[11px] text-white/45">
                {fomc.projections ? "With economic projections" : "Statement only"}
              </div>
            </div>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-white/70">
            {formatMeeting(fomc.start, fomc.end)}
          </span>
        </div>
      )}

      {loading ? (
        <p className="py-4 text-center text-sm text-white/40">Loading calendar</p>
      ) : error && events.length === 0 ? (
        <p className="py-4 text-center text-sm text-aeras-warning">
          The calendar is unavailable right now.
        </p>
      ) : events.length === 0 ? (
        <p className="py-4 text-center text-sm text-white/40">Nothing scheduled this week.</p>
      ) : (
        <div className="divide-y divide-white/[0.07]">
          {shown.map((event) => (
            <MacroRow key={event.id} event={event} past={now != null && event.at < now} />
          ))}
        </div>
      )}

      {events.length > INITIAL_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full pt-1 text-center text-[11px] font-medium text-white/50 transition-colors hover:text-white"
        >
          {expanded ? "Show fewer" : `Show all ${events.length}`}
        </button>
      )}

      {data && (
        <p className="text-[10px] text-white/30">
          Updated {relativeTime(data.fetchedAt)}
          {data.stale ? ". The feed did not answer; older items shown." : ""}
        </p>
      )}
    </div>
  );
}

function MacroRow({ event, past }: { event: MacroEvent; past: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 py-2 ${past ? "opacity-50" : ""}`}>
      <span className="w-5 shrink-0 text-center" aria-hidden="true">
        {event.flag}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium tracking-tight text-white">
            {event.title}
          </span>
          {event.impact === "High" && (
            <span
              className="inline-block size-1.5 shrink-0 rounded-full bg-aeras-warning"
              title="High impact"
            />
          )}
        </div>
        <div className="truncate font-mono text-[11px] tabular-nums text-white/45">
          {[
            event.previous != null ? `Prev ${event.previous}` : null,
            event.forecast != null ? `Est ${event.forecast}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "No figure"}
        </div>
      </div>
      <span className="shrink-0 text-right font-mono text-[11px] tabular-nums text-white/70">
        {formatWhen(event.at)}
      </span>
    </div>
  );
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "Sep 15–16", with the month once. Two-day meetings never span a month.
function formatMeeting(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const month = s.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${s.getUTCDate()}–${e.getUTCDate()}`;
}
