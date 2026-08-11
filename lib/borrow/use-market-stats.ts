"use client";

import { useEffect, useState } from "react";

import {
  fetchLiveVaultStateViaProxy,
  XSTOCK_BORROW_VAULTS,
} from "@/lib/jupiter/borrow";
import {
  KAMINO_USDC_BORROW,
  KAMINO_XSTOCK_COLLATERALS,
} from "@/lib/kamino/reserves";
import type { KaminoReserveMetric } from "@/app/api/kamino/reserves/metrics/route";

// Rate and size for one borrow market. Keyed by a venue-specific market key
// (`jup-<vaultId>` or `kamino-<reserve>`) rather than by mint, so a stock that
// exists on both Jupiter and Kamino keeps a distinct rate/size per venue and the
// two rows never clobber each other.
export interface MarketStat {
  // Annualised USDC borrow rate as a percent (7.81 = 7.81%). Null while loading
  // or if the source is unavailable.
  borrowAprPct: number | null;
  // Market size in USD (total collateral supplied). Null while loading.
  sizeUsd: number | null;
}

// Stable per-venue keys, shared with the borrow list so a row can look up its
// own stats. Kept here so the key format lives in one place.
export function jupiterMarketKey(vaultId: number): string {
  return `jup-${vaultId}`;
}
export function kaminoMarketKey(reserve: string): string {
  return `kamino-${reserve}`;
}

// Fetches live rate/size for every borrow market once on mount. Jupiter vaults
// are read per-vault; Kamino comes from one reserves-metrics call. Both fail
// soft — a market with no stat simply renders a dash.
export function useBorrowMarketStats(): {
  stats: Map<string, MarketStat>;
  loading: boolean;
} {
  const [stats, setStats] = useState<Map<string, MarketStat>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const next = new Map<string, MarketStat>();

      // Jupiter Lend vaults — one call each, in parallel.
      await Promise.all(
        XSTOCK_BORROW_VAULTS.map(async (v) => {
          try {
            const live = await fetchLiveVaultStateViaProxy(v.vaultId);
            next.set(jupiterMarketKey(v.vaultId), {
              borrowAprPct: live.borrowRateAnnual * 100,
              sizeUsd: live.totalSuppliedUsd,
            });
          } catch {
            next.set(jupiterMarketKey(v.vaultId), {
              borrowAprPct: null,
              sizeUsd: null,
            });
          }
        }),
      );

      // Kamino — single metrics call for the whole xStocks Market. The rate the
      // user pays is the USDC reserve's borrow APY (they borrow USDC against the
      // stock), so every Kamino market shares that one rate; per-market size is
      // the collateral reserve's own total supply. Keyed per reserve so all
      // Kamino markets appear alongside Jupiter's, including the four stocks that
      // exist on both venues (the user compares the two side by side).
      try {
        const res = await fetch("/api/kamino/reserves/metrics", {
          cache: "no-store",
        });
        if (res.ok) {
          const { reserves } = (await res.json()) as {
            reserves: KaminoReserveMetric[];
          };
          const byReserve = new Map(reserves.map((r) => [r.reserve, r]));
          const usdc = byReserve.get(KAMINO_USDC_BORROW.reserve);
          const usdcAprPct = usdc ? usdc.borrowApy * 100 : null;
          for (const c of KAMINO_XSTOCK_COLLATERALS) {
            const m = byReserve.get(c.reserve);
            next.set(kaminoMarketKey(c.reserve), {
              borrowAprPct: usdcAprPct,
              sizeUsd: m ? m.totalSupplyUsd : null,
            });
          }
        }
      } catch {
        // Leave Kamino markets without stats; they render a dash.
      }

      if (!cancelled) {
        setStats(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { stats, loading };
}

// Compact USD formatter for market-size display: $4.5M, $793K, $1.2K.
export function formatUsdCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
