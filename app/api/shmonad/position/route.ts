import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { readShmonPosition, type ShmonPosition } from "@/lib/shmonad/server";

export const dynamic = "force-dynamic";

// A wallet's shMON position, what each exit would pay for it now, its native
// MON balance, and the state of its one queued exit. Per-address cache with
// stale-while-error, matching app/api/morpho/position: the TTL is short so a
// stake flow's arrival poll sees a fresh balance quickly, the grace keeps the
// card alive through an RPC blip.

const cache = new Map<string, { fetchedAt: number; body: ShmonPosition }>();
const CACHE_TTL_MS = 5_000;
const STALE_GRACE_MS = 5 * 60_000;

export type { ShmonPosition };

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "a valid EVM address is required" }, { status: 400 });
  }
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.body);
  }
  try {
    const body = await readShmonPosition(address);
    cache.set(key, { fetchedAt: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[shmonad position] read failed, serving stale:", err);
      return NextResponse.json(cached.body, { headers: { "x-aeras-stale": "1" } });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
