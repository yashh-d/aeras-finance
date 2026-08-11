import { NextResponse } from "next/server";
import { fetchJupiterPricesDirect } from "@/lib/jupiter/prices";
import { SOL_MINT } from "@/lib/jupiter/constants";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import { SOLANA_EQUIVALENT_TOKENS } from "@/lib/solana/equivalent-tokens";

export const dynamic = "force-dynamic";

export async function GET() {
  // SOL is included so the client can render gas-lamport fees in USD. The Ondo
  // mints are priced so a held balance shows a USD value like every other row;
  // their liquidity is thin, so the price can sit a few percent off the
  // equivalent xStock.
  const mints = [
    ...XSTOCKS.map((x) => x.mint),
    ...SOLANA_EQUIVALENT_TOKENS.map((t) => t.mint),
    SOL_MINT,
  ];
  const prices = await fetchJupiterPricesDirect(mints);
  return NextResponse.json(prices, {
    headers: { "cache-control": "public, max-age=5, s-maxage=5" },
  });
}
