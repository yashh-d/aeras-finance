import { NextResponse } from "next/server";

import { loadEarnings } from "@/lib/calendar/earnings-server";

export const dynamic = "force-dynamic";

// Earnings for every company in the catalog, from Nasdaq's public site API.
// No parameters: the set of companies is the catalog, and the fetching and
// caching live in lib/calendar/earnings-server.ts.
export async function GET() {
  try {
    const body = await loadEarnings();
    return NextResponse.json(body, {
      headers: { "cache-control": "public, max-age=300, s-maxage=300" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
