import { NextResponse } from "next/server";

import { EARN_ASSETS } from "@/lib/jupiter/earn";
import {
  LendUpstreamError,
  fetchLendJson,
  lendCooldownMs,
} from "@/lib/jupiter/lend-server";

export const dynamic = "force-dynamic";

const ALLOWED_ASSET_MINTS = new Set(EARN_ASSETS.map((a) => a.assetMint));

// Only the fields lib/jupiter/earn.ts reads. The upstream payload is much larger.
interface RawEarnToken {
  id: number;
  address: string;
  assetAddress: string;
  decimals: number;
  supplyRate?: string;
  rewardsRate?: string;
  totalRate?: string;
  totalAssets?: string;
  convertToAssets?: string;
  asset?: { price?: string };
  liquiditySupplyData?: { withdrawable?: string };
}

let cache: { fetchedAt: number; tokens: RawEarnToken[] } | null = null;
const CACHE_TTL_MS = 15_000;
// Stale-while-error: a cached payload keeps being served for this long past
// the TTL while upstream is failing. Thirty minutes, because Jupiter's Lend
// backend has been unreachable for longer than five (2026-09-09), and a rate
// that was right half an hour ago beats a blank card. The response says when
// it is stale (see GET) so a client can tell.
const STALE_GRACE_MS = 30 * 60 * 1000;

async function loadTokens(): Promise<{ tokens: RawEarnToken[]; stale: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { tokens: cache.tokens, stale: false };
  }
  try {
    // One attempt with the API key, a circuit while the origin is down, and
    // no retry on a timeout. See lib/jupiter/lend-server.ts.
    const tokens = await fetchLendJson<RawEarnToken[]>("/earn/tokens");
    cache = { fetchedAt: Date.now(), tokens };
    return { tokens, stale: false };
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      // Only say so once per failure, not once per poll while the circuit is
      // open.
      if (!(err instanceof LendUpstreamError && err.circuitOpen)) {
        console.warn("[earn tokens proxy] upstream failed, serving stale:", err);
      }
      return { tokens: cache.tokens, stale: true };
    }
    throw err;
  }
}

export async function GET() {
  try {
    const { tokens, stale } = await loadTokens();
    // Filter to the curated set so the client can never be handed a vault we
    // have not verified.
    return NextResponse.json(
      tokens.filter((t) => ALLOWED_ASSET_MINTS.has(t.assetAddress)),
      { headers: stale ? { "x-aeras-stale": "1" } : undefined },
    );
  } catch (err) {
    // Nothing cached and upstream is down. 503 with a Retry-After matching
    // the circuit, so a client that reads it can wait rather than hammer.
    const msg = err instanceof Error ? err.message : String(err);
    const retry = Math.max(1, Math.ceil(lendCooldownMs("/earn/tokens") / 1000));
    return NextResponse.json(
      { error: msg },
      { status: 503, headers: { "retry-after": String(retry) } },
    );
  }
}
