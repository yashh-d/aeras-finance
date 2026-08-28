"use client";

// xStock collateral the wallet has posted in Jupiter borrow vaults.
//
// This exists because of what a borrow-funded hedge does to the hedge tab.
// Depositing the stock as collateral removes it from the wallet, and a hedge
// list built from wallet balances then reports "nothing to hedge" at the exact
// moment the user is most exposed: stock in the vault, debt open, short not yet
// placed. Collateral is still price exposure. This hook reads it so the hedge
// surface can keep showing it.
//
// Jupiter vaults only, matching the venue the one-click executor is wired to.
// Kamino collateral joins when that executor does.

import { useCallback, useEffect, useState } from "react";

import {
  fetchPositionState,
  fromAtomicBN,
  readStoredNftId,
  XSTOCK_BORROW_VAULTS,
} from "@/lib/jupiter/borrow";
import { getConnection } from "@/lib/solana/balances";

export interface VaultCollateral {
  // Base units of the collateral mint, as a decimal string.
  atomic: string;
  amountUi: number;
}

export interface UseVaultCollateral {
  // Keyed by collateral mint. A mint with no position is absent, not zero.
  byMint: Record<string, VaultCollateral>;
  refresh: () => void;
  // Merge a deposit that JUST happened, synchronously, before any chain read
  // can see it. The one-click hedge calls this the moment its borrow lands:
  // the wallet balance poll will zero the holding within ten seconds, and if
  // the vault side is not visible by then the row filters out of the hedge
  // list and unmounts the very component running the flow. An optimistic entry
  // has no race; the next refresh() replaces it with the on-chain truth.
  noteDeposit: (mint: string, atomic: string, decimals: number) => void;
}

// Rendered for the no-wallet case instead of a setState in the effect, which
// the lint config forbids and which would be a wasted render anyway.
const NO_COLLATERAL: Record<string, VaultCollateral> = {};

export function useVaultCollateral(
  walletAddress: string | undefined,
): UseVaultCollateral {
  const [byMint, setByMint] = useState<Record<string, VaultCollateral>>(
    NO_COLLATERAL,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    (async () => {
      const connection = getConnection();
      const out: Record<string, VaultCollateral> = {};

      await Promise.all(
        XSTOCK_BORROW_VAULTS.map(async (vault) => {
          try {
            // Stored bindings only, deliberately no on-chain NFT scan. The
            // scan (findExistingNftId) walks the wallet's token accounts per
            // vault, and running it for four vaults on every Hedge mount was a
            // meaningful share of an RPC 429 storm on a rate-limited key. The
            // stored id covers every position this app opened; a position from
            // a cleared browser reappears the first time the Borrow tab reads
            // it, because that tab persists the binding it discovers.
            const storedId = readStoredNftId(walletAddress, vault.vaultId);
            const position =
              storedId != null
                ? await fetchPositionState(vault, storedId, connection)
                : null;
            if (position && !position.collateralAtomic.isZero()) {
              out[vault.collateralMint] = {
                atomic: position.collateralAtomic.toString(),
                amountUi: fromAtomicBN(
                  position.collateralAtomic,
                  vault.collateralDecimals,
                ),
              };
            }
          } catch (err) {
            // A failed read hides that vault's collateral for one refresh
            // cycle. Logged and tolerated: guessing a balance would be worse.
            console.error("[vault collateral]", vault.vaultId, err);
          }
        }),
      );

      if (!cancelled) setByMint(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, tick]);

  const noteDeposit = useCallback(
    (mint: string, atomic: string, decimals: number) => {
      setByMint((prev) => {
        const existing = BigInt(prev[mint]?.atomic ?? "0");
        const total = existing + BigInt(atomic);
        return {
          ...prev,
          [mint]: {
            atomic: total.toString(),
            amountUi: Number(total) / 10 ** decimals,
          },
        };
      });
    },
    [],
  );

  return {
    // Stale collateral from a previous wallet must not leak into a new one.
    byMint: walletAddress ? byMint : NO_COLLATERAL,
    refresh: useCallback(() => setTick((n) => n + 1), []),
    noteDeposit,
  };
}
