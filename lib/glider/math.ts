// Return arithmetic for the Mag7X exposure table: per-asset compound annual
// growth, the equal-weight basket, and the since-listing figure for a name
// too new to annualise. Pure functions, no I/O, pinned by math.test.ts.

export interface PricePoint {
  // ISO date, YYYY-MM-DD.
  date: string;
  close: number;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export function yearsBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_YEAR;
}

// Compound annual growth rate, decimal. Null when the inputs cannot produce
// one (a zero start, a non-positive window).
export function cagr(first: number, last: number, years: number): number | null {
  if (!(first > 0) || !(last > 0) || !(years > 0)) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

// Below this many years the annualised figure is not shown. A stock that
// listed three months ago and fell 6% would otherwise read as "-22% a year",
// which is arithmetic, not information.
export const MIN_CAGR_YEARS = 2;

export interface AssetReturn {
  from: string;
  to: string;
  years: number;
  sessions: number;
  kind: "cagr" | "since-listing";
  value: number;
}

// The right figure for one ascending daily series: CAGR over its window when
// the window is long enough, else the plain cumulative return.
export function assetReturn(series: PricePoint[]): AssetReturn | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const years = yearsBetween(first.date, last.date);
  if (!(first.close > 0) || !(last.close > 0) || !(years > 0)) return null;
  if (years >= MIN_CAGR_YEARS) {
    const value = cagr(first.close, last.close, years);
    if (value == null) return null;
    return { from: first.date, to: last.date, years, sessions: series.length, kind: "cagr", value };
  }
  return {
    from: first.date,
    to: last.date,
    years,
    sessions: series.length,
    kind: "since-listing",
    value: last.close / first.close - 1,
  };
}

export interface BasketReturn {
  cagr: number;
  years: number;
  from: string;
  to: string;
  tickers: string[];
  excluded: string[];
}

// Daily-rebalanced equal weight across every series that covers the full
// window, which is the closest simple model of what Glider runs (daily
// schedule, equal target weights). A series shorter than the window is
// excluded and named, rather than silently shortening the window for
// everyone: SpaceX listed in June 2026, and a ten-year figure that quietly
// became a three-month one would be worse than no figure.
//
// The window is the longest one every INCLUDED series covers. Dates are
// aligned by intersection so a missing session in one series drops that day
// for all, which costs nothing at daily resolution over ten years.
export function equalWeightBasketReturn(
  byTicker: Record<string, PricePoint[]>,
  minYears = MIN_CAGR_YEARS,
): BasketReturn | null {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const [ticker, series] of Object.entries(byTicker)) {
    if (series.length >= 2 && yearsBetween(series[0].date, series[series.length - 1].date) >= minYears) {
      included.push(ticker);
    } else {
      excluded.push(ticker);
    }
  }
  if (included.length === 0) return null;

  // Dates every included series has, in order.
  let common: Set<string> | null = null;
  for (const ticker of included) {
    const dates = new Set<string>(byTicker[ticker].map((p) => p.date));
    if (common === null) {
      common = dates;
    } else {
      const kept = new Set<string>();
      for (const d of common) if (dates.has(d)) kept.add(d);
      common = kept;
    }
  }
  const dates = [...(common ?? [])].sort();
  if (dates.length < 2) return null;

  const closes = new Map<string, Map<string, number>>();
  for (const ticker of included) {
    closes.set(ticker, new Map(byTicker[ticker].map((p) => [p.date, p.close])));
  }

  let value = 1;
  for (let i = 1; i < dates.length; i++) {
    let sum = 0;
    for (const ticker of included) {
      const prev = closes.get(ticker)!.get(dates[i - 1])!;
      const cur = closes.get(ticker)!.get(dates[i])!;
      sum += cur / prev;
    }
    value *= sum / included.length;
  }

  const from = dates[0];
  const to = dates[dates.length - 1];
  const years = yearsBetween(from, to);
  const rate = cagr(1, value, years);
  if (rate == null) return null;
  return { cagr: rate, years, from, to, tickers: included.sort(), excluded: excluded.sort() };
}
