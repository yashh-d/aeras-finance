"use client";

// Browser-side readers for the venue. Everything goes through our own API
// routes: the pools route is public, the positions route reads the wallet off
// the Privy token, and recording a mint names only its hash.

import type { UniswapPoolMetric, UniswapPoolsPayload } from "@/app/api/uniswap/pools/route";
import type {
  UniswapPositionView,
  UniswapPositionsPayload,
  WalletBalances,
} from "@/app/api/uniswap/positions/route";
import { privyAuthHeaders } from "@/lib/privy/access-token";

import type { UniswapChainId } from "./constants";

export type { UniswapPoolMetric, UniswapPoolsPayload, UniswapPositionView, UniswapPositionsPayload, WalletBalances };

export async function fetchUniswapPools(): Promise<UniswapPoolsPayload> {
  const res = await fetch("/api/uniswap/pools", { cache: "no-store" });
  if (!res.ok) throw new Error(`Uniswap pools failed: ${res.status}`);
  return (await res.json()) as UniswapPoolsPayload;
}

export async function fetchUniswapPositions(): Promise<UniswapPositionsPayload> {
  const res = await fetch("/api/uniswap/positions", {
    cache: "no-store",
    headers: await privyAuthHeaders(),
  });
  const body = (await res.json()) as UniswapPositionsPayload & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Uniswap positions failed: ${res.status}`);
  return body;
}

// Record the position a mint created. Resolves false while the transaction
// is still pending, so a caller can retry; throws when the chain says the
// mint failed or minted nothing for this wallet.
export async function recordUniswapPosition(chainId: UniswapChainId, txHash: string): Promise<boolean> {
  const res = await fetch("/api/uniswap/positions", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(await privyAuthHeaders()) },
    body: JSON.stringify({ chainId, txHash }),
  });
  const body = (await res.json()) as { error?: string; pending?: boolean };
  if (res.status === 409 && body.pending) return false;
  if (!res.ok) throw new Error(body.error ?? `Could not record the position: ${res.status}`);
  return true;
}
