import "server-only";

import { getSupabaseAdmin, UNIQUE_VIOLATION } from "@/lib/supabase/server";
import { isValidEmail, normalizeEmail } from "@/lib/waitlist";

export { isValidEmail, normalizeEmail };

export type UserStatus = "waitlisted" | "approved" | "rejected" | "banned";

export type UserRow = {
  id: string;
  privy_did: string | null;
  email: string | null;
  name: string | null;
  wallet_address: string | null;
  status: UserStatus;
  invited_by: string | null;
  referral_code: string;
  reason: string | null;
  approved_at: string | null;
  created_at: string;
};

// The only shape the client ever sees. Never return raw rows.
export type UserView = {
  status: UserStatus;
  email: string | null;
  referralCode: string;
  position: number | null;
  approvedAt: string | null;
};

// Cosmetic padding added to the real queue position for display, so a small
// early list doesn't look empty. The true position is #1; we show #48.
const DISPLAY_OFFSET = 47;

async function getPosition(email: string | null): Promise<number | null> {
  if (!email) return null;
  const { data, error } = await getSupabaseAdmin().rpc("waitlist_position", {
    user_email: email,
  });
  if (error) return null;
  return typeof data === "number" ? data : null;
}

export async function toView(row: UserRow): Promise<UserView> {
  const raw =
    row.status === "waitlisted" ? await getPosition(row.email) : null;
  const position = raw == null ? null : raw + DISPLAY_OFFSET;
  return {
    status: row.status,
    email: row.email,
    referralCode: row.referral_code,
    position,
    approvedAt: row.approved_at,
  };
}

// Public form submission. Creates a waitlisted row keyed by email, or returns
// the existing row (idempotent). Links a referrer if a valid code was passed.
export async function createFromForm(input: {
  email: string;
  name?: string;
  reason?: string;
  walletAddress?: string;
  referralCode?: string;
}): Promise<{ created: boolean; row: UserRow }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Email required.");
  const db = getSupabaseAdmin();

  const { data: existing } = await db
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (existing) return { created: false, row: existing as UserRow };

  let invitedBy: string | null = null;
  if (input.referralCode) {
    const { data: inviter } = await db
      .from("users")
      .select("id")
      .eq("referral_code", input.referralCode.trim())
      .maybeSingle();
    invitedBy = inviter?.id ?? null;
  }

  const { data, error } = await db
    .from("users")
    .insert({
      email,
      name: input.name?.trim() || null,
      reason: input.reason?.trim() || null,
      wallet_address: input.walletAddress?.trim() || null,
      invited_by: invitedBy,
    })
    .select("*")
    .single();

  if (error) {
    // Lost an insert race for the same email: fetch and return the winner.
    if (error.code === UNIQUE_VIOLATION) {
      const { data: row } = await db
        .from("users")
        .select("*")
        .eq("email", email)
        .single();
      return { created: false, row: row as UserRow };
    }
    throw error;
  }
  return { created: true, row: data as UserRow };
}

// Upsert from a verified Privy identity. Match by privy_did first; otherwise by
// email, which adopts a row created by the pre-auth form; otherwise insert new.
export async function syncFromPrivy(
  identity: {
    privyDid: string;
    email: string | null;
    walletAddress: string | null;
  },
): Promise<UserRow> {
  const db = getSupabaseAdmin();
  const email = normalizeEmail(identity.email);

  // 1) Known Privy user: patch any changed email/wallet.
  const { data: byDid } = await db
    .from("users")
    .select("*")
    .eq("privy_did", identity.privyDid)
    .maybeSingle();
  if (byDid) {
    const patch: Record<string, unknown> = {};
    if (email && byDid.email !== email) patch.email = email;
    if (
      identity.walletAddress &&
      byDid.wallet_address !== identity.walletAddress
    ) {
      patch.wallet_address = identity.walletAddress;
    }
    if (Object.keys(patch).length === 0) return byDid as UserRow;
    const { data, error } = await db
      .from("users")
      .update(patch)
      .eq("id", byDid.id)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("Update failed.");
    return data as UserRow;
  }

  // 2) Existing form row with the same email: adopt it, stamp the Privy DID.
  if (email) {
    const { data: byEmail } = await db
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (byEmail) {
      const { data, error } = await db
        .from("users")
        .update({
          privy_did: identity.privyDid,
          wallet_address: identity.walletAddress ?? byEmail.wallet_address,
        })
        .eq("id", byEmail.id)
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Update failed.");
      return data as UserRow;
    }
  }

  // 3) Brand new: logged in without ever filling the form.
  const { data, error } = await db
    .from("users")
    .insert({
      privy_did: identity.privyDid,
      email,
      wallet_address: identity.walletAddress,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Insert failed.");
  return data as UserRow;
}

export async function approveByEmail(
  email: string,
): Promise<{ row: UserRow; alreadyApproved: boolean } | null> {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const db = getSupabaseAdmin();

  const { data: existing } = await db
    .from("users")
    .select("*")
    .eq("email", norm)
    .maybeSingle();
  if (!existing) return null;
  if (existing.status === "approved") {
    return { row: existing as UserRow, alreadyApproved: true };
  }

  const { data, error } = await db
    .from("users")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Approval failed.");
  return { row: data as UserRow, alreadyApproved: false };
}
