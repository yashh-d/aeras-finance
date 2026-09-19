import { NextResponse } from "next/server";

import { parseMarketId, type SparklineMap } from "@/lib/lighter/candles";
import { lighterMarketPriceCharts } from "@/lib/lighter/server";

export const dynamic = "force-dynamic";

// One day of hourly mark prices per market, for the sparkline on each hedge
// row.
//
// One upstream call for the whole catalog. GET /marketPriceCharts returns the
// last 24 hourly mark prices for every market at once, which is exactly the
// line a row draws, so this route no longer fans out to /candles per market.
// That fan-out spent the 60 weighted requests a minute Lighter allows our IP
// within seconds of two users loading the tab; now the tab costs one request
// a minute however many rows it has, and the response is cached whole.
//
// A market the upstream omits is omitted from the map rather than failing the
// batch. A missing sparkline costs a row its line; a failed batch costs every
// row.

const CACHE_MS = 60_000;

// Bounds the request, not the upstream: the whole catalog is fetched either
// way. Kept so a crafted request cannot ask for thousands of ids.
const MAX_MARKETS = 64;

let cached: { charts: Record<number, number[]>; expiresAt: number } | null = null;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("markets") ?? "";

  const marketIds = [
    ...new Set(
      raw
        .split(",")
        .map(parseMarketId)
        .filter((id): id is number => id != null),
    ),
  ];

  if (marketIds.length === 0) {
    return NextResponse.json({} satisfies SparklineMap);
  }
  if (marketIds.length > MAX_MARKETS) {
    return NextResponse.json(
      { error: `markets is limited to ${MAX_MARKETS} ids` },
      { status: 400 },
    );
  }

  let charts = cached && cached.expiresAt > Date.now() ? cached.charts : null;
  if (!charts) {
    try {
      charts = await lighterMarketPriceCharts();
      cached = { charts, expiresAt: Date.now() + CACHE_MS };
    } catch {
      // Serve stale rather than nothing; an empty map if there is no stale.
      charts = cached?.charts ?? {};
    }
  }

  const result: SparklineMap = {};
  for (const id of marketIds) {
    const prices = charts[id];
    if (prices) result[id] = prices;
  }
  return NextResponse.json(result);
}
