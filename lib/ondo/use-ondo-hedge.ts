"use client";

// Everything the Ondo side of the hedge surface renders from.
//
// The sibling of lib/lighter/use-hedge.ts and split the same way, for the same
// reason: the catalog is public and shared by every user, the account snapshot
// is per user and only exists once they have signed in to Ondo. Fusing them
// would make an anonymous visitor's catalog read wait on a session.
//
// The difference from the Lighter hook is that a session here is an explicit
// act. Ondo's is a SIWE signature held in an httpOnly cookie, so this hook
// cannot tell whether one exists without asking: `fetchOndoAccount` returns null
// on a 401 rather than throwing, and null is an ordinary state meaning "has not
// signed in", not an error to surface.
//
// The join itself lives in exposure.ts and is pure.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import { atomicToUiString, type AccountBalances } from "@/lib/solana/balances";

import {
  fetchOndoAccount,
  fetchOndoCatalog,
  type OndoAccountSnapshot,
} from "./client";
import type { OndoCollateral, OndoCatalogWithCollateral } from "./collateral";
import {
  buildOndoHedgeViews,
  ondoHedgeTotals,
  type OndoHedgeTotals,
  type OndoHedgeView,
} from "./exposure";

// Where the user is in the Ondo flow, derived entirely from reads. Nothing is
// persisted, so it survives a refresh and the wait for a deposit to credit.
//
// There is deliberately no "awaiting deposit" state. Ondo cannot distinguish a
// deposit in flight from one never made: the margin balance is simply zero
// until the transfer lands. Inventing that distinction needs a local marker and
// does not belong in a hook that only reads.
export type OndoHedgeStatus =
  // No embedded EVM wallet yet, so there is nothing to sign a challenge with.
  | "no-wallet"
  // A wallet exists but no Ondo session. One signature away.
  | "needs-signin"
  // Signed in, but no margin posted, so no hedge can be opened.
  | "needs-margin"
  // Ready to trade.
  | "ready";

export interface UseOndoHedge {
  views: OndoHedgeView[];
  totals: OndoHedgeTotals;
  status: OndoHedgeStatus;
  account: OndoAccountSnapshot | null;
  collateral: OndoCollateral[];
  catalog: OndoCatalogWithCollateral | null;
  // Margin balance in USD, the figure a hedge is opened against.
  marginUsd: number;
  // True only on the first load. A background refresh must not blank the panel
  // out from under someone reading it.
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOndoHedge(params: {
  evmAddress: string | undefined;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  // False while the user is on another venue, so the panel does not hold an
  // Ondo session open or poll a catalog nobody is looking at.
  enabled?: boolean;
}): UseOndoHedge {
  const { evmAddress, balances, prices } = params;
  const enabled = params.enabled ?? true;

  const [catalog, setCatalog] = useState<OndoCatalogWithCollateral | null>(null);
  const [account, setAccount] = useState<OndoAccountSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = enabled && catalog === null && error === null;

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      // The account read is not conditional on a wallet the way Lighter's is.
      // An Ondo session is keyed by a cookie rather than by an address, so it
      // can exist before this hook knows which wallet is connected, and asking
      // is the only way to find out.
      const [catalogResult, accountResult] = await Promise.all([
        fetchOndoCatalog(),
        fetchOndoAccount(),
      ]);
      setCatalog(catalogResult);
      setAccount(accountResult);
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

  // Atomic amounts rather than the float field, for the same reason the Lighter
  // hook does it: an xStock carries 8 decimals and the float can round up in
  // the last place, which is enough to size an order against a balance the
  // wallet does not have.
  const holdings = useMemo(() => {
    if (!balances) return [];
    return XSTOCKS.map((x) => ({
      xstockSymbol: x.symbol,
      mint: x.mint,
      quantity: atomicToUiString(balances.xstocksAtomic[x.mint] ?? "0", x.decimals),
    })).filter((h) => Number(h.quantity) > 0);
  }, [balances]);

  const priceUsdByMint = useMemo(() => {
    const map: Record<string, number | undefined> = {};
    for (const x of XSTOCKS) map[x.mint] = prices?.[x.mint]?.usdPrice;
    return map;
  }, [prices]);

  // The USDC leg of the margin balance, which cushions the auto-exchange
  // trigger. walletBalance goes negative once fees and losses exceed it, and a
  // negative cushion is real, so it is not clamped to zero here.
  const usdcBalanceUsd = Number(account?.balance.walletBalance ?? "0");

  const views = useMemo(
    () =>
      buildOndoHedgeViews({
        holdings,
        priceUsdByMint,
        markets: catalog?.markets ?? [],
        positions: account?.positions ?? [],
        collateral: catalog?.creditable ?? [],
        usdcBalanceUsd,
      }),
    [holdings, priceUsdByMint, catalog, account, usdcBalanceUsd],
  );

  const status: OndoHedgeStatus = useMemo(() => {
    if (!evmAddress) return "no-wallet";
    if (!account) return "needs-signin";
    // Margin balance rather than USDC balance: collateral posted as tokenized
    // stock is margin too, and on this venue it is the expected way to fund.
    return Number(account.balance.marginBalance) > 0 ? "ready" : "needs-margin";
  }, [evmAddress, account]);

  return {
    views,
    totals: useMemo(() => ondoHedgeTotals(views), [views]),
    status,
    account,
    collateral: catalog?.creditable ?? [],
    catalog,
    marginUsd: Number(account?.balance.availableMargin ?? "0"),
    loading,
    refreshing,
    error,
    refresh,
  };
}
