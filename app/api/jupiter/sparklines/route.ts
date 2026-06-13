import { NextResponse } from "next/server";
import { fetchAllSparklines } from "@/lib/jupiter/charts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const map = await fetchAllSparklines();
    return NextResponse.json(map, {
      headers: { "cache-control": "public, max-age=15, s-maxage=15" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
