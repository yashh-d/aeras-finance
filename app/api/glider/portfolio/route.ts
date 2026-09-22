import { NextResponse } from "next/server";

import { gliderErrorResponse, identifyForGlider } from "@/lib/glider/route-identity";
import { buildPortfolioView, findPortfolio, gliderKeyConfigured } from "@/lib/glider/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This user's Mag7X portfolio with live positions and performance, or null.
// Null is the ordinary state for someone who has never enrolled, and also
// the answer while the server has no key, so the card can draw the same
// "not enrolled" ticket in both cases and say which in its copy.
export async function GET(request: Request) {
  const id = await identifyForGlider(request);
  if (id instanceof NextResponse) return id;
  if (!gliderKeyConfigured()) {
    return NextResponse.json({ portfolio: null, keyConfigured: false });
  }
  try {
    const record = await findPortfolio(id.evmAddress);
    if (!record) return NextResponse.json({ portfolio: null, keyConfigured: true });
    const view = await buildPortfolioView(record);
    return NextResponse.json({ portfolio: view, keyConfigured: true });
  } catch (err) {
    return gliderErrorResponse(err);
  }
}
