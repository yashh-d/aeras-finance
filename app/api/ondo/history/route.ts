import { NextResponse } from "next/server";

import { buildCatalog, findMarket } from "@/lib/ondo/markets";
import { ondoContracts, ondoHistory, ondoMarkets } from "@/lib/ondo/server";
import type { OndoCandle } from "@/lib/ondo/types";

export const dynamic = "force-dynamic";

// Price history for the perps chart.
//
// The caller names a market the way every other endpoint does (`SPY-USD.P`) and
// this route translates. That translation is the entire reason the route
// exists, because getting it wrong fails silently:
//
//   symbol=SPYUSD.P    ->  {"s":"ok","t":[...],"o":[...], ...}
//   symbol=SPY-USD.P   ->  {"s":"ok","t":[],"o":[],"l":[], ...}
//
// The hyphenated form is not an error. It returns `s: "ok"` with empty arrays,
// so a chart built from it renders blank and reads as an illiquid market rather
// than as a bad request. The correct symbol is the market's own `displayName`
// plus ".P", checked against all 40 markets with zero mismatches, so it is read
// from the catalog rather than derived by stripping hyphens.
//
// Unauthenticated upstream, and it does not use the response envelope.

const RESOLUTIONS = new Set(["1", "5", "15", "30", "60", "240", "1D"]);

// Ondo caps what it will return, and the cap is not documented. 500 is well
// inside anything observed and is more bars than the chart draws.
const MAX_COUNTBACK = 500;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const market = params.get("market");
  const resolution = params.get("resolution") ?? "15";
  const countbackParam = Number(params.get("countback") ?? "120");

  if (!market) {
    return NextResponse.json({ error: "market is required" }, { status: 400 });
  }
  if (!RESOLUTIONS.has(resolution)) {
    return NextResponse.json(
      { error: `resolution must be one of ${[...RESOLUTIONS].join(", ")}` },
      { status: 400 },
    );
  }

  // Number("") and Number(null) are both 0, and a countback of 0 is a chart
  // with no bars rather than an error, so this is bounded rather than trusted.
  const countback =
    Number.isFinite(countbackParam) && countbackParam > 0
      ? Math.min(Math.floor(countbackParam), MAX_COUNTBACK)
      : 120;

  try {
    const [markets, contracts] = await Promise.all([ondoMarkets(), ondoContracts()]);
    const resolved = findMarket(buildCatalog(markets, contracts), market);

    if (!resolved) {
      return NextResponse.json(
        { error: `${market} is not an Ondo market` },
        { status: 404 },
      );
    }

    const history = await ondoHistory(
      `${resolved.displayName}.P`,
      resolution,
      Math.floor(Date.now() / 1000),
      countback,
    );

    if (history.s !== "ok" || !history.t?.length) {
      // An empty payload is a real answer for a market that has not traded in
      // the window, so it is served as an empty series rather than an error.
      return NextResponse.json({ market: resolved.market, candles: [] });
    }

    const candles: OndoCandle[] = history.t.map((t, i) => ({
      // Ondo's timestamps are seconds. Every chart elsewhere in the app takes
      // milliseconds, so the conversion happens here rather than in each
      // consumer.
      time: t * 1000,
      open: history.o?.[i] ?? 0,
      high: history.h?.[i] ?? 0,
      low: history.l?.[i] ?? 0,
      close: history.c?.[i] ?? 0,
      volume: history.v?.[i] ?? 0,
    }));

    return NextResponse.json({ market: resolved.market, candles });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
