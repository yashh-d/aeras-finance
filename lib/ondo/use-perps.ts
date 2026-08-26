"use client";

// Everything the perps surface renders from.
//
// The hedge hook answers "how much of what I hold is offset". This one answers
// "what can I trade, and what am I in", which is a different question over a
// different set: every tradeable Ondo market rather than the ten an xStock
// routes to, and positions on their own terms rather than joined to a holding.
//
// Shares the catalog and account reads with the hedge surface but not their
// interpretation, so the two can be open in the same session without one
// deciding what the other shows.

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchOndoAccount,
  fetchOndoCatalog,
  type OndoAccountSnapshot,
} from "./client";
import type { OndoCollateral } from "./collateral";
import { liveCollateralHealth, type LiveCollateralHealth } from "./risk";
import type { OndoMarket, OndoPosition } from "./types";

export type PerpsStatus = "no-wallet" | "needs-signin" | "needs-margin" | "ready";

// Markets are grouped the way Ondo tags them, because the tags are the only
// grouping the venue itself asserts and they survive Ondo adding a market.
export interface PerpsMarketGroup {
  tag: string;
  markets: OndoMarket[];
}

export interface UsePerps {
  markets: OndoMarket[];
  groups: PerpsMarketGroup[];
  // What Ondo credits as margin, so the margin card can map a holding to the
  // token it becomes without fetching the catalog a second time.
  collateral: OndoCollateral[];
  positions: OndoPosition[];
  account: OndoAccountSnapshot | null;
  status: PerpsStatus;
  // Margin free to open a new position with, after what open positions reserve.
  availableMarginUsd: number;
  marginBalanceUsd: number;
  // Recovered from the balance because Ondo returns no LTV field. Zero on an
  // account with no tokenized collateral posted.
  health: LiveCollateralHealth | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePerps(params: {
  evmAddress: string | undefined;
  enabled?: boolean;
}): UsePerps {
  const { evmAddress } = params;
  const enabled = params.enabled ?? true;

  const [markets, setMarkets] = useState<OndoMarket[]>([]);
  const [collateral, setCollateral] = useState<OndoCollateral[]>([]);
  const [account, setAccount] = useState<OndoAccountSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = enabled && markets.length === 0 && error === null;

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const [catalog, snapshot] = await Promise.all([
        fetchOndoCatalog(),
        fetchOndoAccount(),
      ]);
      // A disabled market resolves by name and rejects every order, so it is
      // filtered out of the tradeable list rather than shown and refused.
      setMarkets(catalog.markets.filter((m) => m.tradeable));
      setCollateral(catalog.creditable);
      setAccount(snapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [enabled]);

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

  const groups = useMemo(() => {
    const byTag = new Map<string, OndoMarket[]>();
    for (const market of markets) {
      // A market with no tag still has to appear somewhere, or it silently
      // stops being tradeable from this surface.
      const tag = market.tags[0] ?? "Other";
      const list = byTag.get(tag);
      if (list) list.push(market);
      else byTag.set(tag, [market]);
    }
    return [...byTag.entries()]
      .map(([tag, list]) => ({
        tag,
        markets: [...list].sort((a, b) => a.market.localeCompare(b.market)),
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, [markets]);

  const status: PerpsStatus = useMemo(() => {
    if (!evmAddress) return "no-wallet";
    if (!account) return "needs-signin";
    return Number(account.balance.marginBalance) > 0 ? "ready" : "needs-margin";
  }, [evmAddress, account]);

  return {
    markets,
    groups,
    collateral,
    // Zero-quantity rows are filtered server side. Ondo returns a row per
    // market the account has ever touched, so without that a closed position
    // reads as an open one at size zero.
    positions: account?.positions ?? [],
    account,
    status,
    availableMarginUsd: Number(account?.balance.availableMargin ?? "0"),
    marginBalanceUsd: Number(account?.balance.marginBalance ?? "0"),
    health: account ? liveCollateralHealth(account.balance) : null,
    loading,
    refreshing,
    error,
    refresh,
  };
}
