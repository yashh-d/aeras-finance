"use client";

// Browser half of the position-setup log. Pairs with lib/position-setup.ts.
//
// Write-only, and best-effort by design. This records that a user paid account
// rent to open a position; the position is already open by the time it runs.
// Bookkeeping must never be able to fail a borrow, or report one as failed, so
// every error is swallowed after being logged. A missing row costs an analyst
// one data point. A thrown error here would cost the user their confirmation
// screen on a loan that actually settled.
//
// There is no read function. Whether to show the setup sheet is decided by
// reading the accounts on chain. See the head of
// supabase/migrations/0003_position_setup.sql for why that separation is load
// bearing rather than stylistic.

import type { SetupCost } from "@/lib/borrow/setup-cost";
import type {
  PrivyFundingMethod,
  SetupFunding,
} from "@/components/FirstPositionSheet";

export type SetupVenue = "kamino" | "jupiter";
export type SetupFundedVia =
  // Already held enough SOL.
  | "existing_balance"
  // Swapped USDC they already held, through Jupiter Ultra.
  | "usdc_swap"
  // Sold part of the collateral they were about to deposit, through Jupiter
  // Ultra. Kept apart from usdc_swap because it is the only route that costs
  // the user position size rather than idle cash.
  | "collateral_sale"
  // Got SOL through Privy's hosted funding flow, whatever method they picked.
  // Distinct from usdc_swap because it means the wallet held no usable money at
  // all and the user had to bring some in from outside. Which route they took
  // is fundingMethod, not this: a card and a transfer from another wallet are
  // very different experiences and the difference is worth keeping.
  | "privy_funding";

// What the borrow cards hold between the sheet closing and the position
// settling. Assembled when the user gets past the sheet, written once the
// borrow lands, so an abandoned or failed open records nothing.
export interface PendingSetupRecord {
  venue: SetupVenue;
  rentLamports: number;
  feeLamports: number;
  // Which Privy method brought the SOL in, when funded_via is privy_funding.
  // Null when the user closed the flow before choosing, which can still end in
  // a funded wallet if money was already on its way.
  fundingMethod?: PrivyFundingMethod;
  fundedVia: SetupFundedVia;
  fundingUsd?: number;
  fundingSignature?: string;
}

// Build the record from the priced cost the sheet showed, so the row carries the
// figures the user actually saw rather than a second estimate.
export function pendingRecordFor(
  venue: SetupVenue,
  cost: SetupCost,
  funding?: SetupFunding,
): PendingSetupRecord {
  return {
    venue,
    rentLamports: cost.rentLamports,
    feeLamports: cost.feeLamports,
    fundedVia: funding?.via ?? "existing_balance",
    // Only a swap has these. Funding from outside spends no USDC we can see and
    // produces no signature we own, so both stay absent and the database's
    // shape constraint holds.
    fundingUsd:
      funding?.via === "usdc_swap"
        ? funding.usdc
        : funding?.via === "collateral_sale"
          ? funding.usd
          : undefined,
    fundingSignature:
      funding?.via === "usdc_swap" || funding?.via === "collateral_sale"
        ? funding.signature
        : undefined,
    fundingMethod:
      funding?.via === "privy_funding" ? funding.method : undefined,
  };
}

type Token = () => Promise<string | null>;

export async function recordPositionSetup(
  getAccessToken: Token,
  record: PendingSetupRecord,
): Promise<void> {
  try {
    const token = await getAccessToken();
    const res = await fetch("/api/position-setup", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(record),
      cache: "no-store",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      console.error(
        "[position setup] not recorded:",
        data.error ?? res.status,
      );
    }
  } catch (err) {
    console.error("[position setup] not recorded:", err);
  }
}
