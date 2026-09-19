import { NextResponse } from "next/server";

import { xstockByMint } from "@/lib/jupiter/xstocks";
import { authenticate } from "@/lib/privy/auth";
import {
  deleteRun,
  listRuns,
  upsertRun,
  type RunStatus,
  type StrategyKind,
} from "@/lib/strategy-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Strategy run bookkeeping, per user. Same posture as app/api/loops: the
// wallet is never a parameter, it is the embedded Solana wallet on the
// verified identity. See that route for why.

const STRATEGIES = new Set<StrategyKind>(["earn", "leverage", "ladder"]);
const STATUSES = new Set<RunStatus>(["running", "done"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A run's state is a few step snapshots and a few numbers. Anything bigger
// is not a run.
const MAX_STATE_BYTES = 32 * 1024;

type Identity = { privyDid: string; walletAddress: string };

async function identify(request: Request): Promise<Identity | NextResponse> {
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

export async function GET(request: Request) {
  const id = await identify(request);
  if (id instanceof NextResponse) return id;
  try {
    const runs = await listRuns(id.privyDid, id.walletAddress);
    return NextResponse.json({ runs });
  } catch (err) {
    console.error("strategy runs read error", err);
    return NextResponse.json(
      { error: "Could not load your strategy runs." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const id = await identify(request);
  if (id instanceof NextResponse) return id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { id: runId, strategy, mint, status, state } = (body ?? {}) as {
    id?: unknown;
    strategy?: unknown;
    mint?: unknown;
    status?: unknown;
    state?: unknown;
  };

  if (typeof runId !== "string" || !UUID_RE.test(runId)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }
  if (typeof strategy !== "string" || !STRATEGIES.has(strategy as StrategyKind)) {
    return NextResponse.json({ error: "Unknown strategy" }, { status: 400 });
  }
  // Must be a catalog asset. An arbitrary string would let a caller fill the
  // table with rows for assets that do not exist.
  if (typeof mint !== "string" || !xstockByMint(mint)) {
    return NextResponse.json({ error: "Unknown mint" }, { status: 400 });
  }
  if (typeof status !== "string" || !STATUSES.has(status as RunStatus)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }
  if (
    state == null ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    JSON.stringify(state).length > MAX_STATE_BYTES
  ) {
    return NextResponse.json({ error: "state must be a small object" }, { status: 400 });
  }

  try {
    const run = await upsertRun(id.privyDid, id.walletAddress, {
      id: runId,
      strategy: strategy as StrategyKind,
      mint,
      status: status as RunStatus,
      state,
    });
    return NextResponse.json({ run });
  } catch (err) {
    console.error("strategy run write error", err);
    return NextResponse.json(
      { error: "Could not save your strategy run." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const id = await identify(request);
  if (id instanceof NextResponse) return id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const runId = (body as { id?: unknown })?.id;
  if (typeof runId !== "string" || !UUID_RE.test(runId)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }
  try {
    await deleteRun(id.privyDid, id.walletAddress, runId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("strategy run delete error", err);
    return NextResponse.json(
      { error: "Could not clear your strategy run." },
      { status: 502 },
    );
  }
}
