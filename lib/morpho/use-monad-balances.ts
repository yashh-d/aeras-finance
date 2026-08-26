"use client";

// The embedded EVM wallet's Monad balances (USDC and native MON), for the
// wallet panel. Reads through /api/morpho/position, the same server route the
// earn card uses, so no Monad RPC is ever called from the client.

import { useCallback, useEffect, useState } from "react";

import { fetchMorphoPositions } from "./client";

// Matches the Solana balance poll: slow, because actions that change these
// balances trigger explicit refreshes.
const POLL_MS = 60_000;

export interface MonadBalances {
  // 6-decimal atomic.
  usdcAtomic: string;
  // 18-decimal atomic.
  monAtomic: string;
  usdcUi: number;
  monUi: number;
}

export function useMonadBalances(evmAddress: string | undefined): {
  balances: MonadBalances | null;
  refresh: () => Promise<void>;
} {
  const [balances, setBalances] = useState<MonadBalances | null>(null);

  const refresh = useCallback(async () => {
    if (!evmAddress) return;
    try {
      const { usdcBalanceAtomic, monBalanceAtomic } =
        await fetchMorphoPositions(evmAddress);
      setBalances({
        usdcAtomic: usdcBalanceAtomic,
        monAtomic: monBalanceAtomic,
        usdcUi: Number(usdcBalanceAtomic) / 1e6,
        monUi: Number(monBalanceAtomic) / 1e18,
      });
    } catch (err) {
      // Keep the last good snapshot through a transient read failure.
      console.error("[useMonadBalances]", err);
    }
  }, [evmAddress]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cancelled) await refresh();
    }
    load();
    if (!evmAddress) {
      return () => {
        cancelled = true;
      };
    }
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refresh, evmAddress]);

  return { balances, refresh };
}
