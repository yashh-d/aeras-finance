"use client";

// Everything the Lighter side of the perps tab renders from.
//
// useHedge answers "how much of what I hold is offset", so it joins the catalog
// to the wallet's xStock balances. This one answers "what can I trade, and what
// am I in", over a different set: every tradeable market rather than the ten an
// xStock routes to, and positions on their own terms rather than against a
// holding. Nothing here reads balances, because a perps position does not need
// one to exist.
//
// The two reads stay separate for the same reason they do in useHedge. The
// catalog is public and shared by every user; the account state is per user and
// only meaningful once Privy has provisioned the embedded EVM wallet. Both go
// through lib/lighter/client.ts, whose cache and in-flight coalescing mean this
// hook and the hedge tab open in the same session cost one request between
// them rather than two.

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchLighterAccountState, fetchLighterCatalog } from "./client";
import type { LighterAccountState } from "./client";
import { tradeableMarkets } from "./markets";
import { resolveOnboarding, type LighterOnboarding } from "./onboarding";
import type { LighterMarket, LighterPosition } from "./types";

export interface UseLighterPerps {
  // Tradeable only. An inactive market resolves by name and rejects every
  // order, so it is filtered out rather than shown and refused.
  markets: LighterMarket[];
  positions: LighterPosition[];
  state: LighterAccountState | null;
  onboarding: LighterOnboarding;
  // Total margin posted, whether or not a position is using it.
  collateralUsd: number;
  // Free to open with, after what open positions already reserve. This is the
  // figure a new order has to fit inside, not collateralUsd.
  availableMarginUsd: number;
  // Margin plus what open positions are currently worth.
  accountValueUsd: number;
  // True only on the first load. A background refresh must not blank the panel
  // out from under someone reading it.
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // The market a position is on, for closing it. A position carries its symbol
  // but not the decimals or the mark an order needs.
  marketFor: (position: LighterPosition) => LighterMarket | undefined;
}

export function useLighterPerps(params: {
  l1Address: string | undefined;
  // False while another venue is selected, so the tab does not poll a catalog
  // nobody is looking at.
  enabled?: boolean;
}): UseLighterPerps {
  const { l1Address } = params;
  const enabled = params.enabled ?? true;

  // The unfiltered catalog. Positions are resolved against this rather than
  // against the tradeable list, because a market can be halted while a user is
  // still in it and they must be able to see and close that position.
  const [catalog, setCatalog] = useState<LighterMarket[]>([]);
  const [state, setState] = useState<LighterAccountState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading =
    enabled && catalog.length === 0 && state === null && error === null;

  const load = useCallback(async () => {
    if (!enabled) return;
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
  }, [enabled, l1Address]);

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

  const markets = useMemo(() => tradeableMarkets(catalog), [catalog]);

  const byId = useMemo(() => {
    const map = new Map<number, LighterMarket>();
    for (const market of catalog) map.set(market.marketId, market);
    return map;
  }, [catalog]);

  const detail = state?.detail;

  return {
    markets,
    // Zero-size rows are dropped server side. Lighter carries a row for every
    // market an account has ever touched, so without that a closed position
    // reads as an open one at size zero.
    positions: detail?.positions ?? [],
    state,
    onboarding: useMemo(
      () => resolveOnboarding(l1Address, state),
      [l1Address, state],
    ),
    collateralUsd: Number(detail?.collateralUsd ?? "0"),
    availableMarginUsd: Number(detail?.availableBalanceUsd ?? "0"),
    accountValueUsd: Number(detail?.totalAssetValueUsd ?? "0"),
    loading,
    refreshing,
    error,
    refresh,
    marketFor: useCallback(
      (position: LighterPosition) => byId.get(position.marketId),
      [byId],
    ),
  };
}
