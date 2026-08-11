"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  SOL_MINT,
  USDC_MINT,
} from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import { SOLANA_EQUIVALENT_TOKENS } from "./equivalent-tokens";

export interface AccountBalances {
  sol: number;
  usdc: number;
  xstocks: Record<string, number>;
  // Same-underlying tokens that are not tradable here (Ondo's Solana mints),
  // keyed by mint. Display only: they exist so a received transfer is visible
  // instead of silently missing from the panel.
  equivalents: Record<string, number>;
  // Exact base-unit amounts as decimal strings. `uiAmount` from
  // getParsedTokenAccountsByOwner is a JS float and can round up for high-decimal
  // mints (xStocks are 8 decimals), causing on-chain transfers to fail with
  // "insufficient funds" when the displayed Max is one atomic unit over the real
  // balance. Use these whenever you need to convert to an instruction amount.
  usdcAtomic: string;
  xstocksAtomic: Record<string, string>;
  equivalentsAtomic: Record<string, string>;
}

export function totalAccountUsd(
  balances: AccountBalances | null,
  prices: JupiterPriceMap | null,
): number | null {
  if (!balances) return null;
  let total = 0;
  const solPrice = prices?.[SOL_MINT]?.usdPrice;
  if (solPrice) total += balances.sol * solPrice;
  total += balances.usdc;
  for (const [mint, amount] of Object.entries(balances.xstocks)) {
    const p = prices?.[mint]?.usdPrice;
    if (p) total += amount * p;
  }
  // Counted in the total even though they can't be traded here. The value is in
  // the wallet either way, and omitting it makes the total disagree with what
  // the rows below it add up to.
  for (const [mint, amount] of Object.entries(balances.equivalents)) {
    const p = prices?.[mint]?.usdPrice;
    if (p) total += amount * p;
  }
  return total;
}

// Background refresh cadence. Kept deliberately slow: every poll runs getBalance
// plus two full getParsedTokenAccountsByOwner scans against the RPC, and trades
// already trigger an explicit refresh() via onRefresh, so the interval only
// needs to catch out-of-band changes. 15s was hammering the RPC (429/413s).
const POLL_MS = 60_000;

function getRpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SOLANA_RPC_URL is not set. Add it to .env.local.",
    );
  }
  return url;
}

export function getConnection(): Connection {
  return new Connection(getRpcUrl(), "confirmed");
}

export async function fetchAllBalances(
  walletAddress: string,
): Promise<AccountBalances> {
  const conn = getConnection();
  const owner = new PublicKey(walletAddress);

  // The Jupiter Lend SDK (and almost every standard SPL flow) pulls from the
  // canonical associated token account, not "any token account owned by the
  // user holding this mint". Reading the broader set caused us to occasionally
  // surface a balance larger than the ATA actually holds — which made the SDK
  // request more than was available, failing TransferChecked with
  // InsufficientFunds (0x1). Pin every balance to its canonical ATA.
  const usdcAta = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    owner,
    false,
    TOKEN_PROGRAM_ID,
  ).toBase58();
  const xstockAtaToMint = new Map<string, string>();
  for (const x of XSTOCKS) {
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(x.mint),
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
    ).toBase58();
    xstockAtaToMint.set(ata, x.mint);
  }
  // Ondo does not use one token program across its Solana mints the way Backed
  // does, and guessing wrong would hide the balance entirely. Derive the ATA
  // under both programs and accept whichever one exists.
  const equivalentAtaToMint = new Map<string, string>();
  for (const t of SOLANA_EQUIVALENT_TOKENS) {
    for (const programId of [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID]) {
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(t.mint),
        owner,
        false,
        programId,
      ).toBase58();
      equivalentAtaToMint.set(ata, t.mint);
    }
  }

  const [solLamports, legacy, token2022] = await Promise.all([
    conn.getBalance(owner),
    conn.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
    conn.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ]);

  let usdc = 0;
  let usdcAtomic = "0";
  for (const acc of legacy.value) {
    if (acc.pubkey.toBase58() !== usdcAta) continue;
    const info = acc.account.data.parsed.info;
    if (info.mint !== USDC_MINT) continue;
    usdc = info.tokenAmount.uiAmount ?? 0;
    usdcAtomic = info.tokenAmount.amount ?? "0";
    break;
  }

  const xstocks: Record<string, number> = {};
  const xstocksAtomic: Record<string, string> = {};
  const equivalents: Record<string, number> = {};
  const equivalentsAtomic: Record<string, string> = {};
  for (const acc of [...token2022.value, ...legacy.value]) {
    const ata = acc.pubkey.toBase58();
    const info = acc.account.data.parsed.info;
    const mint = xstockAtaToMint.get(ata);
    if (mint) {
      // Defensive: parsed.info.mint should always match the ATA-derived mint.
      if (info.mint !== mint) continue;
      xstocks[mint] = info.tokenAmount.uiAmount ?? 0;
      xstocksAtomic[mint] = info.tokenAmount.amount ?? "0";
      continue;
    }
    const equivalentMint = equivalentAtaToMint.get(ata);
    if (!equivalentMint || info.mint !== equivalentMint) continue;
    equivalents[equivalentMint] = info.tokenAmount.uiAmount ?? 0;
    equivalentsAtomic[equivalentMint] = info.tokenAmount.amount ?? "0";
  }

  return {
    sol: solLamports / LAMPORTS_PER_SOL,
    usdc,
    usdcAtomic,
    xstocks,
    xstocksAtomic,
    equivalents,
    equivalentsAtomic,
  };
}

