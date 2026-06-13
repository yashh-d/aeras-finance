import { NextResponse } from "next/server";
import { fetchJupiterPricesDirect } from "@/lib/jupiter/prices";
import { SOL_MINT } from "@/lib/jupiter/constants";
import { XSTOCKS } from "@/lib/jupiter/xstocks";

export const dynamic = "force-dynamic";

export async function GET() {
  // SOL is included so the client can render gas-lamport fees in USD.
  const mints = [...XSTOCKS.map((x) => x.mint), SOL_MINT];
  const prices = await fetchJupiterPricesDirect(mints);
  return NextResponse.json(prices, {
    headers: { "cache-control": "public, max-age=5, s-maxage=5" },
  });
}
