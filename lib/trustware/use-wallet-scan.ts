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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import type { EquivalentBalances } from "./balances";
import type { NativeHolding } from "./native";
import type { StableHolding } from "./stables";
import type { OndoWalletHolding } from "./ondo-holdings";
import type { GoldHolding } from "./gold-holdings";
import {
  carryUnreadableChains,
  describeUnreadableChains,
  type ScanRows,
} from "./scan-merge";

export interface WalletScan extends EquivalentBalances {
  native: NativeHolding[];
  // USDC held off Solana. Lighter margin is USDC only, so the hedge surface
  // reads this to tell "you have no money" apart from "your money is elsewhere".
  stables: StableHolding[];
  // Ondo collateral tokens withdrawn to the user's Ethereum wallet. Kept apart
  // from `held` because those are convertible equivalents keyed to borrow
  // vaults, and most Ondo collateral has none. See lib/trustware/ondo-holdings.
  ondo: OndoWalletHolding[];
  // Gold the user holds anywhere, for the Morpho gold market's funding picker.
  // Overlaps `ondo` on purpose: GLDon on Ethereum is both a withdrawn margin
  // token and usable gold collateral. A wallet total must read `ondo` and a
  // funding picker `gold`, never both, or the holding is counted twice.
  gold: GoldHolding[];
  nativePrices: Record<string, number>;
  loading: boolean;
  error: string | null;
  evmAddress: string | undefined;
  refresh: () => void;
}

const EMPTY: ScanRows = {
  held: [],
  unreadableChains: [],
  native: [],
  stables: [],
  ondo: [],
  gold: [],
};

// Slower than the Solana balance poll. One scan sweeps every chain Trustware
// can see, so it is a far heavier call than reading a few token accounts, and
// cross-chain holdings change only when the user moves them. Actions that do
// move them call refresh() directly rather than waiting for this.
const POLL_MS = 90_000;

export function useWalletScan(solanaAddress: string | undefined): WalletScan {
  const { address: evmAddress } = useEmbeddedEvmWallet();
  const [data, setData] = useState<{
    key: string;
    scan: ScanRows;
    prices: Record<string, number>;
    error: string | null;
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  // Survives the effect re-running, which state in the `data` object does not:
  // that is replaced wholesale on every poll.
  const pricesRef = useRef<Record<string, number>>({});
  // The last rows shown for this pair of addresses, so a poll that could not
  // read a chain keeps that chain's rows instead of blanking them. See
  // lib/trustware/scan-merge.ts for why.
  const lastRowsRef = useRef<{ key: string; rows: ScanRows } | null>(null);

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

      const previous =
        lastRowsRef.current?.key === addressKey ? lastRowsRef.current.rows : null;
      let scan: ScanRows = EMPTY;
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

      // A chain the scan could not read keeps the rows it had, and the panel
      // is told. A request that failed outright keeps everything: the money
      // did not move because a read did not land.
      if (error) {
        if (previous) scan = previous;
      } else {
        scan = carryUnreadableChains(previous, scan);
        error = describeUnreadableChains(scan.unreadableChains);
      }
      lastRowsRef.current = { key: addressKey, rows: scan };

      // Carry the last good prices forward on a failure. Losing them does not
      // merely blank a dollar figure: every total drops an unpriced native
      // holding entirely, so a throttled minute at Coingecko took ETH and MON
      // out of the wallet list and the net worth and then put them back. The
      // route serves stale prices for the same reason; this covers the case
      // where the request itself never lands.
      let prices = pricesRef.current;
      if (priceRes.status === "fulfilled" && priceRes.value.ok) {
        const body = (await priceRes.value.json()) as Record<string, number>;
        if (Object.keys(body).length > 0) {
          prices = body;
          pricesRef.current = body;
        }
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
    stables: current?.scan.stables ?? [],
    ondo: current?.scan.ondo ?? [],
    gold: current?.scan.gold ?? [],
    nativePrices: current?.prices ?? {},
    loading: Boolean(addressKey) && current === null,
    error: current?.error ?? null,
    evmAddress,
    refresh,
  };
}
