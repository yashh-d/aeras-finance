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
import { fetchGliderStrategy } from "@/lib/glider/client";
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
import { fetchUniswapPools } from "@/lib/uniswap/client";
import { isDepositable, UNISWAP_CHAINS, UNISWAP_POOLS, type UniswapPool } from "@/lib/uniswap/pools";

export type EarnVenue = "morpho" | "jupiter" | "kamino" | "shmonad" | "glider" | "uniswap";

export interface UsdcEarnOption {
  venue: EarnVenue;
  label: string;
  // Decimal.
  apy: number;
  // Set for Kamino, where the deposit needs the vault record.
  kaminoVault?: KaminoVaultMeta;
  // Set for Morpho on Monad.
  morphoVault?: MorphoVault;
  // Set for Bitwise Mag7X on Glider. Not a stable deposit: the borrowed USDC
  // becomes equal-weight exposure to eight tokenized stocks on Base, and
  // `apy` is the boost campaign paid in dollars on top of what the stocks
  // do. The ticket says so beside the figure.
  glider?: { boostApr: number; campaignId: string };
  // Set for a Uniswap liquidity pool. The borrowed USDC becomes both sides
  // of the pair, so the position is two assets and a fee rate, not a
  // deposit. See lib/uniswap/pools.ts.
  uniswapPool?: UniswapPool;
  // True for shMON staking: the borrowed USDC becomes MON, so the earn side
  // does not hold its dollar value and earnNetApy's spread is not a hedge.
  // Never the default, and the ticket says so when it is picked.
  monDenominated?: boolean;
  // True for a liquidity pool: the position is rebalanced by the market as
  // the price moves, so it can be worth less than the deposit even when the
  // fees are positive. Never the default, and the ticket says so.
  impermanentLoss?: boolean;
  // The instant exit fee at the venue, decimal, for the ticket's warning.
  exitFee?: number;
}

// The pools a strategy may deposit into: the ones both sides can be obtained
// for. A pool with a token nothing can route to (GLD on Robinhood Chain) is
// listed on the venue's own card for its figures and is not offered here.
export function strategyUniswapPools(): UniswapPool[] {
  return UNISWAP_POOLS.filter(isDepositable);
}

// One earn option per depositable pool, priced at its fee APR. The rate is
// the pool's trading fees alone: no reward program is counted, and the
// impermanent loss the position takes to earn it is not netted off, which
// is why the ticket states it rather than folding it into the number.
export function uniswapOption(pool: UniswapPool, feeApr: number): UsdcEarnOption {
  return {
    venue: "uniswap",
    label: `${pool.label} on ${UNISWAP_CHAINS[pool.chainId].label}`,
    apy: feeApr,
    uniswapPool: pool,
    impermanentLoss: true,
  };
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
  // Every venue, so the ticket can offer the others. One entry per venue:
  // the Uniswap entry is the best-paying depositable pool, and the rest of
  // them are in `uniswapOptions`.
  earnOptions: UsdcEarnOption[];
  // Every depositable Uniswap pool priced, best fee APR first, so a surface
  // can offer the pool as well as the venue.
  uniswapOptions: UsdcEarnOption[];
  loading: boolean;
}

// Where borrowed USDC goes by default: the base case when its rate is known,
// else the best of the USDC venues. A MON-denominated option never leads: its
// rate is in MON terms, and the strip figure would read as a USDC spread it
// is not. Nor does a liquidity pool, for the same reason one step further on:
// its position is two assets the market rebalances, so its fee rate is not a
// spread against the loan either. Pure, and pinned by rates.test.ts.
export function pickDefaultEarn(options: UsdcEarnOption[]): UsdcEarnOption | null {
  const usdc = options.filter((o) => !o.monDenominated && !o.impermanentLoss);
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
  const [uniswapOptions, setUniswapOptions] = useState<UsdcEarnOption[]>([]);
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
          // Uniswap liquidity pools. Every depositable pool is priced at its
          // own fee APR and kept in `uniswapOptions`; the best-paying one
          // also stands as the venue's entry in `earnOptions`, since those
          // are keyed by venue. A pool with no measured volume has no rate
          // and is dropped rather than shown as zero.
          try {
            const payload = await fetchUniswapPools();
            const byId = new Map(
              payload.pools.map((m) => [`${m.chainId}:${m.id.toLowerCase()}`, m]),
            );
            const priced = strategyUniswapPools()
              .map((pool) => {
                const m = byId.get(`${pool.chainId}:${pool.id.toLowerCase()}`);
                const apr = m?.feeApr7d ?? m?.feeApr24h ?? null;
                return apr != null && apr > 0 ? uniswapOption(pool, apr) : null;
              })
              .filter((o): o is UsdcEarnOption => o != null)
              .sort((a, b) => b.apy - a.apy);
            if (cancelled || priced.length === 0) return;
            setUniswapOptions(priced);
            options.push(priced[0]);
          } catch {}
        })(),
        (async () => {
          // Bitwise Mag7X on Glider, offered only while its boost campaign is
          // live: without the boost there is no rate to put on a tile, and
          // equity exposure with no stated return is not an "earn" option.
          try {
            const s = await fetchGliderStrategy();
            if (s.boost && s.boost.apr > 0) {
              options.push({
                venue: "glider",
                label: `${s.name} on Base`,
                apy: s.boost.apr,
                glider: { boostApr: s.boost.apr, campaignId: s.boost.campaignId },
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
    uniswapOptions,
    loading: loading || statsLoading,
  };
}
