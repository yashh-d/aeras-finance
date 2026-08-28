import { NextResponse } from "next/server";

import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";
import {
  deleteLoopRecord,
  listLoopRecords,
  upsertLoopRecord,
  type BasisMode,
} from "@/lib/loops";
import { authenticate } from "@/lib/privy/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loop bookkeeping: which vaults hold a leveraged position, and what went into
// them. Display-only data, but it is still per-user, so every method verifies
// the Privy token and scopes to that identity.
//
// **The wallet is not a parameter.** It is the embedded Solana wallet on the
// verified identity, resolved here. A `wallet` field in the body or query would
// let any signed-in user read and overwrite another user's records by naming
// their address, and the address is public. This is the same argument as the
// withdrawal destination in app/api/ondo/address-book/challenge.

const KNOWN_VAULT_IDS = new Set(XSTOCK_BORROW_VAULTS.map((v) => v.vaultId));

// A loop's equity is a wallet balance, not an arbitrary number. The bound is
// loose on purpose — it is here to reject nonsense and overflow, not to express
// a product limit.
const MAX_BASIS_USD = 100_000_000;

type Identity = { privyDid: string; walletAddress: string };

async function identify(
  request: Request,
): Promise<Identity | NextResponse> {
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
  return { privyDid: identity.privyDid, walletAddress: identity.walletAddress };
}

function readVaultId(value: unknown): number | null {
  // Must be one of ours. An arbitrary integer would let a caller fill the table
  // with rows for vaults that do not exist.
  return typeof value === "number" &&
    Number.isInteger(value) &&
    KNOWN_VAULT_IDS.has(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  const id = await identify(request);
  if (id instanceof NextResponse) return id;

  try {
    const records = await listLoopRecords(id.privyDid, id.walletAddress);
    return NextResponse.json({ records });
  } catch (err) {
    console.error("loop records read error", err);
    return NextResponse.json(
      { error: "Could not load your loop positions." },
      { status: 502 },
    );
  }
}

// Upsert. Called after a loop opens, and once per browser to carry a legacy
// localStorage flag up to the server.
export async function POST(request: Request) {
  const id = await identify(request);
  if (id instanceof NextResponse) return id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    vaultId: rawVaultId,
    basisUsd: rawBasis,
    mode: rawMode,
  } = (body ?? {}) as {
    vaultId?: unknown;
    basisUsd?: unknown;
    mode?: unknown;
  };

  // "add" accumulates (a loop was opened); "seed" fills only a missing basis
  // (a legacy local record being carried up). Defaulting to "seed" is the safe
  // side: a mislabelled add under-reports a gain, a mislabelled seed invents one.
  const mode: BasisMode = rawMode === "add" ? "add" : "seed";

  const vaultId = readVaultId(rawVaultId);
  if (vaultId == null) {
    return NextResponse.json({ error: "Unknown vaultId" }, { status: 400 });
  }

  // Null is meaningful and distinct from absent: it records a loop whose basis
  // is genuinely unknown, which renders as no P&L rather than a wrong one.
  let basisUsd: number | null = null;
  if (rawBasis != null) {
    if (
      typeof rawBasis !== "number" ||
      !Number.isFinite(rawBasis) ||
      rawBasis <= 0 ||
      rawBasis > MAX_BASIS_USD
    ) {
      return NextResponse.json(
        { error: "basisUsd must be a positive number, or null" },
        { status: 400 },
      );
    }
    basisUsd = rawBasis;
  }

  try {
    const record = await upsertLoopRecord(
      id.privyDid,
      id.walletAddress,
      vaultId,
      basisUsd,
      mode,
    );
    return NextResponse.json({ record });
  } catch (err) {
    console.error("loop record write error", err);
    return NextResponse.json(
      { error: "Could not save your loop position." },
      { status: 502 },
    );
  }
}

// Called when a loop is unwound.
export async function DELETE(request: Request) {
  const id = await identify(request);
  if (id instanceof NextResponse) return id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const vaultId = readVaultId((body as { vaultId?: unknown })?.vaultId);
  if (vaultId == null) {
    return NextResponse.json({ error: "Unknown vaultId" }, { status: 400 });
  }

  try {
    await deleteLoopRecord(id.privyDid, id.walletAddress, vaultId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("loop record delete error", err);
    return NextResponse.json(
      { error: "Could not clear your loop position." },
      { status: 502 },
    );
  }
}
