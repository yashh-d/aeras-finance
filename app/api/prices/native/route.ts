import { NextResponse } from "next/server";

import { cgFetch } from "@/lib/jupiter/charts";

export const dynamic = "force-dynamic";

// USD prices for native chain assets.
//
// Jupiter prices Solana mints, so it cannot quote ETH, BNB, or MON held on
// their own chains, and Trustware's balance scan returns no USD values at all.
// This fills that one gap and nothing more: three assets, cached, no key
// required. MON is priced so the Monad balances count toward the portfolio
// total instead of showing as unpriced rows.
//
// **A failure here used to zero out holdings, not just hide a figure.** Every
// caller drops a native holding from its total when the price is missing, so a
// throttled minute upstream took ETH and MON out of the wallet list, the header
// total, and the Portfolio tab's net worth, and put them back 90 seconds later.
// Coingecko's keyless tier is ~30 req/min shared with sparklines and the chart
// proxy, so this is a normal condition rather than an outage. Three things
// follow, and they are the whole design of this file:
//
//   1. Serve from memory within the TTL, so polling costs no upstream calls.
//   2. Serve the last good prices when the fetch fails. A price a few minutes
//      old is worth far more than a balance that reads as zero dollars.
//   3. Go through cgFetch, so a configured COINGECKO_API_KEY actually applies
//      here. It did not: this route built its own public URL.
//
// Only a cold process that has never fetched can fail, and that is the one case
// where there is genuinely nothing to say.

const IDS = "ethereum,binancecoin,monad";

// Native prices move slowly next to how often the wallet scan polls (90s), and
// the upstream limit is the scarce resource.
const TTL_MS = 60_000;

export interface NativePriceMap {
  [coingeckoId: string]: number;
}

const cache: { data: NativePriceMap; fetchedAt: number } = {
  data: {},
  fetchedAt: 0,
};

// Shared so two polls landing together make one upstream call. Bursts are
// exactly what earns a 429.
let inFlight: Promise<NativePriceMap> | null = null;

async function fetchPrices(): Promise<NativePriceMap> {
  const res = await cgFetch("/simple/price", {
    ids: IDS,
    vs_currencies: "usd",
  });
  if (!res.ok) throw new Error(`Native price feed failed: ${res.status}`);
  const body = (await res.json()) as Record<string, { usd?: number }>;
  const prices: NativePriceMap = {};
  for (const [id, entry] of Object.entries(body)) {
    if (typeof entry?.usd === "number") prices[id] = entry.usd;
  }
  if (Object.keys(prices).length === 0) {
    throw new Error("Native price feed returned no prices");
  }
  return prices;
}

export async function GET() {
  const age = Date.now() - cache.fetchedAt;
  if (cache.fetchedAt > 0 && age < TTL_MS) {
    return NextResponse.json(cache.data, {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=60",
        "x-price-age-ms": String(age),
      },
    });
  }

  try {
    inFlight ??= fetchPrices().finally(() => {
      inFlight = null;
    });
    const prices = await inFlight;
    cache.data = prices;
    cache.fetchedAt = Date.now();
    return NextResponse.json(prices, {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=60",
        "x-price-age-ms": "0",
      },
    });
  } catch (err) {
    // Stale beats absent: a caller that loses these prices does not show an
    // unpriced row, it drops the holding out of the total entirely.
    if (cache.fetchedAt > 0) {
      return NextResponse.json(cache.data, {
        headers: {
          "cache-control": "no-store",
          "x-price-age-ms": String(age),
          "x-price-stale": "1",
        },
      });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
