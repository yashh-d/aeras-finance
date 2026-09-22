import { describe, expect, it } from "vitest";

import type { EarningsRow } from "./earnings";
import type { MacroEvent } from "./macro";
import { calendarEvents, dateKey, localDateKey, monthGrid, utcDateKey } from "./month";

describe("monthGrid", () => {
  it("is six Sunday-first weeks with the month's days marked", () => {
    // September 2026 starts on a Tuesday.
    const grid = monthGrid(2026, 8);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ key: "2026-08-30", day: 30, inMonth: false });
    expect(grid[2]).toEqual({ key: "2026-09-01", day: 1, inMonth: true });
    expect(grid.filter((d) => d.inMonth)).toHaveLength(30);
    expect(grid[41].key).toBe("2026-10-10");
  });
});

describe("keys", () => {
  it("keys a UTC-midnight day by its UTC date whatever the zone", () => {
    expect(utcDateKey(Date.UTC(2026, 9, 29))).toBe("2026-10-29");
    expect(dateKey(2026, 0, 5)).toBe("2026-01-05");
  });
  it("keys an instant by the local day", () => {
    const local = new Date(2026, 8, 11, 8, 30).getTime();
    expect(localDateKey(local)).toBe("2026-09-11");
  });
});

describe("calendarEvents", () => {
  const row = (symbol: string, fields: Partial<EarningsRow> = {}): EarningsRow => ({
    symbol,
    mint: symbol,
    name: symbol,
    nextAt: null,
    nextEstimated: true,
    nextConsensus: null,
    last: null,
    ...fields,
  });
  const macro = (title: string, at: number): MacroEvent => ({
    id: title,
    title,
    country: "USD",
    flag: "🇺🇸",
    at,
    impact: "High",
    forecast: null,
    previous: null,
  });

  it("places reports, next dates, releases and both FOMC days, ordered within a day", () => {
    const cpiAt = new Date(2026, 8, 16, 8, 30).getTime();
    const byDay = calendarEvents({
      earnings: [
        row("AAPL", { nextAt: Date.UTC(2026, 8, 16), last: { reportedAt: Date.UTC(2026, 6, 30), fiscalQuarter: "Jun 2026", eps: 1.91, consensus: 1.88, surprisePct: 1.6, verdict: "beat" } }),
        row("AAA", { nextAt: Date.UTC(2026, 8, 16), nextEstimated: false }),
      ],
      macro: [macro("CPI m/m", cpiAt)],
      fomc: [{ start: "2026-09-15", end: "2026-09-16", projections: true }],
    });
    expect(byDay.get("2026-07-30")?.map((e) => e.kind)).toEqual(["earnings"]);
    expect(byDay.get("2026-09-15")?.map((e) => e.kind)).toEqual(["fomc"]);
    const day = byDay.get("2026-09-16")!;
    expect(day.map((e) => e.kind)).toEqual(["fomc", "macro", "earnings", "earnings"]);
    expect(day[0].kind === "fomc" && day[0].decisionDay).toBe(true);
    expect(day[2].kind === "earnings" && day[2].row.symbol).toBe("AAA");
    expect(day[2].kind === "earnings" && day[2].estimated).toBe(false);
    expect(day[3].kind === "earnings" && day[3].estimated).toBe(true);
  });

  it("is empty with nothing to place", () => {
    expect(calendarEvents({ earnings: [], macro: [], fomc: [] }).size).toBe(0);
  });
});
