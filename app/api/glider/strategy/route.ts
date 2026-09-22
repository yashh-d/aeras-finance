import { NextResponse } from "next/server";

import { loadStrategy } from "@/lib/glider/strategy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Bitwise Mag7X strategy as the Markets card shows it: holdings and
// weights, the boost campaign, TVL, users and performance. Public and
// keyless; nothing here is about a user. Cached a minute, served stale for
// thirty past that with the same header the price proxy uses.
export async function GET() {
  try {
    const { view, stale } = await loadStrategy();
    return NextResponse.json(view, {
      headers: {
        "cache-control": "public, max-age=30, s-maxage=30",
        ...(stale ? { "x-aeras-stale": "1" } : {}),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503, headers: { "retry-after": "20" } });
  }
}
