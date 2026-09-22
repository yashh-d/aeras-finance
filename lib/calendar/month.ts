// The month grid behind the Terminal's full calendar, and the events placed
// on it. Pure date arithmetic, so the overlay only draws.
//
// Two kinds of date meet here and they are keyed differently on purpose.
// Earnings dates are days, stored as midnight UTC, so they are keyed by their
// UTC calendar day; keying them in the viewer's zone would shift every
// report a day west of New York. Macro releases are instants, so they are
// keyed by the viewer's local day, which is the day the viewer will see the
// release land. FOMC meetings are already calendar days.

import type { EarningsReport, EarningsRow } from "./earnings";
import type { FomcMeeting, MacroEvent } from "./macro";

export type CalendarEvent =
  | {
      kind: "earnings";
      key: string;
      row: EarningsRow;
      phase: "reported" | "upcoming";
      report: EarningsReport | null;
      estimated: boolean;
    }
  | { kind: "macro"; key: string; event: MacroEvent }
  | { kind: "fomc"; key: string; meeting: FomcMeeting; decisionDay: boolean };

export interface GridDay {
  key: string;
  day: number;
  inMonth: boolean;
}

export function dateKey(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function utcDateKey(ms: number): string {
  const d = new Date(ms);
  return dateKey(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function localDateKey(ms: number): string {
  const d = new Date(ms);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

// Six rows of seven, Sunday first, the way a US market calendar is printed.
// Always 42 cells so the grid does not change height month to month.
export function monthGrid(year: number, month0: number): GridDay[] {
  const first = new Date(year, month0, 1);
  const lead = first.getDay();
  const cells: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month0, 1 - lead + i);
    cells.push({
      key: dateKey(d.getFullYear(), d.getMonth(), d.getDate()),
      day: d.getDate(),
      inMonth: d.getMonth() === month0,
    });
  }
  return cells;
}

export function calendarEvents({
  earnings,
  macro,
  fomc,
}: {
  earnings: readonly EarningsRow[];
  macro: readonly MacroEvent[];
  fomc: readonly FomcMeeting[];
}): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  const push = (event: CalendarEvent) => {
    const list = byDay.get(event.key);
    if (list) list.push(event);
    else byDay.set(event.key, [event]);
  };

  for (const row of earnings) {
    if (row.last) {
      push({
        kind: "earnings",
        key: utcDateKey(row.last.reportedAt),
        row,
        phase: "reported",
        report: row.last,
        estimated: false,
      });
    }
    if (row.nextAt != null) {
      push({
        kind: "earnings",
        key: utcDateKey(row.nextAt),
        row,
        phase: "upcoming",
        report: null,
        estimated: row.nextEstimated,
      });
    }
  }
  for (const event of macro) {
    push({ kind: "macro", key: localDateKey(event.at), event });
  }
  for (const meeting of fomc) {
    push({ kind: "fomc", key: meeting.start, meeting, decisionDay: false });
    push({ kind: "fomc", key: meeting.end, meeting, decisionDay: true });
  }

  // Within a day: the Fed first, then releases in time order, then earnings
  // by ticker, which is the order a trading day reads them.
  for (const list of byDay.values()) {
    list.sort((a, b) => rank(a) - rank(b) || tiebreak(a, b));
  }
  return byDay;
}

function rank(e: CalendarEvent): number {
  return e.kind === "fomc" ? 0 : e.kind === "macro" ? 1 : 2;
}

function tiebreak(a: CalendarEvent, b: CalendarEvent): number {
  if (a.kind === "macro" && b.kind === "macro") return a.event.at - b.event.at;
  if (a.kind === "earnings" && b.kind === "earnings") {
    return a.row.symbol.localeCompare(b.row.symbol);
  }
  return 0;
}
