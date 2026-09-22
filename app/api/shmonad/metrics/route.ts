import { NextResponse } from "next/server";

import { readShmonMetrics, type ShmonMetrics } from "@/lib/shmonad/server";

export const dynamic = "force-dynamic";

// Live shMON metrics: exchange rate, APY from share price growth, the
// instant-exit pool and fee, TVL. One payload for every surface that draws
// the venue (the Earn card, the positions rows, the Buy + Earn option).
//
// Cached for five minutes: the rate moves once an epoch (about 5.5 hours)
// and the fee with pool utilization, neither of which a user acts on to the
// minute. Served stale for thirty minutes past that with `x-aeras-stale: 1`
// rather than blanking the card through an RPC blip, the same treatment the
// Lend and price proxies got.

let cache: { fetchedAt: number; metrics: ShmonMetrics } | null = null;
const CACHE_TTL_MS = 5 * 60_000;
const STALE_GRACE_MS = 30 * 60_000;

export type { ShmonMetrics };

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.metrics);
  }
  try {
    const metrics = await readShmonMetrics();
    cache = { fetchedAt: Date.now(), metrics };
    return NextResponse.json(metrics);
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[shmonad metrics] read failed, serving stale:", err);
      return NextResponse.json(cache.metrics, { headers: { "x-aeras-stale": "1" } });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
