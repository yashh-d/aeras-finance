import { NextResponse } from "next/server";

import { buildCatalog, type LighterCatalog } from "@/lib/lighter/markets";
import { lighterOrderBookDetails } from "@/lib/lighter/server";

export const dynamic = "force-dynamic";

// The Lighter perp market catalog: prices, margin fractions, size and price
// decimals, minimums, funding inputs.
//
// Served through our own route rather than called from the browser because
// Lighter meters unauthenticated callers at 60 weighted requests a minute per
// IP. Fetching from the page would spend that budget per user with no way to
// cache, and would leak every viewer's IP to the exchange.
//
// Upstream needs no authentication, so this works with no wallet connected and
// no keys provisioned.
export async function GET() {
  try {
    const details = await lighterOrderBookDetails();

    const body: LighterCatalog = {
      markets: buildCatalog(details),
      fetchedAt: Date.now(),
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
