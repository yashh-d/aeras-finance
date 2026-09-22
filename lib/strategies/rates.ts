"use client";

// Live inputs for the strategy tiles: what each collateral asset costs to
// borrow against, what borrowed USDC can earn, and what the venue pays on the
// collateral itself. One fetch on mount for every asset, joined per mint, so
// the Strategies page can render a whole table without a request per row.
//
// Borrow rates and liquidity come from useBorrowMarketStats, the same hook the
// Borrow tab reads, so the two tabs cannot disagree. Earn rates come from the
// same proxies the Earn tab reads.
//
// The base case for the borrowed USDC is the Hyperithm USDC Apex vault, Morpho
// on Monad, funded through the same Trustware path the Earn tab uses. Jupiter
// Lend Earn and Kamino's USDC vault stay as alternatives that settle on Solana.

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
import { fetchMorphoMetrics } from "@/lib/morpho/client";
import { MONAD_USDC_VAULTS, type MorphoVault } from "@/lib/morpho/vaults";
import { fetchShmonMetrics } from "@/lib/shmonad/client";

export type EarnVenue = "morpho" | "jupiter" | "kamino" | "shmonad";

export interface UsdcEarnOption {
  venue: EarnVenue;
  label: string;
  // Decimal.
  apy: number;
  // Set for Kamino, where the deposit needs the vault record.
  kaminoVault?: KaminoVaultMeta;
  // Set for Morpho on Monad.
  morphoVault?: MorphoVault;
  // True for shMON staking: the borrowed USDC becomes MON, so the earn side
  // does not hold its dollar value and earnNetApy's spread is not a hedge.
  // Never the default, and the ticket says so when it is picked.
  monDenominated?: boolean;
  // The instant exit fee at the venue, decimal, for the ticket's warning.
  exitFee?: number;
}

// The base-case vault. Curated by Hyperithm; the largest of the Monad USDC
// vaults in lib/morpho/vaults.ts.
export const BASE_CASE_VAULT: MorphoVault =
  MONAD_USDC_VAULTS.find((v) => v.curator === "Hyperithm") ?? MONAD_USDC_VAULTS[0];

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
  // Where borrowed USDC goes by default: the Hyperithm vault on Monad when its
  // rate is known, else the best of the Solana venues. Null while loading.
  defaultEarn: UsdcEarnOption | null;
  // Every venue, so the ticket can offer the others.
  earnOptions: UsdcEarnOption[];
  loading: boolean;
}

// Where borrowed USDC goes by default: the base case when its rate is known,
// else the best of the USDC venues. A MON-denominated option never leads: its
// rate is in MON terms, and the strip figure would read as a USDC spread it
// is not. Pure, and pinned by rates.test.ts.
export function pickDefaultEarn(options: UsdcEarnOption[]): UsdcEarnOption | null {
  const usdc = options.filter((o) => !o.monDenominated);
  if (usdc.length === 0) return null;
  return (
    usdc.find((o) => o.venue === "morpho") ??
    usdc.reduce((best, o) => (o.apy > best.apy ? o : best))
  );
}

function statFor(route: BorrowRoute, stats: Map<string, MarketStat>) {
  if (route.vault) return stats.get(jupiterMarketKey(route.vault.vaultId));
  if (route.reserve) return stats.get(kaminoMarketKey(route.reserve.reserve));
  return undefined;
}

// `enabled` false skips every read and leaves the rates empty. The asset
// surfaces pass it for an asset with no borrow route, which has nothing to
// show and should not cost a read of every market.
export function useStrategyRates(enabled = true): StrategyRatesState {
  const { stats, loading: statsLoading } = useBorrowMarketStats(enabled);
  const [earnOptions, setEarnOptions] = useState<UsdcEarnOption[]>([]);
  const [supplyApyByReserve, setSupplyApyByReserve] = useState<
    Map<string, number>
  >(new Map());
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const options: UsdcEarnOption[] = [];
      // Each source fails soft on its own. A venue that is down drops out of
      // the comparison rather than blanking the page.
      await Promise.all([
        (async () => {
          try {
            const metrics = await fetchMorphoMetrics();
            const m = metrics.get(BASE_CASE_VAULT.address.toLowerCase());
            if (m?.netApy != null) {
              options.push({
                venue: "morpho",
                label: `${BASE_CASE_VAULT.name} on Monad`,
                apy: m.netApy,
                morphoVault: BASE_CASE_VAULT,
              });
            }
          } catch {}
        })(),
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
            const m = await fetchShmonMetrics();
            if (m.apy != null) {
              options.push({
                venue: "shmonad",
                label: "shMON staking on Monad",
                apy: m.apy,
                monDenominated: true,
                exitFee: m.feeRate,
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
  }, [enabled]);

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

  const defaultEarn = useMemo(() => pickDefaultEarn(earnOptions), [earnOptions]);

  return {
    rows,
    defaultEarn,
    earnOptions,
    loading: loading || statsLoading,
  };
}
