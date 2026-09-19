import { NextResponse } from "next/server";

import {
  isCandleResolution,
  isCandleSource,
  parseMarketId,
  type LighterCandle,
} from "@/lib/lighter/candles";
import { lighterCandlesWindow } from "@/lib/lighter/server";

export const dynamic = "force-dynamic";

// Candles for an explicit window, for the TradingView datafeed.
//
// The Charting Library asks for history as `from`/`to` in seconds plus a
// bar count, and asks again with an earlier window as the user scrolls back,
// so unlike /api/lighter/candles this route takes the window rather than a
// named range. Resolutions are Lighter's own strings ("15m", not "15"); the
// datafeed translates. Proxied for the same reason as every other Lighter
// read: the per-IP request budget is one pool for every viewer, and a chart
// that is scrolled asks often, so responses are cached briefly by window.

const CACHE_MS = 10_000;
const cache = new Map<string, { candles: LighterCandle[]; expiresAt: number }>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = parseMarketId(searchParams.get("market"));
  const resolution = searchParams.get("resolution");
  const source = searchParams.get("source") ?? "trades";
  const from = Number(searchParams.get("from"));
  const to = Number(searchParams.get("to"));
  const countback = Number(searchParams.get("countback") ?? "300");

  if (market == null) {
    return NextResponse.json({ error: "market must be a Lighter market id" }, { status: 400 });
  }
  if (!isCandleResolution(resolution)) {
    return NextResponse.json({ error: "resolution must be a Lighter resolution" }, { status: 400 });
  }
  if (!isCandleSource(source)) {
    return NextResponse.json({ error: "source must be trades or mark" }, { status: 400 });
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) {
    return NextResponse.json({ error: "from and to must be seconds with from < to" }, { status: 400 });
  }

  const key = `${market}:${resolution}:${source}:${Math.floor(from)}:${Math.floor(to)}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json({ candles: hit.candles });
  }

  try {
    const candles = await lighterCandlesWindow(
      market,
      resolution,
      from * 1000,
      to * 1000,
      Number.isFinite(countback) && countback > 0 ? countback : 300,
      source,
    );
    cache.set(key, { candles, expiresAt: Date.now() + CACHE_MS });
    // A bounded cache: windows scroll, and each is worth ten seconds.
    if (cache.size > 500) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return NextResponse.json({ candles });
  } catch (err) {
    if (hit) return NextResponse.json({ candles: hit.candles });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
