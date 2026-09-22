"use client";

import { useEffect, useState } from "react";
import { fetchJupiterPricesViaProxy, type JupiterPriceMap } from "./prices";

const REFRESH_INTERVAL_MS = 10_000;

export function useJupiterPrices(): {
  prices: JupiterPriceMap | null;
  error: string | null;
  // The server is serving a cached payload because Jupiter is failing. Prices
  // are still rendered, because a price from a minute ago beats a blank row,
  // but a caller that wants to say so can.
  stale: boolean;
} {
  const [prices, setPrices] = useState<JupiterPriceMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await fetchJupiterPricesViaProxy();
        if (!cancelled) {
          setPrices(next.prices);
          setStale(next.stale);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        // Deliberately does NOT clear `prices`. The route only 503s when it has
        // nothing cached at all, and holding the last good map means a failed
        // poll leaves the figures standing rather than blanking every USD
        // value on screen at once. They are marked stale instead.
        setStale(true);
      }
    }

    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { prices, error, stale };
}
