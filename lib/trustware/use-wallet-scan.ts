"use client";

// One cross-chain scan for the whole app.
//
// The borrow surface already scanned for convertible equity holdings; the
// wallet needs the same data plus the native balances that pay for gas. Running
// it once here and sharing the result keeps it to a single upstream call
// instead of one per surface.
//
// Never fatal: a failed scan reports empty holdings and an error alongside
// them, because the Solana side of the wallet is unaffected by it.

import { useCallback, useEffect, useMemo, useState } from "react";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import type { EquivalentBalances } from "./balances";
import type { NativeHolding } from "./native";

export interface WalletScan extends EquivalentBalances {
  native: NativeHolding[];
  nativePrices: Record<string, number>;
  loading: boolean;
  error: string | null;
  evmAddress: string | undefined;
  refresh: () => void;
}

const EMPTY = { held: [], unreadableChains: [], native: [] };

// Slower than the Solana balance poll. One scan sweeps every chain Trustware
// can see, so it is a far heavier call than reading a few token accounts, and
// cross-chain holdings change only when the user moves them. Actions that do
// move them call refresh() directly rather than waiting for this.
const POLL_MS = 90_000;

export function useWalletScan(solanaAddress: string | undefined): WalletScan {
  const { address: evmAddress } = useEmbeddedEvmWallet();
  const [data, setData] = useState<{
    key: string;
    scan: EquivalentBalances & { native: NativeHolding[] };
    prices: Record<string, number>;
    error: string | null;
  } | null>(null);
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  // Two keys on purpose. `key` includes the generation so a refresh re-runs the
  // effect; `addressKey` does not, so a refresh keeps the previous holdings on
  // screen while the new scan is in flight instead of blanking the rows every
  // time it polls. Data is still discarded when the wallet itself changes.
  const addressKey = useMemo(
    () =>
      solanaAddress || evmAddress
        ? `${solanaAddress ?? ""}|${evmAddress ?? ""}`
        : "",
    [solanaAddress, evmAddress],
  );
  const key = addressKey ? `${addressKey}|${generation}` : "";

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    (async () => {
      const params = new URLSearchParams();
      if (solanaAddress) params.set("solana", solanaAddress);
      if (evmAddress) params.set("evm", evmAddress);

      // Prices are a nice-to-have. Fetching them alongside the scan means one
      // render rather than two, and a price failure never blocks the balances.
      const [scanRes, priceRes] = await Promise.allSettled([
        fetch(`/api/trustware/balances?${params}`, { cache: "no-store" }),
        fetch("/api/prices/native", { cache: "no-store" }),
      ]);

      let scan = EMPTY as EquivalentBalances & { native: NativeHolding[] };
      let error: string | null = null;
      if (scanRes.status === "fulfilled") {
        const body = await scanRes.value.json();
        if (scanRes.value.ok) {
          scan = { ...EMPTY, ...body };
        } else {
          error = body?.error ?? `Balance scan failed: ${scanRes.value.status}`;
        }
      } else {
        error = String(scanRes.reason);
      }

      let prices: Record<string, number> = {};
      if (priceRes.status === "fulfilled" && priceRes.value.ok) {
        prices = await priceRes.value.json();
      }

      if (!cancelled) setData({ key: addressKey, scan, prices, error });
    })();

    const id = setInterval(() => {
      if (!cancelled) setGeneration((n) => n + 1);
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, addressKey, solanaAddress, evmAddress]);

  const current = data?.key === addressKey ? data : null;

  return {
    held: current?.scan.held ?? [],
    unreadableChains: current?.scan.unreadableChains ?? [],
    native: current?.scan.native ?? [],
    nativePrices: current?.prices ?? {},
    loading: Boolean(addressKey) && current === null,
    error: current?.error ?? null,
    evmAddress,
    refresh,
  };
}
