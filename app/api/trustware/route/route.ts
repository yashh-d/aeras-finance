import { NextResponse } from "next/server";

import {
  trustwareRoute,
  validateTrustwareRequest,
} from "@/lib/trustware/server";
import { TRUSTWARE_DEFAULT_SLIPPAGE } from "@/lib/trustware/constants";
import type { TrustwareQuoteRequest } from "@/lib/trustware/types";

export const dynamic = "force-dynamic";

// Build an executable route (intentId + txReq) for a cross-chain conversion into
// a Solana xStock. Same allowlist as /quote. Still signs nothing here: the
// returned txReq is signed client-side by the Privy EVM wallet.
export async function POST(request: Request) {
  let req: Partial<TrustwareQuoteRequest>;
  try {
    req = (await request.json()) as Partial<TrustwareQuoteRequest>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const invalid = validateTrustwareRequest(req);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  try {
    const route = await trustwareRoute({
      ...(req as TrustwareQuoteRequest),
      slippage: req.slippage ?? TRUSTWARE_DEFAULT_SLIPPAGE,
    });
    return NextResponse.json(route);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
