"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  fetchPositionState,
  findExistingNftId,
  fromAtomicBN,
  readStoredNftId,
  XSTOCK_BORROW_VAULTS,
  type UserPositionState,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import type { Connection } from "@solana/web3.js";
import {
  fetchKaminoPosition,
  type KaminoPosition,
} from "@/lib/kamino/positions";
import { KAMINO_XSTOCK_COLLATERALS } from "@/lib/kamino/reserves";
import { getConnection, type AccountBalances } from "@/lib/solana/balances";
import { atomicToUi } from "@/lib/trustware/amounts";
import { groupEquivalentsByVault } from "@/lib/trustware/selection";
import type { HeldEquivalent } from "@/lib/trustware/planner";

// One collateral holding that counts toward borrowing capacity, kept unpriced so
// a price tick re-values it without refetching any chain state.
interface PledgedCollateral {
  mint: string;
  amountUi: number;
  // Max LTV as a fraction (0.8 = 80%).
  ltvFraction: number;
}

export interface BorrowSummary {
  // Total USDC drawn across every venue.
  debtUsd: number;
  // Most that could be drawn at max LTV against everything the account can put
  // up: collateral already deposited, xStocks sitting in the Solana wallet, and
  // same-underlying holdings that convert into a vault's collateral mint on
  // deposit. Wallet stock is counted because depositing it is part of the borrow
  // flow, so excluding it reported no headroom to an account that has plenty.
  capacityUsd: number;
  // What is still drawable: capacity minus what is already owed.
  availableUsd: number;
  // The caller's Kamino obligation, fetched here so the summary and the Kamino
  // card don't each pay for the same read.
  kaminoPosition: KaminoPosition | null;
  loading: boolean;
  refresh: () => void;
}

// Best max-LTV any venue lends against this collateral mint, as a fraction.
// Both venues take the same mints at different ratios and the user picks the
// market, so headroom quotes the better of the two. Zero means no market takes
// it, which drops the holding from the total.
function bestLtvFraction(mint: string): number {
  let best = 0;
  for (const v of XSTOCK_BORROW_VAULTS) {
    if (v.collateralMint === mint) {
      best = Math.max(best, v.collateralFactor / 1000);
    }
  }
  for (const c of KAMINO_XSTOCK_COLLATERALS) {
    if (c.collateralMint === mint) best = Math.max(best, c.maxLtvSnapshot);
  }
  return best;
}

function isEmptyPosition(p: UserPositionState): boolean {
  return p.collateralAtomic.isZero() && p.debtAtomic.isZero();
}

// This wallet's live position in one Jupiter vault, or null if it has none.
//
// Tries the stored position-NFT binding first, which costs a single account
// read instead of the full NFT scan. That shortcut is not sufficient on its own:
// closing a position zeroes it but leaves its NFT in the wallet, so a stale
// binding reads an emptied position and hides a live one opened on a later NFT.
// An empty or missing read therefore falls through to the scan, which knows how
// to pick the non-empty NFT when a wallet holds several.
async function readVaultPosition(
  walletAddress: string,
  vault: XStockBorrowVault,
  connection: Connection,
): Promise<UserPositionState | null> {
  const storedId = readStoredNftId(walletAddress, vault.vaultId);
  const stored =
    storedId != null
      ? await fetchPositionState(vault, storedId, connection)
      : null;
  if (stored && !isEmptyPosition(stored)) return stored;

  const scannedId = await findExistingNftId(walletAddress, vault, connection);
  if (scannedId == null || scannedId === storedId) return stored;
  return await fetchPositionState(vault, scannedId, connection);
}

// Account-wide borrow position: what is owed, and what could still be drawn.
//
// Reads every venue once on mount rather than waiting for a card to be expanded,
// since the figures headline the surface.
export function useBorrowSummary({
  walletAddress,
  prices,
  balances,
  equivalents,
}: {
  walletAddress: string;
  prices: JupiterPriceMap | null;
  // Solana wallet holdings. Undeposited xStocks here still count toward
  // headroom, since depositing them is the first leg of the borrow.
  balances: AccountBalances | null;
  // Same-underlying holdings that convert into a vault's collateral mint,
  // scanned across chains by the caller.
  equivalents: HeldEquivalent[];
}): BorrowSummary {
  const [debtUsd, setDebtUsd] = useState(0);
  const [pledged, setPledged] = useState<PledgedCollateral[]>([]);
  const [kaminoPosition, setKaminoPosition] = useState<KaminoPosition | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const connection = getConnection();
      let debt = 0;
      const collateral: PledgedCollateral[] = [];

      const jupiter = XSTOCK_BORROW_VAULTS.map(async (vault) => {
        try {
          const position = await readVaultPosition(
            walletAddress,
            vault,
            connection,
          );
          if (!position) return;
          debt += fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
          const amountUi = fromAtomicBN(
            position.collateralAtomic,
            vault.collateralDecimals,
          );
          if (amountUi > 0) {
            collateral.push({
              mint: vault.collateralMint,
              amountUi,
              ltvFraction: vault.collateralFactor / 1000,
            });
          }
        } catch (err) {
          console.error("[borrow summary jupiter]", err);
        }
      });

      const kamino = (async () => {
        try {
          const p = await fetchKaminoPosition(walletAddress);
          if (cancelled) return;
          setKaminoPosition(p);
          if (p) {
            debt += p.debtUsdc;
            if (p.collateralUi > 0) {
              collateral.push({
                mint: p.collateral.collateralMint,
                amountUi: p.collateralUi,
                ltvFraction: p.collateral.maxLtvSnapshot,
              });
            }
          }
        } catch (err) {
          console.error("[borrow summary kamino]", err);
        }
      })();

      await Promise.all([...jupiter, kamino]);
      if (cancelled) return;
      setDebtUsd(debt);
      setPledged(collateral);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, tick]);

  const capacityUsd = useMemo(() => {
    let capacity = 0;
    const add = (mint: string, amountUi: number, ltvFraction: number) => {
      if (amountUi <= 0 || ltvFraction <= 0) return;
      const price = prices?.[mint]?.usdPrice ?? null;
      if (price != null) capacity += amountUi * price * ltvFraction;
    };

    for (const p of pledged) add(p.mint, p.amountUi, p.ltvFraction);

    // Backed xStocks sitting on Solana. Only these: the Ondo mints the wallet
    // also tracks arrive through the equivalents scan below, so reading both
    // sides here would count them twice.
    for (const [mint, amountUi] of Object.entries(balances?.xstocks ?? {})) {
      add(mint, amountUi, bestLtvFraction(mint));
    }

    // Convertible holdings, priced as the xStock they convert into. A 1:1
    // equivalent of the same underlying, so the destination mint's price is the
    // right mark for it.
    for (const [vaultId, held] of groupEquivalentsByVault(equivalents)) {
      const vault = XSTOCK_BORROW_VAULTS.find((v) => v.vaultId === vaultId);
      if (!vault) continue;
      const ltv = bestLtvFraction(vault.collateralMint);
      for (const h of held) {
        const amountUi = Number(
          atomicToUi(h.balanceAtomic, h.source.decimals),
        );
        add(vault.collateralMint, amountUi, ltv);
      }
    }

    return capacity;
  }, [pledged, prices, balances, equivalents]);

  return {
    debtUsd,
    capacityUsd,
    availableUsd: Math.max(0, capacityUsd - debtUsd),
    kaminoPosition,
    loading,
    refresh,
  };
}
