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

export interface AccountBalances {
  sol: number;
  usdc: number;
  xstocks: Record<string, number>;
  // Exact base-unit amounts as decimal strings. `uiAmount` from
  // getParsedTokenAccountsByOwner is a JS float and can round up for high-decimal
  // mints (xStocks are 8 decimals), causing on-chain transfers to fail with
  // "insufficient funds" when the displayed Max is one atomic unit over the real
  // balance. Use these whenever you need to convert to an instruction amount.
  usdcAtomic: string;
  xstocksAtomic: Record<string, string>;
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
  for (const acc of token2022.value) {
    const mint = xstockAtaToMint.get(acc.pubkey.toBase58());
    if (!mint) continue;
    const info = acc.account.data.parsed.info;
    // Defensive: parsed.info.mint should always match the ATA-derived mint.
    if (info.mint !== mint) continue;
    xstocks[mint] = info.tokenAmount.uiAmount ?? 0;
    xstocksAtomic[mint] = info.tokenAmount.amount ?? "0";
  }

  return {
    sol: solLamports / LAMPORTS_PER_SOL,
    usdc,
    usdcAtomic,
    xstocks,
    xstocksAtomic,
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

export function useBalances(walletAddress: string | undefined): {
  balances: AccountBalances | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
} {
  const [balances, setBalances] = useState<AccountBalances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped on every refresh and on wallet change. A response only commits if its
  // captured epoch is still current, so a slow in-flight fetch can't clobber a
  // newer fast one (which is what made post-swap balances "sometimes" vanish).
  const epochRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    const myEpoch = ++epochRef.current;
    setRefreshing(true);
    try {
      const next = await fetchAllBalances(walletAddress);
      if (epochRef.current !== myEpoch) return;
      setBalances(next);
      setError(null);
    } catch (err) {
      if (epochRef.current !== myEpoch) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error("[useBalances]", err);
    } finally {
      if (epochRef.current === myEpoch) setRefreshing(false);
    }
  }, [walletAddress]);

  // When the wallet changes, invalidate any in-flight requests and clear state so
  // we never briefly render the previous wallet's balances.
  useEffect(() => {
    epochRef.current++;
    setBalances(null);
    setError(null);
    setRefreshing(false);
  }, [walletAddress]);

  useEffect(() => {
    refresh();
    if (!walletAddress) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, walletAddress]);

  return { balances, error, refreshing, refresh };
}
