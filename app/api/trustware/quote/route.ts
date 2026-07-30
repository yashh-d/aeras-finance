import { NextResponse } from "next/server";

import {
  trustwareQuote,
  validateTrustwareRequest,
} from "@/lib/trustware/server";
import { TRUSTWARE_DEFAULT_SLIPPAGE } from "@/lib/trustware/constants";
import type { TrustwareQuoteRequest } from "@/lib/trustware/types";

export const dynamic = "force-dynamic";

// Read-only price quote for a cross-chain conversion into a Solana xStock. Signs
// nothing and moves nothing. The API key is injected server-side; the client
// only ever hits this proxy.
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
    const quote = await trustwareQuote({
      ...(req as TrustwareQuoteRequest),
      slippage: req.slippage ?? TRUSTWARE_DEFAULT_SLIPPAGE,
    });
    return NextResponse.json(quote);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
