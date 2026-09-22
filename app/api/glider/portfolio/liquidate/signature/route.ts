import { NextResponse } from "next/server";

import { gliderErrorResponse, identifyForGlider } from "@/lib/glider/route-identity";
import { findPortfolio, GliderError, prepareLiquidateAll } from "@/lib/glider/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stage 1 of leaving Mag7X: the EIP-712 authorization that sells every
// holding to USDC on Base and delivers it to the user's OWN embedded wallet.
// The recipient is pinned here from the verified identity and is not a
// parameter, the mirror of the deposit guard in app/api/trustware/route.
export async function POST(request: Request) {
  const id = await identifyForGlider(request);
  if (id instanceof NextResponse) return id;
  try {
    const record = await findPortfolio(id.evmAddress);
    if (!record) {
      return NextResponse.json({ error: "No Mag7X portfolio on this account." }, { status: 404 });
    }
    const prepared = await prepareLiquidateAll(record.portfolioId, id.evmAddress);
    return NextResponse.json(prepared);
  } catch (err) {
    if (err instanceof GliderError && err.code === "API_220") {
      // Glider names the threshold in its message ("5 USD" on this tenant,
      // measured 2026-09-22), so that is passed through rather than restated.
      return NextResponse.json(
        { error: `Nothing in the portfolio is above Glider's swap threshold, so there is nothing to sell. ${err.message}`, code: err.code },
        { status: 409 },
      );
    }
    return gliderErrorResponse(err);
  }
}
