"use client";

// Everything the hedge panel renders from, in one hook.
//
// Two reads, deliberately not merged. The catalog is public, shared by every
// user and safe to fetch before a wallet exists. The account state is per user
// and only meaningful once Privy has provisioned the embedded EVM wallet. Fusing
// them into one endpoint would make an anonymous visitor's catalog read wait on
// a wallet, and would re-fetch 227 markets every time a position changes.
//
// The join itself lives in exposure.ts and is pure. This hook only fetches,
// tracks freshness, and hands the pieces over.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import { atomicToUiString, type AccountBalances } from "@/lib/solana/balances";

import {
  fetchLighterAccountState,
  fetchLighterCatalog,
  type LighterAccountState,
} from "./client";
import {
  buildHedgeViews,
  hedgeTotals,
  type HedgeTotals,
  type HedgeView,
} from "./exposure";
import { resolveOnboarding, type LighterOnboarding } from "./onboarding";
import type { LighterMarket } from "./types";

export interface UseHedge {
  views: HedgeView[];
  totals: HedgeTotals;
  onboarding: LighterOnboarding;
  state: LighterAccountState | null;
  catalog: LighterMarket[];
  // True only on the first load. A background refresh must not blank the panel
  // out from under someone reading it.
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useHedge(params: {
  l1Address: string | undefined;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  // xStocks the wallet has posted as borrow collateral, keyed by mint, in base
  // units. Merged into the hedgeable holdings because vault collateral is still
  // price exposure: a borrow-funded hedge moves the stock into a vault, and a
  // list keyed to the wallet alone would drop the row at the moment the short
  // still needs placing.
  vaultCollateralAtomic?: Record<string, string>;
}): UseHedge {
  const { l1Address, balances, prices, vaultCollateralAtomic } = params;

  const [catalog, setCatalog] = useState<LighterMarket[]>([]);
  const [state, setState] = useState<LighterAccountState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived rather than stored. Nothing has arrived yet exactly when there is no
  // catalog, no account state and no error to explain their absence, so a
  // separate loading flag would only be a second copy of that fact that can
  // disagree with it.
  const loading = catalog.length === 0 && state === null && error === null;

  const load = useCallback(async () => {
    try {
      const [catalogResult, accountResult] = await Promise.all([
        fetchLighterCatalog(),
        l1Address ? fetchLighterAccountState(l1Address) : Promise.resolve(null),
      ]);
      setCatalog(catalogResult.markets);
      setState(accountResult);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [l1Address]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // Atomic amounts rather than the float field on AccountBalances. An xStock
  // carries 8 decimals and the float can round up in the last place, which is
  // enough to size an order against a balance the wallet does not have.
  //
  // Total exposure is wallet plus vault collateral, summed in base units so the
  // two cannot disagree on rounding. walletQuantity carries the wallet part
  // separately, because a new borrow can only post what the wallet holds.
  const holdings = useMemo(() => {
    if (!balances) return [];
    return XSTOCKS.map((x) => {
      const wallet = BigInt(balances.xstocksAtomic[x.mint] ?? "0");
      const vault = BigInt(vaultCollateralAtomic?.[x.mint] ?? "0");
      return {
        xstockSymbol: x.symbol,
        mint: x.mint,
        quantity: atomicToUiString((wallet + vault).toString(), x.decimals),
        walletQuantity: atomicToUiString(wallet.toString(), x.decimals),
      };
    }).filter((h) => Number(h.quantity) > 0);
  }, [balances, vaultCollateralAtomic]);

  const priceUsdByMint = useMemo(() => {
    const map: Record<string, number | undefined> = {};
    for (const x of XSTOCKS) map[x.mint] = prices?.[x.mint]?.usdPrice;
    return map;
  }, [prices]);

  const views = useMemo(
    () =>
      buildHedgeViews({
        holdings,
        priceUsdByMint,
        catalog,
        positions: state?.detail?.positions ?? [],
      }),
    [holdings, priceUsdByMint, catalog, state],
  );

  const onboarding = useMemo(
    () => resolveOnboarding(l1Address, state),
    [l1Address, state],
  );

  return {
    views,
    totals: useMemo(() => hedgeTotals(views), [views]),
    onboarding,
    state,
    catalog,
    loading,
    refreshing,
    error,
    refresh,
  };
}
