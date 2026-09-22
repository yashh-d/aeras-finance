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
//
// Deliberately NOT authenticated, and deliberately does not pin the payout
// address the way the sibling /route does. This returns a price and no signable
// transaction, so a caller who lies about the destination gets back a number
// and nothing else. It is called on a timer behind every preview, and putting a
// Privy user lookup in that path would cost a round trip per keystroke for no
// security gain. Its use of an API key by an anonymous caller is a separate
// problem from this one, and belongs with the other unauthenticated proxies.
export async function POST(request: Request) {
  let req: Partial<TrustwareQuoteRequest>;
  try {
    req = (await request.json()) as Partial<TrustwareQuoteRequest>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const validation = validateTrustwareRequest(req);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
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
