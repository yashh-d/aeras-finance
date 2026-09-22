// The portfolio trendline's arithmetic, kept out of the component so it can be
// checked without a browser. See scripts/portfolio-total-check.mts.
//
// The line answers "what would today's holdings have been worth along the way",
// so it carries each holding back along its own price curve. Two rules make it
// agree with the "In wallet" tile drawn above it:
//
//   1. A holding is scaled by price[i]/price[last], not repriced from a token
//      amount. The last candle close is not the live price, so the amount form
//      landed a cent or two off the tile for no reason a user could see. It also
//      lets a holding priced off one mint ride another's curve: TSLAon has its
//      own price and no chart of its own, and tracks TSLAx one for one.
//   2. Anything with no usable curve is held flat at today's value rather than
//      dropped, so the level stays right even when a fetch fails.
//
// Together those give v[last] === the sum of every holding's current USD value,
// exactly. That equality is the property worth protecting: the two numbers
// disagreeing is what made this card read as broken.

import type { OhlcCandle } from "./charts";

export interface TrendPoint {
  t: number;
  v: number;
}

// Fetched history, keyed by the curated xStock mint it was fetched for.
export type CandleSet = Record<string, OhlcCandle[]>;

export function combineTrendSeries(
  candles: CandleSet,
  // Today's USD value per chartable mint, summed across the holdings that ride
  // that mint's curve.
  chartable: Map<string, number>,
  // Today's USD value of everything with no curve at all.
  flatUsd: number,
): TrendPoint[] {
  const entries = Object.entries(candles).filter(
    ([mint, rows]) => rows.length > 0 && (chartable.get(mint) ?? 0) > 0,
  );
  if (entries.length === 0) return [];

  // Longest candle series is the time axis. Every other series snaps onto these
  // timestamps by nearest-prior interpolation.
  const longest = entries.reduce((acc, e) =>
    e[1].length > acc[1].length ? e : acc,
  );
  const timestamps = longest[1].map((c) => c.t);

  let baseline = flatUsd;
  const curves: Array<{ usd: number; path: number[]; last: number }> = [];
  for (const [mint, rows] of entries) {
    const usd = chartable.get(mint) ?? 0;
    const path = snapToTimestamps(timestamps, rows);
    const last = path[path.length - 1];
    // A curve whose last price is zero would divide by zero. Hold that holding
    // flat with the rest rather than dropping its value out of the line.
    if (!last) {
      baseline += usd;
      continue;
    }
    curves.push({ usd, path, last });
  }
  // A chartable mint the fetch did not return is held flat too, so the level
  // stays right when only some curves loaded.
  for (const [mint, usd] of chartable) {
    if (!candles[mint] || candles[mint].length === 0) baseline += usd;
  }

  return timestamps.map((t, i) => {
    let v = baseline;
    for (const c of curves) v += c.usd * (c.path[i] / c.last);
    return { t, v };
  });
}

export function snapToTimestamps(
  timestamps: number[],
  candles: OhlcCandle[],
): number[] {
  if (candles.length === 0) return timestamps.map(() => 0);
  const out: number[] = new Array(timestamps.length);
  let j = 0;
  let last = candles[0].c;
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    while (j < candles.length && candles[j].t <= t) {
      last = candles[j].c;
      j++;
    }
    out[i] = last;
  }
  return out;
}
