import { NextResponse } from "next/server";
import { fetchUltraOrderDirect } from "@/lib/jupiter/ultra";
import { SOL_MINT, USDC_MINT } from "@/lib/jupiter/constants";
import { xstockByMint } from "@/lib/jupiter/xstocks";

export const dynamic = "force-dynamic";

const QUOTE_MINTS = new Set([USDC_MINT, SOL_MINT]);

function isAllowedPair(inputMint: string, outputMint: string): boolean {
  // Buy: USDC/SOL -> xStock. Sell: xStock -> USDC/SOL.
  const isBuy = QUOTE_MINTS.has(inputMint) && Boolean(xstockByMint(outputMint));
  const isSell = Boolean(xstockByMint(inputMint)) && QUOTE_MINTS.has(outputMint);
  return isBuy || isSell;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const inputMint = searchParams.get("inputMint");
  const outputMint = searchParams.get("outputMint");
  const amount = searchParams.get("amount");
  const taker = searchParams.get("taker") ?? undefined;

  if (!inputMint || !outputMint || !amount) {
    return NextResponse.json(
      { error: "inputMint, outputMint, and amount are required" },
      { status: 400 },
    );
  }

  if (!isAllowedPair(inputMint, outputMint)) {
    return NextResponse.json(
      { error: "Unsupported mint pair for v1" },
      { status: 400 },
    );
  }

  const order = await fetchUltraOrderDirect({
    inputMint,
    outputMint,
    amount,
    taker,
  });

  return NextResponse.json(order);
}
