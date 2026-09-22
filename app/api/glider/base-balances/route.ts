import { NextResponse } from "next/server";

import { readBaseBalances } from "@/lib/glider/base-server";
import { identifyForGlider } from "@/lib/glider/route-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The embedded EVM wallet's USDC and ETH on Base, for the exit flow: USDC is
// what a liquidation delivers, ETH is what the leg home needs for gas. Read
// for the identity's own wallet only.
export async function GET(request: Request) {
  const id = await identifyForGlider(request);
  if (id instanceof NextResponse) return id;
  try {
    const balances = await readBaseBalances(id.evmAddress);
    return NextResponse.json({
      address: id.evmAddress,
      ...balances,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
