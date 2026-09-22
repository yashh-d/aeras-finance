// Nasdaq reads for the earnings rail, cached per company for six hours and
// served stale for two days past that when Nasdaq does not answer. Two
// requests per company, four companies at a time: fifteen companies is thirty
// requests per refresh, four times a day, from one server. A cold refresh
// takes about ten seconds; only the first viewer after a deploy waits for it.
//
// The headers matter. Nasdaq's site API is meant for its own pages and
// answers a bare fetch with a hang or a 403; a browser-like User-Agent with
// JSON Accept headers is what it serves. That is the whole reason this runs
// server-side rather than in the page, along with the CSP.

import {
  buildEarningsRow,
  earningsCompanies,
  type EarningsResponse,
  type EarningsRow,
  type NasdaqEarningsDate,
  type NasdaqEarningsSurprise,
} from "./earnings";
import type { XStock } from "@/lib/jupiter/xstocks";

const NASDAQ_API = "https://api.nasdaq.com/api";
const TTL_MS = 6 * 60 * 60_000;
const STALE_MAX_MS = 48 * 60 * 60_000;
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;

export const NASDAQ_HEADERS: Readonly<Record<string, string>> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
};

interface CacheEntry {
  row: EarningsRow;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

export async function nasdaqJson<T>(path: string): Promise<T> {
  const res = await fetch(`${NASDAQ_API}${path}`, {
    cache: "no-store",
    headers: NASDAQ_HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nasdaq ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function loadCompany(xstock: XStock, ticker: string): Promise<CacheEntry> {
  const pending = inFlight.get(ticker);
  if (pending) return pending;
  const run = (async () => {
    const [date, surprise] = await Promise.all([
      nasdaqJson<NasdaqEarningsDate>(`/analyst/${ticker}/earnings-date`),
      nasdaqJson<NasdaqEarningsSurprise>(`/company/${ticker}/earnings-surprise`),
    ]);
    // Nasdaq answers 200 with a 400 inside for a ticker it does not cover.
    if (date.status?.rCode === 400 && surprise.status?.rCode === 400) {
      throw new Error(`Nasdaq has no earnings data for ${ticker}`);
    }
    const entry: CacheEntry = {
      row: buildEarningsRow(xstock, date, surprise),
      fetchedAt: Date.now(),
    };
    cache.set(ticker, entry);
    return entry;
  })().finally(() => {
    inFlight.delete(ticker);
  });
  inFlight.set(ticker, run);
  return run;
}

export async function fetchCompanyEarnings(
  xstock: XStock,
): Promise<{ row: EarningsRow; fetchedAt: number; stale: boolean }> {
  const ticker = xstock.symbol.replace(/x$/, "");
  const cached = cache.get(ticker);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < TTL_MS) return { ...cached, stale: false };
  try {
    return { ...(await loadCompany(xstock, ticker)), stale: false };
  } catch (err) {
    if (cached && now - cached.fetchedAt < STALE_MAX_MS) return { ...cached, stale: true };
    throw err;
  }
}

export async function loadEarnings(): Promise<EarningsResponse> {
  const companies = earningsCompanies();
  const results = await mapPool(companies, CONCURRENCY, async (x) => {
    try {
      return await fetchCompanyEarnings(x);
    } catch {
      return null;
    }
  });
  const rows: EarningsRow[] = [];
  const missing: string[] = [];
  let stale = false;
  let fetchedAt = Date.now();
  results.forEach((result, i) => {
    if (!result) {
      missing.push(companies[i].symbol.replace(/x$/, ""));
      return;
    }
    rows.push(result.row);
    stale = stale || result.stale;
    fetchedAt = Math.min(fetchedAt, result.fetchedAt);
  });
  if (rows.length === 0) throw new Error("Nasdaq did not answer for any company");
  return { rows, fetchedAt, stale, missing };
}

// N at a time, in order. Enough for a burst of thirty-four requests to stay
// polite without a queue library.
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
