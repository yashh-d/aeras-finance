import { NextResponse } from "next/server";

import { EARN_ASSETS } from "@/lib/jupiter/earn";

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
// Same stale-while-error policy as the borrow vaults proxy: a transient upstream
// blip should not blank out APYs that were correct 20 seconds ago.
const STALE_GRACE_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 6000;
const UPSTREAM_RETRIES = 2;

async function fetchUpstream(): Promise<RawEarnToken[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= UPSTREAM_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.jup.ag/lend/v1/earn/tokens", {
        cache: "no-store",
        signal: controller.signal,
        headers: { "user-agent": "aeras-finance/0.1" },
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`upstream ${res.status}`);
      }
      return (await res.json()) as RawEarnToken[];
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      // 100, 250 ms backoff before retrying.
      if (attempt < UPSTREAM_RETRIES) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1) ** 2));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Jupiter earn tokens: ${String(lastErr)}`);
}

async function loadTokens(): Promise<RawEarnToken[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.tokens;
  }
  try {
    const tokens = await fetchUpstream();
    cache = { fetchedAt: Date.now(), tokens };
    return tokens;
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[earn tokens proxy] upstream failed, serving stale:", err);
      return cache.tokens;
    }
    throw err;
  }
}

export async function GET() {
  try {
    const tokens = await loadTokens();
    // Filter to the curated set so the client can never be handed a vault we
    // have not verified.
    return NextResponse.json(
      tokens.filter((t) => ALLOWED_ASSET_MINTS.has(t.assetAddress)),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
