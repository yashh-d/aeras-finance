import { NextResponse } from "next/server";

import { buildCatalog } from "@/lib/rysk/catalog";
import { ryskAssets, ryskInventory } from "@/lib/rysk/server";
import type { RyskCatalog } from "@/lib/rysk/types";

export const dynamic = "force-dynamic";

// The Rysk option chain: every listed strike and expiry per underlying, with
// delta, an indicative APY and the collateral each strike can be written
// against.
//
// Served through our own route because Rysk sends no Access-Control-Allow-Origin
// header, so the browser cannot read their API at all. The two upstream calls
// are joined here rather than in the client because inventory refers to tokens
// by bare address and only the assets response can name them.
//
// Upstream needs no authentication, so this works with no wallet connected. It
// is read-only: nothing here can open a position.
export async function GET() {
  try {
    const [assets, inventory] = await Promise.all([
      ryskAssets(),
      ryskInventory(),
    ]);

    const body: RyskCatalog = buildCatalog(assets, inventory);
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
