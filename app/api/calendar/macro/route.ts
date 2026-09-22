import { NextResponse } from "next/server";

import { loadMacro } from "@/lib/calendar/macro-server";

export const dynamic = "force-dynamic";

// This week's economic calendar, filtered to what the Terminal shows. See
// lib/calendar/macro.ts for the source and the filter.
export async function GET() {
  try {
    const body = await loadMacro();
    return NextResponse.json(body, {
      headers: { "cache-control": "public, max-age=120, s-maxage=120" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
