import "server-only";

import { getSupabaseAdmin, UNIQUE_VIOLATION } from "@/lib/supabase/server";

import type { UniswapChainId, UniswapProtocol } from "./constants";

// Server-side store for the positions the app opened. See
// supabase/migrations/0004_uniswap_positions.sql for what a row is and why
// it exists, and lib/uniswap/server.ts for how a row is derived from a
// receipt. Every function takes an already-verified Privy DID and the
// embedded EVM wallet the route resolved from it; nothing here accepts a
// caller-supplied identity.

export interface StoredPosition {
  chainId: UniswapChainId;
  protocol: UniswapProtocol;
  tokenId: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  txHash: string | null;
  openedAt: string;
}

interface Row {
  chain_id: number;
  protocol: UniswapProtocol;
  token_id: string;
  pool_id: string;
  tick_lower: number;
  tick_upper: number;
  tx_hash: string | null;
  opened_at: string;
}

const COLUMNS = "chain_id, protocol, token_id, pool_id, tick_lower, tick_upper, tx_hash, opened_at";

function toStored(row: Row): StoredPosition {
  return {
    chainId: row.chain_id as UniswapChainId,
    protocol: row.protocol,
    tokenId: row.token_id,
    poolId: row.pool_id,
    tickLower: row.tick_lower,
    tickUpper: row.tick_upper,
    txHash: row.tx_hash,
    openedAt: row.opened_at,
  };
}

async function userIdForDid(privyDid: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data } = await db.from("users").select("id").eq("privy_did", privyDid).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// Open rows for one wallet.
export async function listOpenPositions(
  privyDid: string,
  walletAddress: string,
): Promise<StoredPosition[]> {
  const userId = await userIdForDid(privyDid);
  if (!userId) return [];
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("uniswap_positions")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("wallet_address", walletAddress.toLowerCase())
    .is("closed_at", null)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toStored);
}

// Insert a row derived from a receipt. A duplicate (the same NFT recorded
// twice, which a retried record call does) is not an error.
export async function recordPosition(
  privyDid: string,
  walletAddress: string,
  position: Omit<StoredPosition, "openedAt">,
): Promise<void> {
  const userId = await userIdForDid(privyDid);
  if (!userId) throw new Error("No user row for this account yet.");
  const db = getSupabaseAdmin();
  const { error } = await db.from("uniswap_positions").insert({
    user_id: userId,
    wallet_address: walletAddress.toLowerCase(),
    chain_id: position.chainId,
    protocol: position.protocol,
    token_id: position.tokenId,
    pool_id: position.poolId.toLowerCase(),
    tick_lower: position.tickLower,
    tick_upper: position.tickUpper,
    tx_hash: position.txHash,
  });
  if (error && error.code !== UNIQUE_VIOLATION) throw error;
}

// Mark rows closed. Scoped to the wallet so one user can never close
// another's row by naming its token id.
export async function closePositions(
  privyDid: string,
  walletAddress: string,
  keys: { chainId: number; protocol: UniswapProtocol; tokenId: string }[],
): Promise<void> {
  if (keys.length === 0) return;
  const userId = await userIdForDid(privyDid);
  if (!userId) return;
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  for (const k of keys) {
    const { error } = await db
      .from("uniswap_positions")
      .update({ closed_at: now })
      .eq("user_id", userId)
      .eq("wallet_address", walletAddress.toLowerCase())
      .eq("chain_id", k.chainId)
      .eq("protocol", k.protocol)
      .eq("token_id", k.tokenId)
      .is("closed_at", null);
    if (error) throw error;
  }
}
