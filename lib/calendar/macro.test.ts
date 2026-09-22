import { describe, expect, it } from "vitest";

import {
  flagFor,
  FOMC_MEETINGS_2026,
  keepMacroEvent,
  nextFomc,
  normalizeMacro,
} from "./macro";

// Rows captured from the ForexFactory weekly feed on 2026-09-10.
const RAW = [
  { title: "Natural Gas Storage", country: "USD", date: "2026-09-10T10:30:00-04:00", impact: "Low", forecast: "35B", previous: "30B" },
  { title: "Core CPI m/m", country: "USD", date: "2026-09-11T08:30:00-04:00", impact: "High", forecast: "0.2%", previous: "0.2%" },
  { title: "Unemployment Claims", country: "USD", date: "2026-09-10T08:30:00-04:00", impact: "Medium", forecast: "205K", previous: "206K" },
  { title: "Main Refinancing Rate", country: "EUR", date: "2026-09-10T08:15:00-04:00", impact: "High", forecast: "2.60%", previous: "2.40%" },
  { title: "German Final CPI m/m", country: "EUR", date: "2026-09-11T02:00:00-04:00", impact: "Low", forecast: "0.1%", previous: "0.1%" },
  { title: "President Trump Speaks", country: "USD", date: "2026-09-09T21:15:00-04:00", impact: "Medium", forecast: "", previous: "" },
  { title: "Bank Holiday", country: "All", date: "not a date", impact: "Holiday" },
];

describe("normalizeMacro", () => {
  it("keeps US medium and high and foreign high, ordered by time, with empty figures as null", () => {
    const events = normalizeMacro(RAW);
    expect(events.map((e) => e.title)).toEqual([
      "President Trump Speaks",
      "Main Refinancing Rate",
      "Unemployment Claims",
      "Core CPI m/m",
    ]);
    expect(events[0].forecast).toBeNull();
    expect(events[3]).toMatchObject({
      country: "USD",
      flag: "🇺🇸",
      impact: "High",
      forecast: "0.2%",
      previous: "0.2%",
      at: Date.UTC(2026, 8, 11, 12, 30),
    });
    expect(events[1].flag).toBe("🇪🇺");
  });

  it("drops rows with no parseable time", () => {
    expect(normalizeMacro([{ title: "x", country: "USD", date: "soon", impact: "High" }])).toEqual([]);
  });
});

describe("keepMacroEvent and flagFor", () => {
  it("draws the line at medium for the US and high elsewhere", () => {
    expect(keepMacroEvent({ country: "USD", impact: "Medium" })).toBe(true);
    expect(keepMacroEvent({ country: "USD", impact: "Low" })).toBe(false);
    expect(keepMacroEvent({ country: "GBP", impact: "Medium" })).toBe(false);
    expect(keepMacroEvent({ country: "GBP", impact: "High" })).toBe(true);
  });
  it("has a flag for every currency in the feed and a globe for the rest", () => {
    for (const c of ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "NZD", "CHF", "CNY"]) {
      expect(flagFor(c)).not.toBe("🌐");
    }
    expect(flagFor("All")).toBe("🌐");
  });
});

describe("nextFomc", () => {
  it("is the September meeting through its decision day, then October", () => {
    expect(nextFomc(Date.UTC(2026, 8, 10))?.start).toBe("2026-09-15");
    expect(nextFomc(Date.UTC(2026, 8, 16, 23))?.start).toBe("2026-09-15");
    expect(nextFomc(Date.UTC(2026, 8, 17))?.start).toBe("2026-10-27");
  });
  it("is null once the year's last decision has passed", () => {
    expect(nextFomc(Date.UTC(2026, 11, 31))).toBeNull();
  });
  it("lists eight two-day meetings in order", () => {
    expect(FOMC_MEETINGS_2026).toHaveLength(8);
    for (let i = 1; i < FOMC_MEETINGS_2026.length; i++) {
      expect(FOMC_MEETINGS_2026[i].start > FOMC_MEETINGS_2026[i - 1].end).toBe(true);
    }
  });
});
