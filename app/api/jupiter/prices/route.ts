import { NextResponse } from "next/server";

import { SOL_MINT } from "@/lib/jupiter/constants";
import {
  PRICE_CIRCUIT_KEY,
  circuitCooldownMs,
  fetchJupiterPrices,
} from "@/lib/jupiter/price-server";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import { SOLANA_EQUIVALENT_TOKENS } from "@/lib/solana/equivalent-tokens";
import { UpstreamError } from "@/lib/upstream";

export const dynamic = "force-dynamic";

// SOL is included so the client can render gas-lamport fees in USD. The Ondo
// mints are priced so a held balance shows a USD value like every other row;
// their liquidity is thin, so the price can sit a few percent off the
// equivalent xStock.
const MINTS = [
  ...XSTOCKS.map((x) => x.mint),
  ...SOLANA_EQUIVALENT_TOKENS.map((t) => t.mint),
  SOL_MINT,
];

// Shorter than the client's 10-second poll, so a poll that arrives just after
// the TTL still gets fresh data rather than one that is a poll behind, while
// two clients polling out of phase share most calls.
const CACHE_TTL_MS = 5_000;

// Stale-while-error. Prices move, so this is far shorter than the thirty
// minutes the Lend rates get: a rate that is half an hour old is still roughly
// the rate, but a price that is half an hour old is a number someone might
// trade against. Three minutes is long enough to ride out the circuit and a
// few failed polls, short enough that nothing priced off it is badly wrong,
// and the response says it is stale either way.
const STALE_GRACE_MS = 3 * 60 * 1000;

let cache: { fetchedAt: number; prices: JupiterPriceMap } | null = null;

async function loadPrices(): Promise<{ prices: JupiterPriceMap; stale: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { prices: cache.prices, stale: false };
  }
  try {
    const prices = await fetchJupiterPrices(MINTS);
    cache = { fetchedAt: Date.now(), prices };
    return { prices, stale: false };
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      // Once per failure, not once per poll while the circuit is open.
      if (!(err instanceof UpstreamError && err.circuitOpen)) {
        console.warn("[prices proxy] upstream failed, serving stale:", err);
      }
      return { prices: cache.prices, stale: true };
    }
    throw err;
  }
}

export async function GET() {
  try {
    const { prices, stale } = await loadPrices();
    return NextResponse.json(prices, {
      headers: {
        // The CDN cache stays, and is what absorbs a burst of clients. The
        // module cache above is what absorbs a burst of lambdas.
        "cache-control": "public, max-age=5, s-maxage=5",
        ...(stale ? { "x-aeras-stale": "1" } : {}),
      },
    });
  } catch (err) {
    // Nothing cached and upstream is down. 503 with a Retry-After matching the
    // circuit, rather than a 200 carrying an empty map: an empty map reads as
    // "every asset is worth nothing" to every caller downstream.
    const msg = err instanceof Error ? err.message : String(err);
    const retry = Math.max(1, Math.ceil(circuitCooldownMs(PRICE_CIRCUIT_KEY) / 1000));
    return NextResponse.json(
      { error: msg },
      { status: 503, headers: { "retry-after": String(retry) } },
    );
  }
}
