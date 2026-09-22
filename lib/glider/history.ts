// Parsing Nasdaq's historical-quotes payload into a daily close series.
//
// Nasdaq's site API answers `/quote/<ticker>/historical` with rows newest
// first, prices as "$336.13" strings and dates as MM/DD/YYYY. Verified
// split-adjusted on 2026-09-22: AAPL's September 2016 close reads $28.39, a
// quarter of the $113 it printed at the time, so the 4:1 split of 2020 is in
// the series and a CAGR over it is honest. Pinned by history.test.ts.

import type { PricePoint } from "./math";

export interface NasdaqHistoricalRow {
  date: string;
  close: string;
  volume?: string;
  open?: string;
  high?: string;
  low?: string;
}

export interface NasdaqHistoricalPayload {
  data?: {
    symbol?: string;
    totalRecords?: number;
    tradesTable?: { rows?: NasdaqHistoricalRow[] | null } | null;
  } | null;
  status?: { rCode?: number; bCodeMessage?: unknown } | null;
}

export function parseNasdaqPrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "--" || cleaned.toUpperCase() === "N/A") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// "09/18/2026" -> "2026-09-18". Anything else is null rather than a guess.
export function parseNasdaqDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

// Ascending by date, one point per session, rows it cannot read dropped.
export function parseNasdaqHistory(payload: NasdaqHistoricalPayload): PricePoint[] {
  const rows = payload.data?.tradesTable?.rows ?? [];
  const out: PricePoint[] = [];
  for (const row of rows) {
    const date = parseNasdaqDate(row.date);
    const close = parseNasdaqPrice(row.close);
    if (!date || close == null || !(close > 0)) continue;
    out.push({ date, close });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
