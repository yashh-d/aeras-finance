import { NextResponse } from "next/server";

import { gliderErrorResponse, identifyForGlider } from "@/lib/glider/route-identity";
import { fetchOperation, findPortfolio } from "@/lib/glider/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPERATION_ID = /^[A-Za-z0-9_:%\-.]{1,200}$/;

// Poll one operation (a rebalance, a liquidation) on this user's portfolio.
export async function GET(request: Request) {
  const id = await identifyForGlider(request);
  if (id instanceof NextResponse) return id;
  const operationId = new URL(request.url).searchParams.get("id") ?? "";
  if (!OPERATION_ID.test(operationId)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    const record = await findPortfolio(id.evmAddress);
    if (!record) {
      return NextResponse.json({ error: "No Mag7X portfolio on this account." }, { status: 404 });
    }
    const op = await fetchOperation(record.portfolioId, operationId);
    return NextResponse.json(op);
  } catch (err) {
    return gliderErrorResponse(err);
  }
}
