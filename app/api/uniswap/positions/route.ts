import { NextResponse } from "next/server";

import { authenticate } from "@/lib/privy/auth";
import { isUniswapChainId, type UniswapChainId } from "@/lib/uniswap/pools";
import {
  closePositions,
  listOpenPositions,
  recordPosition,
} from "@/lib/uniswap/positions-store";
import {
  positionFromReceipt,
  readPositions,
  type UniswapPositionView,
  type WalletBalances,
} from "@/lib/uniswap/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A user's Uniswap positions with their live state, and the wallet's
// balances of every registry token on every chain. The wallet is never a
// parameter: it is the embedded EVM wallet on the verified identity, the
// same posture as app/api/strategies/runs.
//
// POST records the position a mint created, from its receipt (D8): the
// client names the chain and the transaction hash and nothing else; the
// token id, pool and ticks are read from the chain.

export interface UniswapPositionsPayload {
  positions: UniswapPositionView[];
  balances: Partial<Record<UniswapChainId, WalletBalances>>;
  prices: Record<string, number>;
  readAt: number;
}

export type { UniswapPositionView, WalletBalances };

const cache = new Map<string, { fetchedAt: number; body: UniswapPositionsPayload }>();
const CACHE_TTL_MS = 5_000;
const STALE_GRACE_MS = 5 * 60_000;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

type Identity = { privyDid: string; evm: string };

async function identify(request: Request): Promise<Identity | NextResponse> {
  const identity = await authenticate(request);
  if (!identity) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!identity.embedded.evm) {
    return NextResponse.json({ error: "No EVM wallet has been provisioned on this account yet." }, { status: 409 });
  }
  return { privyDid: identity.privyDid, evm: identity.embedded.evm };
}

export async function GET(request: Request) {
  const id = await identify(request);
  if (id instanceof NextResponse) return id;
  const key = id.evm.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.body);
  }
  try {
    const stored = await listOpenPositions(id.privyDid, id.evm).catch((err) => {
      // A store outage costs the v4 rows, not the read: v3 positions still
      // enumerate and balances still read.
      console.error("[uniswap positions] store read failed:", err);
      return [];
    });
    const read = await readPositions(id.evm, stored);
    if (read.closed.length > 0) {
      closePositions(id.privyDid, id.evm, read.closed).catch((err) =>
        console.error("[uniswap positions] close failed:", err),
      );
    }
    const body: UniswapPositionsPayload = {
      positions: read.positions,
      balances: read.balances,
      prices: Object.fromEntries(read.prices),
      readAt: Date.now(),
    };
    cache.set(key, { fetchedAt: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[uniswap positions] read failed, serving stale:", err);
      return NextResponse.json(cached.body, { headers: { "x-aeras-stale": "1" } });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
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
  const { chainId, txHash } = (body ?? {}) as { chainId?: unknown; txHash?: unknown };
  if (typeof chainId !== "number" || !isUniswapChainId(chainId)) {
    return NextResponse.json({ error: "Unknown chain" }, { status: 400 });
  }
  if (typeof txHash !== "string" || !TX_HASH.test(txHash)) {
    return NextResponse.json({ error: "txHash must be a transaction hash" }, { status: 400 });
  }

  let read: Awaited<ReturnType<typeof positionFromReceipt>>;
  try {
    read = await positionFromReceipt(chainId, txHash, id.evm);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (read.kind === "pending") {
    return NextResponse.json({ error: "The transaction has not mined yet.", pending: true }, { status: 409 });
  }
  if (read.kind === "failed") {
    return NextResponse.json({ error: "The transaction failed on chain." }, { status: 400 });
  }
  if (read.kind === "none") {
    return NextResponse.json({ error: read.reason }, { status: 400 });
  }
  try {
    await recordPosition(id.privyDid, id.evm, read.position);
  } catch (err) {
    console.error("[uniswap positions] record failed:", err);
    return NextResponse.json({ error: "Could not save the position. It is on chain; try again." }, { status: 502 });
  }
  cache.delete(id.evm.toLowerCase());
  return NextResponse.json({ position: read.position });
}
