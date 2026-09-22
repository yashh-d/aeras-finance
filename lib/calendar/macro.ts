// The week's economic calendar and the Fed's meeting schedule.
//
// Events come from ForexFactory's public weekly JSON, which carries title,
// currency, time, impact, forecast and previous for the current week (Sunday
// evening to Friday) and needs no key. It carries no actuals: a released
// figure has to be read from the news. There is no next-week file, so the
// calendar is this week's and says so.
//
// FOMC meetings are a registry rather than a feed. The Fed publishes them a
// year ahead as a page, not an API, and they do not move, so the year's dates
// are written here and scripts/calendar-check.mts compares them to the page.
// The decision lands at 2:00 PM ET on the second day.

export type MacroImpact = "High" | "Medium" | "Low" | "Holiday";

// The feed's row, as it arrives. `country` is a currency code.
export interface RawMacroEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast?: string;
  previous?: string;
}

export interface MacroEvent {
  id: string;
  title: string;
  country: string;
  flag: string;
  at: number;
  impact: MacroImpact;
  forecast: string | null;
  previous: string | null;
}

export interface MacroResponse {
  events: MacroEvent[];
  fetchedAt: number;
  stale: boolean;
}

const FLAGS: Readonly<Record<string, string>> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  CAD: "🇨🇦",
  AUD: "🇦🇺",
  NZD: "🇳🇿",
  CHF: "🇨🇭",
  CNY: "🇨🇳",
};

export function flagFor(country: string): string {
  return FLAGS[country] ?? "🌐";
}

// What the rail shows: every US release that is not low impact, and the
// high-impact releases elsewhere (a central bank decision, a CPI print).
// Low-impact rows are most of the feed and none of the story.
export function keepMacroEvent(event: Pick<MacroEvent, "country" | "impact">): boolean {
  if (event.country === "USD") return event.impact === "High" || event.impact === "Medium";
  return event.impact === "High";
}

export function normalizeMacro(raw: readonly RawMacroEvent[]): MacroEvent[] {
  const out: MacroEvent[] = [];
  for (const r of raw) {
    const at = Date.parse(r.date);
    if (!Number.isFinite(at) || !r.title) continue;
    const impact = isImpact(r.impact) ? r.impact : "Low";
    const event: MacroEvent = {
      id: `${r.country}:${r.title}:${r.date}`,
      title: r.title,
      country: r.country,
      flag: flagFor(r.country),
      at,
      impact,
      forecast: r.forecast ? r.forecast : null,
      previous: r.previous ? r.previous : null,
    };
    if (keepMacroEvent(event)) out.push(event);
  }
  return out.sort((a, b) => a.at - b.at);
}

function isImpact(value: string): value is MacroImpact {
  return value === "High" || value === "Medium" || value === "Low" || value === "Holiday";
}

export interface FomcMeeting {
  // ISO dates, the first and last day of the meeting.
  start: string;
  end: string;
  // Meetings that also publish a Summary of Economic Projections, starred on
  // the Fed's calendar.
  projections: boolean;
}

// From https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm,
// read 2026-09-10. Checked against the page by scripts/calendar-check.mts.
export const FOMC_MEETINGS_2026: readonly FomcMeeting[] = [
  { start: "2026-01-27", end: "2026-01-28", projections: false },
  { start: "2026-03-17", end: "2026-03-18", projections: true },
  { start: "2026-04-28", end: "2026-04-29", projections: false },
  { start: "2026-06-16", end: "2026-06-17", projections: true },
  { start: "2026-07-28", end: "2026-07-29", projections: false },
  { start: "2026-09-15", end: "2026-09-16", projections: true },
  { start: "2026-10-27", end: "2026-10-28", projections: false },
  { start: "2026-12-08", end: "2026-12-09", projections: true },
] as const;

// The next meeting whose decision has not passed. The statement is at 2:00 PM
// ET on the last day; a meeting stays "next" until midnight UTC after that
// day, so decision day itself still shows it.
export function nextFomc(
  now: number,
  meetings: readonly FomcMeeting[] = FOMC_MEETINGS_2026,
): FomcMeeting | null {
  for (const meeting of meetings) {
    const endsAt = Date.parse(`${meeting.end}T00:00:00Z`) + 86_400_000;
    if (endsAt > now) return meeting;
  }
  return null;
}
