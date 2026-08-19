"use client";

// Candle and sparkline reads for the hedge tab.
//
// Both hooks keep a module-scoped cache of the last good response. Switching
// market or range then redraws the previous series immediately and refetches
// behind it, so the chart never blanks to a spinner on a toggle and a failed
// refresh falls back to what was on screen instead of an error panel. This is
// the same shape components/PriceChart.tsx uses, for the same reason.

import { useEffect, useMemo, useState } from "react";

import {
  fetchCandlesViaProxy,
  fetchSparklinesViaProxy,
  type CandleRange,
  type CandleSeries,
  type SparklineMap,
} from "./candles";

// Matches the server-side cache on /api/lighter/candles, so a poll that lands
// early costs a round trip to our own origin and nothing upstream.
const POLL_MS = 30_000;

const seriesCache = new Map<string, CandleSeries>();

export interface UseCandles {
  series: CandleSeries | null;
  loading: boolean;
  error: string | null;
}

export function useCandles(
  marketId: number | null,
  range: CandleRange,
): UseCandles {
  const key = marketId == null ? "" : `${marketId}:${range}`;
  // Stamped with the key it was fetched for, so a result that arrives after the
  // user has already switched market or range is ignored during render rather
  // than cleared by an effect. That keeps every setState inside an async
  // continuation and off the synchronous render path.
  const [fetched, setFetched] = useState<{
    key: string;
    series: CandleSeries | null;
    error: string | null;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (marketId == null) return;
    let cancelled = false;

    fetchCandlesViaProxy(marketId, range)
      .then((next) => {
        if (cancelled) return;
        seriesCache.set(key, next);
        setFetched({ key, series: next, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        // Only surface a failure when there is nothing to keep showing.
        setFetched({
          key,
          series: seriesCache.get(key) ?? null,
          error: seriesCache.has(key)
            ? null
            : err instanceof Error
              ? err.message
              : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [marketId, range, key, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const current = fetched?.key === key ? fetched : null;
  // Falling back to the cache is what makes a range toggle redraw instantly
  // instead of blanking while the new range is in flight.
  const series =
    marketId == null ? null : (current?.series ?? seriesCache.get(key) ?? null);
  const error = current?.error ?? null;

  return {
    series,
    loading: marketId != null && series === null && error === null,
    error,
  };
}

const sparklineCache: SparklineMap = {};

export function useSparklines(marketIds: number[]): SparklineMap {
  // Sorted and joined so a re-render that produces the same ids in a different
  // order does not refetch.
  const key = useMemo(
    () => [...new Set(marketIds)].sort((a, b) => a - b).join(","),
    [marketIds],
  );
  const [map, setMap] = useState<SparklineMap>(sparklineCache);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    fetchSparklinesViaProxy(key.split(",").map(Number))
      .then((next) => {
        if (cancelled) return;
        Object.assign(sparklineCache, next);
        setMap({ ...sparklineCache });
      })
      .catch(() => {
        // A missing sparkline costs a row its line and nothing else. The price
        // and coverage on that row come from the catalog, not from here.
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return map;
}
