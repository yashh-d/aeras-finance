import { NextResponse } from "next/server";

import {
  downsampleCloses,
  parseMarketId,
  type SparklineMap,
} from "@/lib/lighter/candles";
import { lighterCandles } from "@/lib/lighter/server";

export const dynamic = "force-dynamic";

// One day of closes per market, for the sparkline on each hedge row.
//
// Batched because Lighter's candle endpoint is per market and the hedge tab
// wants a line for every ticker held. One request per row from the browser would
// be a dozen round trips and would spend the 60 weighted requests a minute that
// Lighter allows our IP within seconds of two users loading the tab. Here it is
// one client request, a bounded fan-out, and a shared cache.
//
// A market that fails is omitted from the map rather than failing the batch. A
// missing sparkline costs a row its line; a failed batch costs every row.

const CACHE_MS = 60_000;

// Enough markets for every Aeras xStock route with room to spare, and low enough
// that a crafted request cannot turn one call into an unbounded fan-out.
const MAX_MARKETS = 16;

const POINTS = 40;

const cache = new Map<number, { closes: number[]; expiresAt: number }>();

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

  const now = Date.now();
  const result: SparklineMap = {};
  const stale: number[] = [];

  for (const id of marketIds) {
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now) {
      result[id] = hit.closes;
    } else {
      stale.push(id);
    }
  }

  const fetched = await Promise.allSettled(
    stale.map(async (id) => {
      const { candles } = await lighterCandles(id, "1D");
      return { id, closes: downsampleCloses(candles, POINTS) };
    }),
  );

  for (const outcome of fetched) {
    if (outcome.status !== "fulfilled") continue;
    const { id, closes } = outcome.value;
    cache.set(id, { closes, expiresAt: Date.now() + CACHE_MS });
    result[id] = closes;
  }

  return NextResponse.json(result);
}
