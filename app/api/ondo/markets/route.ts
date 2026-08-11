import { NextResponse } from "next/server";

import { ONDO_ENV } from "@/lib/ondo/constants";
import { buildCatalog, collateralAssets, type OndoCatalog } from "@/lib/ondo/markets";
import { ondoContracts, ondoMarkets } from "@/lib/ondo/server";

export const dynamic = "force-dynamic";

// The Ondo market catalog, joined from the two upstream endpoints that each
// hold half of what sizing needs. Served through our own route rather than
// called from the browser for the same reasons as the Trustware proxies: it
// keeps the builder code server-only, and Ondo returns 403 to requests without
// a browser User-Agent, which is easier to control from the server than from
// fetch in a page.
//
// Unauthenticated upstream, so this works before Ondo issues a builder code.
export async function GET() {
  try {
    const [markets, contracts] = await Promise.all([
      ondoMarkets(),
      ondoContracts(),
    ]);

    const body: OndoCatalog = {
      environment: ONDO_ENV,
      markets: buildCatalog(markets, contracts),
      collateral: collateralAssets(markets),
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
