import { NextResponse } from "next/server";

import { authenticate } from "@/lib/privy/auth";
import {
  recordPositionSetup,
  type SetupFundedVia,
  type SetupVenue,
} from "@/lib/position-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Records the one-time account rent a user paid to open a position. Per-user
// data, so the Privy token is verified and the row is scoped to that identity.
//
// **POST only, deliberately.** There is no GET because nothing in the app may
// read this: the setup sheet is gated on reading the accounts on chain, never on
// a row here. See the head of supabase/migrations/0003_position_setup.sql.
// Analysis runs against the table directly.
//
// **The wallet is not a parameter.** It is the embedded Solana wallet on the
// verified identity, resolved here, for the same reason app/api/loops/route.ts
// gives: the address is public, so accepting one would let any signed-in user
// write rows against somebody else's wallet.

const VENUES = new Set<SetupVenue>(["kamino", "jupiter"]);
const FUNDING = new Set<SetupFundedVia>([
  "existing_balance",
  "usdc_swap",
  "collateral_sale",
  "privy_funding",
]);

// Exactly what Privy's onUserExited can report. Validated rather than passed
// through so a client cannot write free text into an analytics column.
const METHODS = new Set(["moonpay", "coinbase-onramp", "external", "manual"]);

// Loose bounds, there to reject nonsense and overflow rather than to express a
// product limit. The largest real setup today is ~30.5 million lamports.
const MAX_LAMPORTS = 10_000_000_000; // 10 SOL
const MAX_USDC = 1_000_000;

export async function POST(request: Request) {
  const identity = await authenticate(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (!identity.walletAddress) {
    return NextResponse.json(
      { error: "No embedded wallet on this account yet." },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    venue,
    rentLamports,
    feeLamports,
    fundedVia,
    fundingUsd,
    fundingSignature,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof venue !== "string" || !VENUES.has(venue as SetupVenue)) {
    return NextResponse.json({ error: "Unknown venue" }, { status: 400 });
  }
  if (
    typeof fundedVia !== "string" ||
    !FUNDING.has(fundedVia as SetupFundedVia)
  ) {
    return NextResponse.json({ error: "Unknown fundedVia" }, { status: 400 });
  }
  if (
    typeof rentLamports !== "number" ||
    !Number.isInteger(rentLamports) ||
    rentLamports <= 0 ||
    rentLamports > MAX_LAMPORTS
  ) {
    return NextResponse.json(
      { error: "rentLamports must be a positive integer" },
      { status: 400 },
    );
  }
  if (
    typeof feeLamports !== "number" ||
    !Number.isInteger(feeLamports) ||
    feeLamports < 0 ||
    feeLamports > MAX_LAMPORTS
  ) {
    return NextResponse.json(
      { error: "feeLamports must be a non-negative integer" },
      { status: 400 },
    );
  }

  const swap = fundedVia === "usdc_swap" || fundedVia === "collateral_sale";
  let usdc: number | null = null;
  if (swap) {
    if (
      typeof fundingUsd !== "number" ||
      !Number.isFinite(fundingUsd) ||
      fundingUsd <= 0 ||
      fundingUsd > MAX_USDC
    ) {
      return NextResponse.json(
        { error: "fundingUsd must be a positive number when something was sold" },
        { status: 400 },
      );
    }
    usdc = fundingUsd;
  }

  // Unrecognised or absent is recorded as null, not rejected: the method is an
  // analytics detail and a funded position is still worth a row without it.
  const { fundingMethod } = (body ?? {}) as Record<string, unknown>;
  const method =
    fundedVia === "privy_funding" &&
    typeof fundingMethod === "string" &&
    METHODS.has(fundingMethod)
      ? (fundingMethod as "moonpay" | "coinbase-onramp" | "external" | "manual")
      : null;

  try {
    await recordPositionSetup(identity.privyDid, identity.walletAddress, {
      venue: venue as SetupVenue,
      rentLamports,
      feeLamports,
      fundedVia: fundedVia as SetupFundedVia,
      fundingUsd: usdc,
      fundingSignature:
        swap && typeof fundingSignature === "string" ? fundingSignature : null,
      fundingMethod: method,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("position setup write error", err);
    return NextResponse.json(
      { error: "Could not record this setup." },
      { status: 502 },
    );
  }
}
