"use client";

// The Lighter market catalog on its own, for surfaces that only need to know
// what markets exist: the Home chart picker lists them, and nothing there
// sizes or signs anything. useHedge and useLighterPerps each read the catalog
// too, but joined to account state, which an anonymous chart has no use for.
//
// One fetch is shared across every mounted caller and kept for a minute. Three
// chart slots mount together on Home, and without this each would hit the
// proxy on its own.

import { useEffect, useMemo, useState } from "react";

import { fetchLighterCatalog } from "./client";
import { tradeableMarkets } from "./markets";
import type { LighterMarket } from "./types";

const CATALOG_TTL_MS = 60_000;

let cache: { at: number; markets: LighterMarket[] } | null = null;
let inFlight: Promise<LighterMarket[]> | null = null;

function loadCatalog(): Promise<LighterMarket[]> {
  if (cache && Date.now() - cache.at < CATALOG_TTL_MS) {
    return Promise.resolve(cache.markets);
  }
  if (inFlight) return inFlight;
  inFlight = fetchLighterCatalog()
    .then((result) => {
      cache = { at: Date.now(), markets: result.markets };
      return result.markets;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export interface LighterCatalogState {
  // Tradeable markets only, sorted by symbol. Empty until loaded.
  markets: LighterMarket[];
  loading: boolean;
  error: string | null;
}

export function useLighterCatalog(): LighterCatalogState {
  // Seeded from the module cache so a remount draws the list immediately.
  const [result, setResult] = useState<{
    markets: LighterMarket[] | null;
    error: string | null;
  }>(() => ({ markets: cache?.markets ?? null, error: null }));

  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then((markets) => {
        if (!cancelled) setResult({ markets, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep a list we already had; only report the failure when there is
        // nothing to show instead.
        setResult((prev) => ({
          markets: prev.markets,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markets = useMemo(
    () =>
      result.markets
        ? tradeableMarkets(result.markets).sort((a, b) =>
            a.symbol.localeCompare(b.symbol),
          )
        : [],
    [result.markets],
  );

  return {
    markets,
    loading: result.markets === null && result.error === null,
    error: result.error,
  };
}
