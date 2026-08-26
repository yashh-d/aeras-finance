import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// USD prices for native chain assets.
//
// Jupiter prices Solana mints, so it cannot quote ETH, BNB, or MON held on
// their own chains, and Trustware's balance scan returns no USD values at all.
// This fills that one gap and nothing more: three assets, cached, no key
// required. MON is priced so the Monad balances count toward the portfolio
// total instead of showing as unpriced rows.
//
// A failure here is not fatal. The wallet shows the balance without a dollar
// figure rather than hiding the holding.
const COINGECKO =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin,monad&vs_currencies=usd";

export interface NativePriceMap {
  [coingeckoId: string]: number;
}

export async function GET() {
  try {
    const res = await fetch(COINGECKO, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Native price feed failed: ${res.status}` },
        { status: 502 },
      );
    }
    const body = (await res.json()) as Record<string, { usd?: number }>;
    const prices: NativePriceMap = {};
    for (const [id, entry] of Object.entries(body)) {
      if (typeof entry?.usd === "number") prices[id] = entry.usd;
    }
    return NextResponse.json(prices, {
      // These move slowly relative to how often the panel refreshes, and the
      // upstream is rate limited on the free tier.
      headers: { "cache-control": "public, max-age=60, s-maxage=60" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
