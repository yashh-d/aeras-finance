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

// One market the account currently owes money in. The summary already reads
// every venue to total the debt, so it keeps the per-market breakdown rather
// than discarding it: the repay flow needs to name a specific position, and
// re-deriving it would repeat the same chain reads.
export type BorrowPositionRef =
  | { venue: "jupiter"; vault: XStockBorrowVault; nftId: number }
  | { venue: "kamino"; position: KaminoPosition };

export interface OpenBorrowPosition {
  // Stable identity for React keys and selection state.
  key: string;
  venueLabel: "Jupiter Lend" | "Kamino";
  collateralSymbol: string;
  collateralMint: string;
  collateralUi: number;
  // Outstanding debt in the borrow asset, which is USDC on both venues.
  debtUi: number;
  debtSymbol: string;
  ref: BorrowPositionRef;
}

export interface BorrowSummary {
  // Total USDC drawn across every venue.
  debtUsd: number;
  // Every market with a non-zero debt, largest first. Empty when nothing is
  // owed anywhere.
  positions: OpenBorrowPosition[];
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
  // Every mint the account has posted as collateral at any venue, in UI units,
  // summed across venues. Deposited stock is still price exposure, so the
  // positions card reads this to tell a hedge apart from an outright short once
  // the stock backing it has left the wallet.
  collateralByMint: Record<string, number>;
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

// ── Shared snapshot ────────────────────────────────────────────────────────
//
// One account-wide read of every borrow venue, shared by every consumer in the
// session. Home renders two surfaces off this data now, the borrow panel and
// the positions card, and the Jupiter side costs one getProgramAccounts per
// vault, thirteen of them, so a second mount doubled the heaviest read on the
// page. Same shape as the account-state cache in lib/lighter/client.ts: a short
// TTL held over the promise, so concurrent mounts share one in-flight read and
// a later mount is served from memory rather than from chain.
interface BorrowSnapshot {
  debtUsd: number;
  positions: OpenBorrowPosition[];
  pledged: PledgedCollateral[];
  kaminoPosition: KaminoPosition | null;
}

const SNAPSHOT_TTL_MS = 20_000;

const snapshotCache = new Map<
  string,
  { at: number; snapshot: Promise<BorrowSnapshot> }
>();

function loadBorrowSnapshot(walletAddress: string): Promise<BorrowSnapshot> {
  const cached = snapshotCache.get(walletAddress);
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) return cached.snapshot;
  const snapshot = readBorrowSnapshot(walletAddress);
  snapshotCache.set(walletAddress, { at: Date.now(), snapshot });
  // A rejected read must not be handed to every caller for the rest of the TTL.
  snapshot.catch(() => snapshotCache.delete(walletAddress));
  return snapshot;
}

async function readBorrowSnapshot(
  walletAddress: string,
): Promise<BorrowSnapshot> {
  const connection = getConnection();
  let debt = 0;
  const collateral: PledgedCollateral[] = [];
  const open: OpenBorrowPosition[] = [];
  // A holder rather than a bare `let`, so the value assigned inside the Kamino
  // task is visibly the one returned below.
  const kaminoResult: { position: KaminoPosition | null } = { position: null };

  const jupiter = XSTOCK_BORROW_VAULTS.map(async (vault) => {
    try {
      const position = await readVaultPosition(walletAddress, vault, connection);
      if (!position) return;
      const debtUi = fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
      debt += debtUi;
      const amountUi = fromAtomicBN(
        position.collateralAtomic,
        vault.collateralDecimals,
      );
      if (debtUi > 0) {
        open.push({
          key: `jupiter:${vault.vaultId}`,
          venueLabel: "Jupiter Lend",
          collateralSymbol: vault.collateralSymbol,
          collateralMint: vault.collateralMint,
          collateralUi: amountUi,
          debtUi,
          debtSymbol: vault.borrowSymbol,
          ref: { venue: "jupiter", vault, nftId: position.nftId },
        });
      }
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
      kaminoResult.position = p;
      if (!p) return;
      debt += p.debtUsdc;
      if (p.debtUsdc > 0) {
        open.push({
          key: `kamino:${p.collateral.reserve}`,
          venueLabel: "Kamino",
          collateralSymbol: p.collateral.symbol,
          collateralMint: p.collateral.collateralMint,
          collateralUi: p.collateralUi,
          debtUi: p.debtUsdc,
          debtSymbol: "USDC",
          ref: { venue: "kamino", position: p },
        });
      }
      if (p.collateralUi > 0) {
        collateral.push({
          mint: p.collateral.collateralMint,
          amountUi: p.collateralUi,
          ltvFraction: p.collateral.maxLtvSnapshot,
        });
      }
    } catch (err) {
      console.error("[borrow summary kamino]", err);
    }
  })();

  await Promise.all([...jupiter, kamino]);
  // The venue reads settle concurrently, so sort rather than relying on the
  // order they happened to finish in.
  open.sort((a, b) => b.debtUi - a.debtUi);

  return {
    debtUsd: debt,
    positions: open,
    pledged: collateral,
    kaminoPosition: kaminoResult.position,
  };
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
  const [positions, setPositions] = useState<OpenBorrowPosition[]>([]);
  const [pledged, setPledged] = useState<PledgedCollateral[]>([]);
  const [kaminoPosition, setKaminoPosition] = useState<KaminoPosition | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Drops the shared snapshot before re-running, so a refresh after a borrow or
  // repay goes to chain instead of replaying the pre-settlement read.
  const refresh = useCallback(() => {
    snapshotCache.delete(walletAddress);
    setTick((n) => n + 1);
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadBorrowSnapshot(walletAddress)
      .then((snapshot) => {
        if (cancelled) return;
        setDebtUsd(snapshot.debtUsd);
        setPositions(snapshot.positions);
        setPledged(snapshot.pledged);
        setKaminoPosition(snapshot.kaminoPosition);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[borrow summary]", err);
        setLoading(false);
      });
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

  // Summed rather than taken per entry: both venues take the same mints, so a
  // stock deposited at each appears twice in `pledged`.
  const collateralByMint = useMemo(() => {
    const byMint: Record<string, number> = {};
    for (const p of pledged) {
      byMint[p.mint] = (byMint[p.mint] ?? 0) + p.amountUi;
    }
    return byMint;
  }, [pledged]);

  return {
    debtUsd,
    positions,
    capacityUsd,
    availableUsd: Math.max(0, capacityUsd - debtUsd),
    kaminoPosition,
    collateralByMint,
    loading,
    refresh,
  };
}
