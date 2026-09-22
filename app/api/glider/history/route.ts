import { NextResponse } from "next/server";

import { loadHistory } from "@/lib/glider/history-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ten-year CAGR per holding and for the equal-weight basket, from Nasdaq.
// A day's cache on the server; a first cold load takes about ten seconds.
export async function GET() {
  try {
    const { view, stale } = await loadHistory();
    return NextResponse.json(view, {
      headers: {
        "cache-control": "public, max-age=3600, s-maxage=3600",
        ...(stale ? { "x-aeras-stale": "1" } : {}),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503, headers: { "retry-after": "60" } });
  }
}
