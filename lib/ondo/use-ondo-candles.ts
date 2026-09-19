"use client";

// Ondo chart history for the perps tab, by range.
//
// The same shape as lib/lighter/use-candles.ts and for the same reason: a
// module cache of the last good series, so a market or range switch redraws
// what was on screen and refetches behind it, and a failed refresh keeps the
// chart rather than blanking it.
//
// Ranges map to the UDF resolutions app/api/ondo/history accepts. The window
// per range is the same the Lighter chart draws, so the two columns show the
// same span for the same button. Only "15" has been captured from production
// (docs/ondo-perps.md); the others are the standard UDF strings the route
// already admits, and an unsupported one comes back as an empty series, which
// the chart shows as "no history" rather than an error.

import { useEffect, useState } from "react";

import type { ChartRange } from "@/components/VenueChartFrame";

import { fetchOndoCandles } from "./client";
import type { OndoCandle } from "./types";

interface RangeSpec {
  resolution: string;
  countback: number;
  label: string;
}

const RANGE_SPECS: Record<ChartRange, RangeSpec> = {
  "1H": { resolution: "1", countback: 60, label: "1m" },
  "1D": { resolution: "5", countback: 288, label: "5m" },
  "1W": { resolution: "60", countback: 168, label: "1h" },
  "1M": { resolution: "240", countback: 180, label: "4h" },
  "3M": { resolution: "1D", countback: 90, label: "1d" },
};

export function ondoResolutionLabel(range: ChartRange): string {
  return RANGE_SPECS[range].label;
}

// Matches the Lighter chart's poll. The WebSocket carries the live bar
// between polls; this is what carries a new bar opening.
const POLL_MS = 30_000;

const cache = new Map<string, OndoCandle[]>();

export interface UseOndoCandles {
  candles: OndoCandle[];
  loading: boolean;
  error: string | null;
}

export function useOndoCandles(market: string | null, range: ChartRange): UseOndoCandles {
  const key = market == null ? "" : `${market}:${range}`;
  const [fetched, setFetched] = useState<{
    key: string;
    candles: OndoCandle[] | null;
    error: string | null;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (market == null) return;
    let cancelled = false;
    const spec = RANGE_SPECS[range];

    fetchOndoCandles(market, spec.resolution, spec.countback)
      .then((next) => {
        if (cancelled) return;
        cache.set(key, next);
        setFetched({ key, candles: next, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setFetched({
          key,
          candles: cache.get(key) ?? null,
          error: cache.has(key) ? null : err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [market, range, key, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const current = fetched?.key === key ? fetched : null;
  const candles = market == null ? null : (current?.candles ?? cache.get(key) ?? null);
  const error = current?.error ?? null;

  return {
    candles: candles ?? [],
    loading: market != null && candles === null && error === null,
    error,
  };
}
