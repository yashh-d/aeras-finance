"use client";

import { useEffect, useState } from "react";

import { fetchRyskCatalog } from "./client";
import { RYSK_CATALOG_REFRESH_MS } from "./constants";
import type { RyskCatalog } from "./types";

// Polls the Rysk option chain through our proxy. Follows the EarnPanel vault
// hooks: interval refresh, cancellation flag on unmount, failure surfaced rather
// than swallowed.
//
// A refresh failure keeps the last good catalog on screen instead of blanking
// it. A strike ladder thirty seconds stale is still an accurate picture of what
// Rysk lists; an empty panel would wrongly read as "no markets".
export function useRyskChain(): {
  catalog: RyskCatalog | null;
  loading: boolean;
  error: string | null;
} {
  const [catalog, setCatalog] = useState<RyskCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const next = await fetchRyskCatalog();
        if (cancelled) return;
        setCatalog(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(load, RYSK_CATALOG_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { catalog, loading, error };
}
