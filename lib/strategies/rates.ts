"use client";

// Live inputs for the strategy tiles: what each collateral asset costs to
// borrow against, what borrowed USDC can earn, and what the venue pays on the
// collateral itself. One fetch on mount for every asset, joined per mint, so
// the Strategies page can render a whole table without a request per row.
//
// Borrow rates and liquidity come from useBorrowMarketStats, the same hook the
// Borrow tab reads, so the two tabs cannot disagree. Earn rates come from the
// same two proxies the Earn tab reads. Morpho is left out on purpose: it is
// the one EVM venue, and a strategy that settles on Solana should not need a
// Trustware hop to close.

import { useEffect, useMemo, useState } from "react";

import type { KaminoReserveMetric } from "@/app/api/kamino/reserves/metrics/route";
import { borrowRouteFor, type BorrowRoute } from "@/lib/borrow/route";
import {
  jupiterMarketKey,
  kaminoMarketKey,
  useBorrowMarketStats,
  type MarketStat,
} from "@/lib/borrow/use-market-stats";
import { USDC_MINT } from "@/lib/jupiter/constants";
import { fetchEarnVaultsViaProxy } from "@/lib/jupiter/earn";
import { XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";
import {
  fetchKaminoVaultsViaProxy,
  kaminoVaultByAsset,
  type KaminoVaultMeta,
} from "@/lib/kamino/kvaults";

export type EarnVenue = "jupiter" | "kamino";

export interface UsdcEarnOption {
  venue: EarnVenue;
  label: string;
  // Decimal.
  apy: number;
  // Set for Kamino, where the deposit needs the vault record.
  kaminoVault?: KaminoVaultMeta;
}

export interface StrategyRates {
  xstock: XStock;
  route: BorrowRoute;
  // Decimal annual USDC borrow rate at the route's venue. Null while loading.
  borrowApr: number | null;
  // USDC still drawable at the venue, the ceiling on any borrow.
  liquidityUsd: number | null;
  // Decimal rate the collateral itself earns while posted. Zero on Jupiter.
  collateralSupplyApy: number;
}

export interface StrategyRatesState {
  // Every asset with a borrow market, in catalog order.
  rows: StrategyRates[];
  // Best USDC earn venue on Solana right now, or null while loading.
  bestEarn: UsdcEarnOption | null;
  // Both options, so the ticket can say what it did not pick.
  earnOptions: UsdcEarnOption[];
  loading: boolean;
}

function statFor(route: BorrowRoute, stats: Map<string, MarketStat>) {
  if (route.vault) return stats.get(jupiterMarketKey(route.vault.vaultId));
  if (route.reserve) return stats.get(kaminoMarketKey(route.reserve.reserve));
  return undefined;
}

export function useStrategyRates(): StrategyRatesState {
  const { stats, loading: statsLoading } = useBorrowMarketStats();
  const [earnOptions, setEarnOptions] = useState<UsdcEarnOption[]>([]);
  const [supplyApyByReserve, setSupplyApyByReserve] = useState<
    Map<string, number>
  >(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const options: UsdcEarnOption[] = [];
      // Each source fails soft on its own. A venue that is down drops out of
      // the comparison rather than blanking the page.
      await Promise.all([
        (async () => {
          try {
            const vaults = await fetchEarnVaultsViaProxy();
            const usdc = vaults.find((v) => v.assetMint === USDC_MINT);
            if (usdc) {
              options.push({ venue: "jupiter", label: "Jupiter Lend", apy: usdc.apy });
            }
          } catch {}
        })(),
        (async () => {
          try {
            const meta = kaminoVaultByAsset(USDC_MINT);
            if (!meta) return;
            const vaults = await fetchKaminoVaultsViaProxy();
            const live = vaults.find((v) => v.address === meta.address);
            if (live) {
              options.push({
                venue: "kamino",
                label: `Kamino ${meta.name}`,
                apy: live.apy,
                kaminoVault: meta,
              });
            }
          } catch {}
        })(),
        (async () => {
          try {
            const res = await fetch("/api/kamino/reserves/metrics", {
              cache: "no-store",
            });
            if (!res.ok) return;
            const { reserves } = (await res.json()) as {
              reserves: KaminoReserveMetric[];
            };
            if (!cancelled) {
              setSupplyApyByReserve(
                new Map(reserves.map((r) => [r.reserve, r.supplyApy])),
              );
            }
          } catch {}
        })(),
      ]);
      if (cancelled) return;
      setEarnOptions(options);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<StrategyRates[]>(() => {
    const out: StrategyRates[] = [];
    for (const xstock of XSTOCKS) {
      const route = borrowRouteFor(xstock.mint);
      if (!route) continue;
      const stat = statFor(route, stats);
      out.push({
        xstock,
        route,
        borrowApr:
          stat?.borrowAprPct != null ? stat.borrowAprPct / 100 : null,
        liquidityUsd: stat?.liquidityUsd ?? null,
        collateralSupplyApy: route.reserve
          ? (supplyApyByReserve.get(route.reserve.reserve) ?? 0)
          : 0,
      });
    }
    return out;
  }, [stats, supplyApyByReserve]);

  const bestEarn = useMemo(() => {
    if (earnOptions.length === 0) return null;
    return earnOptions.reduce((best, o) => (o.apy > best.apy ? o : best));
  }, [earnOptions]);

  return {
    rows,
    bestEarn,
    earnOptions,
    loading: loading || statsLoading,
  };
}
