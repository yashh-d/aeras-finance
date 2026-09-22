// Ten years of daily closes for each Mag7X holding, from Nasdaq, turned into
// the CAGR table the exposure card shows.
//
// Nasdaq's site API is keyless and split-adjusted (see history.ts) and wants
// browser-like headers, which lib/calendar/earnings-server.ts already sends.
// Eight tickers are fetched one at a time with a short gap: measured on
// 2026-09-22, eight back-to-back reads answered in about ten seconds with no
// throttling, and the result is cached for a day, so only the first viewer
// after a deploy waits.
//
// The basket figure excludes any holding without the full window and names
// it. SpaceX listed on 2026-06-12, so the ten-year basket is seven names and
// the row for SpaceX carries a since-listing return instead.

import "server-only";

import { nasdaqJson } from "@/lib/calendar/earnings-server";
import { dedupe } from "@/lib/upstream";

import { MAG7X_HOLDINGS } from "./constants";
import { parseNasdaqHistory, type NasdaqHistoricalPayload } from "./history";
import { assetReturn, equalWeightBasketReturn, type PricePoint } from "./math";
import type { HistoryRow, HistoryView } from "./types";

const TTL_MS = 24 * 60 * 60_000;
const STALE_MAX_MS = 7 * 24 * 60 * 60_000;
const YEARS = 10;
const GAP_MS = 400;

let cache: { view: HistoryView; fetchedAt: number } | null = null;

function isoDaysAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

async function fetchSeries(ticker: string): Promise<PricePoint[]> {
  const from = isoDaysAgo(YEARS);
  const to = new Date().toISOString().slice(0, 10);
  const payload = await nasdaqJson<NasdaqHistoricalPayload>(
    `/quote/${encodeURIComponent(ticker)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=9999`,
  );
  return parseNasdaqHistory(payload);
}

async function build(): Promise<HistoryView> {
  const byTicker: Record<string, PricePoint[]> = {};
  const rows: HistoryRow[] = [];
  for (const holding of MAG7X_HOLDINGS) {
    try {
      const series = await fetchSeries(holding.ticker);
      byTicker[holding.ticker] = series;
      const r = assetReturn(series);
      if (r) {
        rows.push({
          ticker: holding.ticker,
          symbol: holding.symbol,
          name: holding.name,
          from: r.from,
          to: r.to,
          years: r.years,
          sessions: r.sessions,
          kind: r.kind,
          value: r.value,
        });
      }
    } catch (err) {
      // One missing series costs its own row, not the table.
      console.error(`[glider history] ${holding.ticker}`, err);
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  const basket = equalWeightBasketReturn(byTicker);
  return {
    rows,
    basket: basket
      ? {
          cagr: basket.cagr,
          years: basket.years,
          from: basket.from,
          to: basket.to,
          tickers: basket.tickers,
          excluded: basket.excluded,
        }
      : null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function loadHistory(): Promise<{ view: HistoryView; stale: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return { view: cache.view, stale: false };
  }
  try {
    const view = await dedupe("glider-history", build);
    if (view.rows.length === 0) throw new Error("Nasdaq returned no history for any holding");
    cache = { view, fetchedAt: Date.now() };
    return { view, stale: false };
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < TTL_MS + STALE_MAX_MS) {
      console.warn("[glider history] serving stale:", err);
      return { view: cache.view, stale: true };
    }
    throw err;
  }
}
