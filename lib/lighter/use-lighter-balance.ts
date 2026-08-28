"use client";

// The Lighter perps account's value in USD, for the wallet panel and the
// header total. Margin lives on Lighter's L2, outside both the Solana read and
// the Trustware scan, so it gets its own read, keyed by the embedded EVM
// wallet that owns the account.

import { useCallback, useEffect, useState } from "react";

import { fetchLighterAccountState } from "./client";

// Matches the Monad balance poll: slow, because the hedge and one-click flows
// that change this balance trigger explicit refreshes.
const POLL_MS = 60_000;

export function useLighterBalance(l1Address: string | undefined): {
  // Total account value: margin plus what open positions are worth. Null until
  // the first read lands; 0 when no account exists, which is the normal state
  // before a first deposit.
  usd: number | null;
  refresh: () => Promise<void>;
} {
  const [usd, setUsd] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!l1Address) return;
    try {
      const state = await fetchLighterAccountState(l1Address);
      if (!state.account) {
        setUsd(0);
        return;
      }
      // totalAssetValueUsd, not collateral: collateral alone misstates an
      // account with open positions, whose value moves with their PnL.
      const value = Number(
        state.detail?.totalAssetValueUsd ?? state.account.collateral,
      );
      setUsd(Number.isFinite(value) ? value : 0);
    } catch (err) {
      // Keep the last good snapshot through a transient read failure.
      console.error("[useLighterBalance]", err);
    }
  }, [l1Address]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cancelled) await refresh();
    }
    load();
    if (!l1Address) {
      return () => {
        cancelled = true;
      };
    }
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refresh, l1Address]);

  return { usd, refresh };
}
