import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

// Server-side store for Strategies-page runs. See
// supabase/migrations/0003_strategy_runs.sql for what a run is and why it is
// stored, and lib/strategies/runs-client.ts for the shape of `state`.
//
// Every function takes an already-verified Privy DID. Nothing here accepts a
// caller-supplied identity, and the wallet address is resolved from the
// verified token by the route rather than passed up from the browser.

export type StrategyKind = "earn" | "leverage" | "ladder";
export type RunStatus = "running" | "done";

export interface StoredRun {
  id: string;
  strategy: StrategyKind;
  mint: string;
  status: RunStatus;
  state: unknown;
  openedAt: string;
  updatedAt: string;
}

interface RunRow {
  id: string;
  strategy: StrategyKind;
  mint: string;
  status: RunStatus;
  state: unknown;
  opened_at: string;
  updated_at: string;
}

const COLUMNS = "id, strategy, mint, status, state, opened_at, updated_at";

function toRun(row: RunRow): StoredRun {
  return {
    id: row.id,
    strategy: row.strategy,
    mint: row.mint,
    status: row.status,
    state: row.state,
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
  };
}

async function userIdForDid(privyDid: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("users")
    .select("id")
    .eq("privy_did", privyDid)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function listRuns(
  privyDid: string,
  walletAddress: string,
): Promise<StoredRun[]> {
  const userId = await userIdForDid(privyDid);
  if (!userId) return [];
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("strategy_runs")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("wallet_address", walletAddress)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as RunRow[]).map(toRun);
}

// Insert or replace. The client owns the id, so a run written before its
// first step lands and rewritten after every step is the same row.
export async function upsertRun(
  privyDid: string,
  walletAddress: string,
  run: Pick<StoredRun, "id" | "strategy" | "mint" | "status" | "state">,
): Promise<StoredRun | null> {
  const userId = await userIdForDid(privyDid);
  if (!userId) return null;
  const db = getSupabaseAdmin();

  // Scoped update first so one user can never overwrite another's row by
  // guessing its id: the upsert below would match on the primary key alone.
  const { data: existing } = await db
    .from("strategy_runs")
    .select("id, user_id, wallet_address")
    .eq("id", run.id)
    .maybeSingle();
  if (existing) {
    const row = existing as { user_id: string; wallet_address: string };
    if (row.user_id !== userId || row.wallet_address !== walletAddress) {
      throw new Error("Run belongs to another account");
    }
    const { data, error } = await db
      .from("strategy_runs")
      .update({
        status: run.status,
        state: run.state,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return toRun(data as RunRow);
  }

  const { data, error } = await db
    .from("strategy_runs")
    .insert({
      id: run.id,
      user_id: userId,
      wallet_address: walletAddress,
      strategy: run.strategy,
      mint: run.mint,
      status: run.status,
      state: run.state,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toRun(data as RunRow);
}

export async function deleteRun(
  privyDid: string,
  walletAddress: string,
  id: string,
): Promise<void> {
  const userId = await userIdForDid(privyDid);
  if (!userId) return;
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("strategy_runs")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("wallet_address", walletAddress);
  if (error) throw error;
}
