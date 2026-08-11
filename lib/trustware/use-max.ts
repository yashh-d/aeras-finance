"use client";

// The deposit field's ceiling, priced rather than assumed.
//
// Holdings summed at par are not depositable at par: converting a source token
// costs fees, so the collateral it becomes is smaller than the balance it came
// from. Filling Max with the par sum produced a number the planner then refused
// to fund, which read as a broken button. This quotes every source at its full
// balance and reports what would actually arrive.
//
// It depends on balances, not on what the user has typed, so it runs once per
// card rather than on every keystroke.

import { useEffect, useMemo, useRef, useState } from "react";

import type { XStockBorrowVault } from "@/lib/jupiter/borrow";
import type { HeldEquivalent } from "./planner";
import { quoteMaxDepositable, type MaxDepositable } from "./unified";

export interface MaxDepositableState {
  // Null until the quotes land, or when there is nothing to convert.
  max: MaxDepositable | null;
  loading: boolean;
}

export function useMaxDepositable(args: {
  vault: XStockBorrowVault;
  solanaAddress: string;
  evmAddress: string | undefined;
  solanaCollateralAtomic: string;
  heldEquivalents: HeldEquivalent[];
}): MaxDepositableState {
  const {
    vault,
    solanaAddress,
    evmAddress,
    solanaCollateralAtomic,
    heldEquivalents,
  } = args;

  const [state, setState] = useState<MaxDepositableState>({
    max: null,
    loading: false,
  });

  const heldKey = useMemo(
    () =>
      heldEquivalents
        .map((h) => `${h.source.chain}:${h.source.token}:${h.balanceAtomic}`)
        .join("|"),
    [heldEquivalents],
  );

  const generationRef = useRef(0);
  const active = heldEquivalents.length > 0;

  useEffect(() => {
    if (!active) return;
    const generation = ++generationRef.current;

    (async () => {
      try {
        const max = await quoteMaxDepositable({
          vault,
          solanaAddress,
          evmAddress,
          solanaCollateralAtomic,
          heldEquivalents,
        });
        if (generationRef.current !== generation) return;
        setState({ max, loading: false });
      } catch (err) {
        // Never fatal. The caller falls back to the par sum, and the planner
        // still refuses anything it cannot fund.
        console.error("[max depositable]", err);
        if (generationRef.current !== generation) return;
        setState({ max: null, loading: false });
      }
    })();
    // heldKey stands in for heldEquivalents; vault is stable per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, solanaAddress, evmAddress, solanaCollateralAtomic, heldKey, vault.vaultId]);

  return {
    max: active ? state.max : null,
    loading: active && state.max === null,
  };
}
