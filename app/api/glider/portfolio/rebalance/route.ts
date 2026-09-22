import { NextResponse } from "next/server";

import { gliderErrorResponse, identifyForGlider } from "@/lib/glider/route-identity";
import { findPortfolio, startAndRebalance } from "@/lib/glider/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ask Glider to buy the holdings now, after a deposit has landed in the
// smart account. Refusals for cooldown come back as data, with the wait.
export async function POST(request: Request) {
  const id = await identifyForGlider(request);
  if (id instanceof NextResponse) return id;
  try {
    const record = await findPortfolio(id.evmAddress);
    if (!record) {
      return NextResponse.json({ error: "No Mag7X portfolio on this account." }, { status: 404 });
    }
    const result = await startAndRebalance(record.portfolioId);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return gliderErrorResponse(err);
  }
}
