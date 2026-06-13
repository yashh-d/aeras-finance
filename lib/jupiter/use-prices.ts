"use client";

import { useEffect, useState } from "react";
import { fetchJupiterPricesViaProxy, type JupiterPriceMap } from "./prices";

const REFRESH_INTERVAL_MS = 10_000;

export function useJupiterPrices(): {
  prices: JupiterPriceMap | null;
  error: string | null;
} {
  const [prices, setPrices] = useState<JupiterPriceMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await fetchJupiterPricesViaProxy();
        if (!cancelled) {
          setPrices(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { prices, error };
}
