"use client";

// Vault deposits, for the wallet card.
//
// The Balances list already counts things that are not in the wallet: Lighter
// perps margin sits on an L2 and is a row there. Vault deposits are the same
// kind of thing, assets the account owns that have left the token account, so
// they belong in the same list and in the same total.
//
// Reads only the three vault venues, through lib/positions/earn.ts. The full
// positions model fans out to seven venues plus a borrow summary, which is the
// right cost for the Portfolio tab and the wrong one for a card that wants three
// rows. The row-building is shared with that model rather than reimplemented.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  EMPTY_EARN_SNAPSHOT,
  earnRows,
  readEarnVenues,
  type EarnSnapshot,
} from "@/lib/positions/earn";
import type { PositionRow } from "@/lib/positions/types";

export interface EarnPositionsView {
  rows: PositionRow[];
  // Summed from `rows`, never counted separately. Two independent sums of the
  // same thing is the drift lib/solana/holdings.ts keeps warning about, and the
  // wallet card's header total and the sidebar's both read this one number.
  totalUsd: number;
  // True only until the first read lands. A refresh must not blank rows out
  // from under someone reading them.
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useEarnPositions({
  walletAddress,
  evmAddress,
}: {
  walletAddress: string | undefined;
  // The embedded EVM wallet. Owns the Monad vault shares, so Morpho is silent
  // without one. Jupiter Lend and Kamino only need the Solana address.
  evmAddress: string | undefined;
}): EarnPositionsView {
  const [snapshot, setSnapshot] = useState<EarnSnapshot>(EMPTY_EARN_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);

  // Set while mounted, so a read that lands after an unmount is dropped rather
  // than written back.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await readEarnVenues(walletAddress, evmAddress);
    if (!live.current) return;
    setSnapshot(next);
    setLoaded(true);
  }, [walletAddress, evmAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = earnRows(snapshot);
  return {
    rows,
    totalUsd: rows.reduce((sum, row) => sum + row.usd, 0),
    loading: !loaded,
    refresh,
  };
}