// Format an exact base-unit decimal string into a UI string with the right
// fractional precision and no trailing zeros. Lossless inverse of toAtomicBN.
export function atomicToUiString(atomicStr: string, decimals: number): string {
  if (!atomicStr || atomicStr === "0") return "0";
  const padded = atomicStr.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

// True when two snapshots hold the same amounts. Compares the exact atomic
// strings (not the float uiAmounts) so the settle loop can reliably tell whether
// a just-submitted transaction has been reflected by the RPC yet.
function balancesEqual(a: AccountBalances, b: AccountBalances): boolean {
  if (a.sol !== b.sol) return false;
  if (a.usdcAtomic !== b.usdcAtomic) return false;
  const mints = new Set([
    ...Object.keys(a.xstocksAtomic),
    ...Object.keys(b.xstocksAtomic),
  ]);
  for (const mint of mints) {
    if ((a.xstocksAtomic[mint] ?? "0") !== (b.xstocksAtomic[mint] ?? "0")) {
      return false;
    }
  }
  return true;
}

// Backoff (ms) for the post-action settle loop. A confirmed swap/deposit is often
// not yet visible to the next getParsedTokenAccountsByOwner read, so we re-read a
// few times until the holdings actually change instead of waiting for the poll.
const SETTLE_DELAYS_MS = [0, 1200, 2500, 4000];

export function useBalances(walletAddress: string | undefined): {
  balances: AccountBalances | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  refreshSettled: () => Promise<void>;
} {
  const [balances, setBalances] = useState<AccountBalances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped on every fetch and on wallet change. A response only commits if its
  // captured epoch is still current, so a slow in-flight fetch can't clobber a
  // newer fast one (which is what made post-swap balances "sometimes" vanish).
  const epochRef = useRef(0);
  // Latest committed balances, readable synchronously inside the settle loop.
  const balancesRef = useRef<AccountBalances | null>(null);
  // In-flight fetch count so "Refreshing…" stays on for the whole settle loop and
  // clears exactly once nothing is running.
  const inFlightRef = useRef(0);

  const beginFetch = useCallback(() => {
    inFlightRef.current += 1;
    setRefreshing(true);
  }, []);
  const endFetch = useCallback(() => {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1);
    if (inFlightRef.current === 0) setRefreshing(false);
  }, []);

  // One fetch that commits to state only if it is still the latest request.
  // Returns the committed balances, or null if superseded or errored.
  const fetchOnce = useCallback(async (): Promise<AccountBalances | null> => {
    if (!walletAddress) return null;
    const myEpoch = ++epochRef.current;
    beginFetch();
    try {
      const next = await fetchAllBalances(walletAddress);
      if (epochRef.current !== myEpoch) return null;
      setBalances(next);
      balancesRef.current = next;
      setError(null);
      return next;
    } catch (err) {
      if (epochRef.current !== myEpoch) return null;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error("[useBalances]", err);
      return null;
    } finally {
      endFetch();
    }
  }, [walletAddress, beginFetch, endFetch]);

  const refresh = useCallback(async () => {
    await fetchOnce();
  }, [fetchOnce]);

  // Call after an action that should change balances (swap, send, deposit,
  // withdraw). Re-reads with backoff until the holdings differ from what we had
  // before, so the new balance appears without a manual refresh or page reload.
  const refreshSettled = useCallback(async () => {
    if (!walletAddress) return;
    const before = balancesRef.current;
    for (const delay of SETTLE_DELAYS_MS) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const next = await fetchOnce();
      if (!next) return; // superseded (e.g. wallet change) — stop retrying
      if (!before || !balancesEqual(before, next)) return; // change landed
    }
  }, [walletAddress, fetchOnce]);

  // When the wallet changes, invalidate any in-flight requests and clear state so
  // we never briefly render the previous wallet's balances.
  useEffect(() => {
    epochRef.current++;
    setBalances(null);
    balancesRef.current = null;
    setError(null);
  }, [walletAddress]);

  useEffect(() => {
    refresh();
    if (!walletAddress) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, walletAddress]);

  return { balances, error, refreshing, refresh, refreshSettled };
}
