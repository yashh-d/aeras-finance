import { NextResponse } from "next/server";
import { coingeckoIdForChartKey } from "@/lib/jupiter/chart-assets";
import {
  CHART_RANGES,
  coingeckoCooldownMs,
  fetchChart,
  isChartRange,
} from "@/lib/jupiter/charts";
import { UpstreamError } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // A curated xStock mint or a chart-only key from lib/jupiter/chart-assets.ts.
  // Anything else is refused here, before it can reach Coingecko, so the route
  // cannot be used to chart arbitrary coins.
  const key = searchParams.get("key");
  const range = searchParams.get("range");

  if (!key || !coingeckoIdForChartKey(key)) {
    return NextResponse.json(
      { error: "key must be a curated chart asset" },
      { status: 400 },
    );
  }
  if (!isChartRange(range)) {
    return NextResponse.json(
      { error: `range must be one of ${CHART_RANGES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const candles = await fetchChart(key, range);
    return NextResponse.json(candles, {
      headers: { "cache-control": "public, max-age=30, s-maxage=30" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A rate limit is reported as 503 with a Retry-After rather than 502, so
    // the client can tell "wait" from "this broke" and stop retrying. Retrying
    // a 429 is the one retry guaranteed to make things worse: it spends the
    // budget that would have let the window reset.
    if (err instanceof UpstreamError && err.status === 429) {
      const retry = Math.max(1, Math.ceil(coingeckoCooldownMs() / 1000));
      return NextResponse.json(
        { error: msg },
        { status: 503, headers: { "retry-after": String(retry) } },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
