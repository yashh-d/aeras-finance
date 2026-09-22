import { NextResponse } from "next/server";

import { gliderErrorResponse, identifyForGlider } from "@/lib/glider/route-identity";
import { baseAccountId, findPortfolio, submitLiquidateAll } from "@/lib/glider/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

// Stage 2: the signed authorization goes back to Glider byte-for-byte. Two
// fields of the message are checked against the identity before it is
// forwarded, so a message that was not prepared for this user's own wallet
// is refused here with a readable reason rather than by Glider's signature
// check with an opaque one.
export async function POST(request: Request) {
  const id = await identifyForGlider(request);
  if (id instanceof NextResponse) return id;

  let body: { message?: unknown; signature?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { message, signature } = body;
  if (typeof signature !== "string" || !HEX_SIGNATURE.test(signature)) {
    return NextResponse.json({ error: "signature must be a 65-byte hex string" }, { status: 400 });
  }
  if (!message || typeof message !== "object") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const m = message as { portfolioId?: unknown; recipientAccountId?: unknown; liquidate?: unknown };

  try {
    const record = await findPortfolio(id.evmAddress);
    if (!record) {
      return NextResponse.json({ error: "No Mag7X portfolio on this account." }, { status: 404 });
    }
    if (m.portfolioId !== record.portfolioId) {
      return NextResponse.json({ error: "That authorization is for a different portfolio." }, { status: 409 });
    }
    if (typeof m.recipientAccountId !== "string" || m.recipientAccountId.toLowerCase() !== baseAccountId(id.evmAddress)) {
      return NextResponse.json({ error: "That authorization does not pay out to your own wallet." }, { status: 409 });
    }
    if (m.liquidate !== true) {
      return NextResponse.json({ error: "That authorization is not a liquidation." }, { status: 409 });
    }
    const result = await submitLiquidateAll(record.portfolioId, message, signature);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return gliderErrorResponse(err);
  }
}
