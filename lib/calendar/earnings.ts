// Earnings for the catalog's companies: the last report against consensus,
// and the next date. The source is Nasdaq's public site API, which needs no
// key but does want browser-like headers (see earnings-server.ts). Two calls
// per company: `analyst/<ticker>/earnings-date`, whose date and consensus are
// written as sentences and are parsed out of them here, and
// `company/<ticker>/earnings-surprise`, whose history is structured.
//
// Only rows with `category: "stocks"` are companies. SPY, QQQ and GLD are
// funds and the bullion tokens are metal; Nasdaq answers 400 for all of them,
// which is correct, so they are never asked.
//
// The next date is usually a projection: Nasdaq's vendor derives it from past
// reporting dates until the company announces, and says so in the sentence.
// `nextEstimated` carries that through so the row can be honest about it.

import { XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";
import { underlyingTicker } from "@/lib/terminal/quotes";

export type EarningsVerdict = "beat" | "miss" | "met";

export interface EarningsReport {
  // The report day, as midnight UTC. Nasdaq gives a date, not a time.
  reportedAt: number;
  fiscalQuarter: string;
  eps: number;
  consensus: number | null;
  surprisePct: number | null;
  verdict: EarningsVerdict | null;
}

export interface EarningsRow {
  // The underlying ticker, which is what Nasdaq and the row both print.
  symbol: string;
  // The catalog mint, so a row can select the asset.
  mint: string;
  name: string;
  nextAt: number | null;
  nextEstimated: boolean;
  nextConsensus: number | null;
  last: EarningsReport | null;
}

export interface EarningsResponse {
  rows: EarningsRow[];
  fetchedAt: number;
  stale: boolean;
  // Companies Nasdaq did not answer for this time. Listed rather than
  // silently absent so a check script or a reader can tell "no news" from
  // "no data".
  missing: string[];
}

export function earningsCompanies(): XStock[] {
  return XSTOCKS.filter((x) => x.category === "stocks");
}

// Nasdaq's shapes, narrowed to what is read. Verified live 2026-09-10.
export interface NasdaqEarningsDate {
  data: { announcement?: string | null; reportText?: string | null } | null;
  status?: { rCode?: number };
}

export interface NasdaqEarningsSurprise {
  data: {
    earningsSurpriseTable?: {
      rows?: Array<{
        fiscalQtrEnd: string;
        dateReported: string;
        eps: number | string;
        consensusForecast: number | string | null;
        percentageSurprise: number | string | null;
      }>;
    } | null;
  } | null;
  status?: { rCode?: number };
}

export function buildEarningsRow(
  xstock: XStock,
  date: NasdaqEarningsDate | null,
  surprise: NasdaqEarningsSurprise | null,
): EarningsRow {
  const announcement = date?.data?.announcement ?? "";
  const reportText = date?.data?.reportText ?? "";
  const lastRaw = surprise?.data?.earningsSurpriseTable?.rows?.[0];
  let last: EarningsReport | null = null;
  if (lastRaw) {
    const reportedAt = parseUsDate(lastRaw.dateReported);
    const eps = toNumber(lastRaw.eps);
    if (reportedAt != null && eps != null) {
      const surprisePct = toNumber(lastRaw.percentageSurprise);
      last = {
        reportedAt,
        fiscalQuarter: lastRaw.fiscalQtrEnd,
        eps,
        consensus: toNumber(lastRaw.consensusForecast),
        surprisePct,
        verdict: verdictOf(surprisePct),
      };
    }
  }
  return {
    symbol: underlyingTicker(xstock),
    mint: xstock.mint,
    name: xstock.name,
    nextAt: parseAnnouncementDate(announcement),
    nextEstimated: /\bestimated\b/i.test(reportText),
    nextConsensus: parseConsensus(reportText),
    last,
  };
}

// "7/30/2026", the US order Nasdaq writes, to midnight UTC.
export function parseUsDate(value: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(value ?? "");
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "Earnings announcement* for AAPL: Oct 29, 2026". Nothing after the colon
// when the vendor has no date yet, which is the case right after a report.
export function parseAnnouncementDate(value: string | null | undefined): number | null {
  const m = /:\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(value ?? "");
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  return Date.UTC(Number(m[3]), month, Number(m[2]));
}

// "... the consensus EPS forecast for the quarter is $1.98." Negative
// figures are written in accounting parentheses elsewhere on the site, so
// both forms are accepted.
export function parseConsensus(reportText: string | null | undefined): number | null {
  const m = /consensus EPS forecast for the quarter is\s*(\(?-?\$?[\d,]*\.?\d+\)?)/i.exec(
    reportText ?? "",
  );
  return m ? parseMoney(m[1]) : null;
}

// "$1.98", "-$0.39", "($0.16)" and plain numbers.
export function parseMoney(value: string): number | null {
  const s = value.trim();
  const negative = s.startsWith("(") && s.endsWith(")") ? true : s.startsWith("-");
  const digits = s.replace(/[()$,\s-]/g, "");
  if (digits === "" || !/^\d*\.?\d+$/.test(digits)) return null;
  const n = Number(digits);
  return negative ? -n : n;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function verdictOf(surprisePct: number | null): EarningsVerdict | null {
  if (surprisePct == null) return null;
  if (surprisePct > 0) return "beat";
  if (surprisePct < 0) return "miss";
  return "met";
}

// How the rail orders the rows. A report inside this window is the news
// about that company, so it leads and shows the print; older than that, the
// next date is what matters. A month: reporting seasons are about six weeks
// apart, and at 45 days the whole catalog read as "reported" until the next
// season was two weeks out.
export const RECENT_REPORT_DAYS = 30;

export type EarningsView =
  | { kind: "reported"; row: EarningsRow; report: EarningsReport }
  | { kind: "upcoming"; row: EarningsRow; at: number }
  | { kind: "unknown"; row: EarningsRow };

export function earningsViews(rows: readonly EarningsRow[], now: number): EarningsView[] {
  const recentCutoff = now - RECENT_REPORT_DAYS * 86_400_000;
  const reported: Extract<EarningsView, { kind: "reported" }>[] = [];
  const upcoming: Extract<EarningsView, { kind: "upcoming" }>[] = [];
  const unknown: Extract<EarningsView, { kind: "unknown" }>[] = [];
  for (const row of rows) {
    if (row.last && row.last.reportedAt >= recentCutoff) {
      reported.push({ kind: "reported", row, report: row.last });
    } else if (row.nextAt != null) {
      upcoming.push({ kind: "upcoming", row, at: row.nextAt });
    } else {
      unknown.push({ kind: "unknown", row });
    }
  }
  reported.sort((a, b) => b.report.reportedAt - a.report.reportedAt);
  upcoming.sort((a, b) => a.at - b.at);
  unknown.sort((a, b) => a.row.symbol.localeCompare(b.row.symbol));
  return [...reported, ...upcoming, ...unknown];
}
