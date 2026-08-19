import { NextResponse } from "next/server";

import {
  isCandleRange,
  parseMarketId,
  type CandleSeries,
  type LighterCandle,
} from "@/lib/lighter/candles";
import { lighterCandles } from "@/lib/lighter/server";

export const dynamic = "force-dynamic";

// Price history for one Lighter market.
//
// Proxied for the same reason as the catalog: Lighter meters unauthenticated
// callers at 60 weighted requests a minute per IP, and behind this route that
// budget is one shared pool for every viewer rather than per user. A chart that
// refetches on a range toggle would burn it quickly, so responses are cached
// server-side and the cache is keyed by market and range together.
//
// The market id is not validated against the catalog on purpose. It is a bare
// integer forwarded to a public read-only endpoint, so the worst a bad one does
// is return an empty series, and requiring a catalog fetch to serve a chart
// would double the upstream calls this route exists to reduce.

const CACHE_MS = 30_000;

const cache = new Map<string, { series: CandleSeries; expiresAt: number }>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = parseMarketId(searchParams.get("market"));
  const range = searchParams.get("range");
  const symbol = searchParams.get("symbol") ?? "";

  if (market == null) {
    return NextResponse.json(
      { error: "market must be a Lighter market id" },
      { status: 400 },
    );
  }
  if (!isCandleRange(range)) {
    return NextResponse.json(
      { error: "range must be one of 1H, 1D, 1W, 1M, 3M" },
      { status: 400 },
    );
  }

  const key = `${market}:${range}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(hit.series);
  }

  try {
    const { candles, resolution } = await lighterCandles(market, range);
    const series: CandleSeries = {
      marketId: market,
      symbol,
      range,
      resolution: resolution as CandleSeries["resolution"],
      candles: candles as LighterCandle[],
    };
    cache.set(key, { series, expiresAt: Date.now() + CACHE_MS });
    return NextResponse.json(series);
  } catch (err) {
    // Serve stale rather than nothing. A chart that was drawing a minute ago is
    // more useful than an error panel while upstream is briefly unhappy.
    if (hit) return NextResponse.json(hit.series);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
