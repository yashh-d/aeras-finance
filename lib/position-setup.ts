import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

// Server-side store for one-time position setup rent. See
// supabase/migrations/0003_position_setup.sql for what it records and why.
//
// Write-only on purpose. There is no read function here and no GET on the route
// above it, because the app must never decide anything from this table: whether
// to show the setup sheet is answered by reading the accounts on chain. Leaving
// the reader unwritten is the cheapest way to keep that true, since a function
// that does not exist cannot be called from a gate by a later change.
//
// Takes an already-verified Privy DID. Nothing here accepts a caller-supplied
// identity, and the wallet address is resolved from the verified token by the
// route rather than passed up from the browser.

export type SetupVenue = "kamino" | "jupiter";
export type SetupFundedVia =
  | "existing_balance"
  | "usdc_swap"
  | "collateral_sale"
  | "privy_funding";

// What Privy reported the user actually used. Null when they closed the flow
// before picking one.
export type SetupFundingMethod =
  | "moonpay"
  | "coinbase-onramp"
  | "external"
  | "manual"
  | null;

export interface PositionSetupInput {
  venue: SetupVenue;
  rentLamports: number;
  feeLamports: number;
  fundedVia: SetupFundedVia;
  // Dollar value of whatever was sold to cover the shortfall: the USDC spent,
  // or the market value of the collateral sold. Present only for the two
  // in-app routes; the database rejects the other combinations.
  fundingUsd?: number | null;
  fundingSignature?: string | null;
  // Present only for privy_funding.
  fundingMethod?: SetupFundingMethod;
}

// Resolve the users row for a verified DID. Null when the DID has no row yet,
// which callers treat as "nothing to record" rather than an error: /api/auth/sync
// creates the row on login and a position cannot be opened before that.
async function userIdForDid(privyDid: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("users")
    .select("id")
    .eq("privy_did", privyDid)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// Record a setup that was paid for. One row per payment, never an upsert: on
// Jupiter Lend the cost recurs per position, so collapsing repeats would drop
// real events. See the note on the missing unique index in the migration.
export async function recordPositionSetup(
  privyDid: string,
  walletAddress: string,
  input: PositionSetupInput,
): Promise<void> {
  const userId = await userIdForDid(privyDid);
  if (!userId) return;

  // Both in-app routes sell something through Ultra and produce a signature and
  // a dollar amount. They differ only in what was sold, which funded_via records.
  const swap =
    input.fundedVia === "usdc_swap" || input.fundedVia === "collateral_sale";
  const external = input.fundedVia === "privy_funding";
  const db = getSupabaseAdmin();
  const { error } = await db.from("position_setup").insert({
    user_id: userId,
    wallet_address: walletAddress,
    venue: input.venue,
    rent_lamports: input.rentLamports,
    fee_lamports: input.feeLamports,
    funded_via: input.fundedVia,
    // Normalised rather than passed through: the check constraint rejects a
    // balance-funded row that carries either field, and a caller that sends one
    // anyway is describing a swap that did not happen.
    funding_usd: swap ? (input.fundingUsd ?? null) : null,
    funding_signature: swap ? (input.fundingSignature ?? null) : null,
    funding_method: external ? (input.fundingMethod ?? null) : null,
  });
  if (error) throw error;
}
