import { NextResponse } from "next/server";

import { USDC_MINT } from "@/lib/jupiter/constants";
import { xstockByMint } from "@/lib/jupiter/xstocks";

export const dynamic = "force-dynamic";

const LITE_SWAP_BASE = "https://lite-api.jup.ag/swap/v1";

// Multiply/unwind only ever swap between USDC and a borrowable xStock. Reject
// anything else so this proxy can't be used as an open swap relay.
function isAllowedPair(inputMint: string, outputMint: string): boolean {
  const usdcToXstock = inputMint === USDC_MINT && Boolean(xstockByMint(outputMint));
  const xstockToUsdc = Boolean(xstockByMint(inputMint)) && outputMint === USDC_MINT;
  return usdcToXstock || xstockToUsdc;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const inputMint = searchParams.get("inputMint");
  const outputMint = searchParams.get("outputMint");
  const amount = searchParams.get("amount");
  const slippageBps = searchParams.get("slippageBps") ?? "100";

  if (!inputMint || !outputMint || !amount) {
    return NextResponse.json(
      { error: "inputMint, outputMint, and amount are required" },
      { status: 400 },
    );
  }

  if (!isAllowedPair(inputMint, outputMint)) {
    return NextResponse.json(
      { error: "Unsupported mint pair for looping" },
      { status: 400 },
    );
  }

  const url = new URL(`${LITE_SWAP_BASE}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", slippageBps);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) {
    return NextResponse.json(
      { error: body?.error ?? `Swap quote failed: ${res.status}` },
      { status: res.status },
    );
  }
  return NextResponse.json(body);
}
