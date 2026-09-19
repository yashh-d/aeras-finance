import { NextResponse } from "next/server";

import { readAaveMetrics, type AaveVaultMetric } from "@/lib/aave/server";

export const dynamic = "force-dynamic";

// Live rates and TVL for the curated Aave vaults, read from Ethereum. Cached
// with stale-while-error, matching the Morpho metrics route: the Earn table
// polls this once a minute and a public RPC blip should not blank the column.
let cache: { fetchedAt: number; metrics: AaveVaultMetric[] } | null = null;
const CACHE_TTL_MS = 60_000;
const STALE_GRACE_MS = 5 * 60_000;

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ metrics: cache.metrics });
  }
  try {
    const metrics = await readAaveMetrics();
    cache = { fetchedAt: Date.now(), metrics };
    return NextResponse.json({ metrics });
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[aave metrics] read failed, serving stale:", err);
      return NextResponse.json({ metrics: cache.metrics });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export type { AaveVaultMetric, AaveRewardStream } from "@/lib/aave/server";
