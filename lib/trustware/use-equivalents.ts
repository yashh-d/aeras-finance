"use client";

// Convertible holdings across the user's Solana and EVM addresses.
//
// This is a cross-chain scan, so it runs once for the whole borrow section
// rather than once per vault card. Callers filter the result by vault.
//
// A failure here is never fatal: the user may still hold the collateral on
// Solana directly, and that path does not need Trustware at all. So the error is
// carried alongside the (empty) holdings instead of replacing them.

import { useCallback, useEffect, useMemo, useState } from "react";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import {
  fetchEquivalentBalancesViaProxy,
  type EquivalentBalancesPayload,
} from "./client";

export interface EquivalentBalancesState extends EquivalentBalancesPayload {
  loading: boolean;
  // Set when the scan itself failed, as opposed to individual chains being
  // unreadable (which is what unreadableChains carries).
  error: string | null;
  evmAddress: string | undefined;
  refresh: () => void;
}

const EMPTY: EquivalentBalancesPayload = {
  held: [],
  unreadableChains: [],
  gold: [],
};

interface ScanResult {
  // Which address pair (and refresh generation) this result belongs to. Results
  // for a stale key are ignored rather than shown against the wrong wallet.
  key: string;
  balances: EquivalentBalancesPayload;
  error: string | null;
}

export function useEquivalentBalances(
  solanaAddress: string | undefined,
): EquivalentBalancesState {
  const { address: evmAddress } = useEmbeddedEvmWallet();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  // Empty when there is no wallet to scan, which doubles as the "nothing to do"
  // signal for the effect below.
  const key = useMemo(
    () =>
      solanaAddress || evmAddress
        ? `${solanaAddress ?? ""}|${evmAddress ?? ""}|${generation}`
        : "",
    [solanaAddress, evmAddress, generation],
  );

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      try {
        const balances = await fetchEquivalentBalancesViaProxy({
          solanaAddress,
          evmAddress,
        });
        if (!cancelled) setResult({ key, balances, error: null });
      } catch (err) {
        console.error("[trustware equivalents]", err);
        if (!cancelled) {
          setResult({
            key,
            balances: EMPTY,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, solanaAddress, evmAddress]);

  // Both loading and the exposed holdings are derived from whether the result in
  // hand matches the address pair being asked about. That keeps this to a single
  // state write per scan, and means a wallet change reports "loading" rather
  // than briefly showing the previous wallet's holdings.
  const current = result?.key === key ? result : null;

  return {
    ...(current?.balances ?? EMPTY),
    loading: Boolean(key) && current === null,
    error: current?.error ?? null,
    evmAddress,
    refresh,
  };
}
