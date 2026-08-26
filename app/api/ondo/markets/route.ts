import { NextResponse } from "next/server";

import {
  creditableCollateral,
  type OndoCatalogWithCollateral,
} from "@/lib/ondo/collateral";
import { ONDO_ENV } from "@/lib/ondo/constants";
import { buildCatalog, collateralAssets } from "@/lib/ondo/markets";
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

    const joined = buildCatalog(markets, contracts);
    const collateral = collateralAssets(markets);

    const body: OndoCatalogWithCollateral = {
      environment: ONDO_ENV,
      markets: joined,
      collateral,
      // What Ondo actually credits as margin, joined to the market each asset
      // is marked against. Discovered from the live token config rather than
      // hardcoded: Ondo added three collateral assets in August 2026 without
      // updating their docs, and a fixed list would have refused them.
      creditable: creditableCollateral(collateral, joined),
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
