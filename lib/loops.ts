import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

// Server-side store for the parts of a leveraged loop that are not on chain:
// whether a vault's position is leverage-managed, and the equity that went into
// it. See supabase/migrations/0002_loop_positions.sql for why chain state is
// not enough.
//
// Every function here takes an already-verified Privy DID. Nothing in this file
// accepts a caller-supplied identity, and the wallet address is likewise
// resolved from the verified token by the route rather than passed up from the
// browser: a wallet parameter would let any signed-in user read or overwrite
// another user's records by naming their address.

export interface LoopRecord {
  vaultId: number;
  basisUsd: number | null;
  openedAt: string;
}

interface LoopRow {
  vault_id: number;
  basis_usd: string | number | null;
  opened_at: string;
}

function toRecord(row: LoopRow): LoopRecord {
  // numeric comes back as a string from PostgREST to avoid precision loss.
  const basis = row.basis_usd == null ? null : Number(row.basis_usd);
  return {
    vaultId: row.vault_id,
    basisUsd: basis != null && Number.isFinite(basis) && basis > 0 ? basis : null,
    openedAt: row.opened_at,
  };
}

// Resolve the users row for a verified DID. Returns null when the DID has no
// row yet, which the routes treat as "nothing recorded" rather than an error:
// /api/auth/sync creates the row on login and a loop cannot exist before that.
async function userIdForDid(privyDid: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("users")
    .select("id")
    .eq("privy_did", privyDid)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function listLoopRecords(
  privyDid: string,
  walletAddress: string,
): Promise<LoopRecord[]> {
  const userId = await userIdForDid(privyDid);
  if (!userId) return [];

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("loop_positions")
    .select("vault_id, basis_usd, opened_at")
    .eq("user_id", userId)
    .eq("wallet_address", walletAddress);
  if (error) throw error;
  return ((data ?? []) as LoopRow[]).map(toRecord);
}

// Mark a vault leverage-managed, recording the basis when there is one.
//
// Two modes, and the difference matters for the arithmetic:
//
//   "add"  — a loop was just opened. The basis ACCUMULATES, because the basis
//            is total equity contributed and a second loop into the same vault
//            adds to it. Keeping the first entry instead would leave a position
//            funded with $10 then $5 showing a basis of $10 against equity of
//            $15, i.e. a $5 gain the user never made.
//   "seed" — carrying a pre-Supabase localStorage record up. Fills the basis
//            only when there is none, so a repeat migration cannot inflate it.
//
// A null basis in either mode means "managed, basis unknown", which renders as
// no P&L. It never clears a basis that is already recorded.
export type BasisMode = "add" | "seed";

export async function upsertLoopRecord(
  privyDid: string,
  walletAddress: string,
  vaultId: number,
  basisUsd: number | null,
  mode: BasisMode,
): Promise<LoopRecord | null> {
  const userId = await userIdForDid(privyDid);
  if (!userId) return null;

  const db = getSupabaseAdmin();
  const { data: existing } = await db
    .from("loop_positions")
    .select("vault_id, basis_usd, opened_at")
    .eq("user_id", userId)
    .eq("wallet_address", walletAddress)
    .eq("vault_id", vaultId)
    .maybeSingle();

  if (existing) {
    const current = toRecord(existing as LoopRow);
    if (basisUsd == null) return current;
    const next =
      mode === "add" && current.basisUsd != null
        ? current.basisUsd + basisUsd
        : current.basisUsd != null
          ? current.basisUsd // "seed" never overwrites a known basis
          : basisUsd;
    if (next === current.basisUsd) return current;

    const { data, error } = await db
      .from("loop_positions")
      .update({ basis_usd: next, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("wallet_address", walletAddress)
      .eq("vault_id", vaultId)
      .select("vault_id, basis_usd, opened_at")
      .single();
    if (error) throw error;
    return toRecord(data as LoopRow);
  }

  const { data, error } = await db
    .from("loop_positions")
    .insert({
      user_id: userId,
      wallet_address: walletAddress,
      vault_id: vaultId,
      basis_usd: basisUsd,
    })
    .select("vault_id, basis_usd, opened_at")
    .single();
  if (error) throw error;
  return toRecord(data as LoopRow);
}

// Called when a loop is unwound. The row goes rather than being kept with a
// null basis: an absent record means "plain borrow", which is the correct
// reading once the leverage is gone.
export async function deleteLoopRecord(
  privyDid: string,
  walletAddress: string,
  vaultId: number,
): Promise<void> {
  const userId = await userIdForDid(privyDid);
  if (!userId) return;

  const db = getSupabaseAdmin();
  const { error } = await db
    .from("loop_positions")
    .delete()
    .eq("user_id", userId)
    .eq("wallet_address", walletAddress)
    .eq("vault_id", vaultId);
  if (error) throw error;
}
