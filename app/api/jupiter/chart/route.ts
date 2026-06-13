import { NextResponse } from "next/server";
import { fetchChart, type ChartRange } from "@/lib/jupiter/charts";
import { xstockByMint } from "@/lib/jupiter/xstocks";

export const dynamic = "force-dynamic";

const VALID_RANGES = ["1D", "1W", "1M", "3M"] as const;

function isRange(value: string | null): value is ChartRange {
  return value != null && (VALID_RANGES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mint = searchParams.get("mint");
  const range = searchParams.get("range");

  if (!mint || !xstockByMint(mint)) {
    return NextResponse.json(
      { error: "mint must be a curated xStock" },
      { status: 400 },
    );
  }
  if (!isRange(range)) {
    return NextResponse.json(
      { error: `range must be one of ${VALID_RANGES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const candles = await fetchChart(mint, range);
    return NextResponse.json(candles, {
      headers: { "cache-control": "public, max-age=30, s-maxage=30" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
