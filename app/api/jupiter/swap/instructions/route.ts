import { NextResponse } from "next/server";

import { isAllowedSwapPair } from "@/lib/jupiter/swap-pairs";

export const dynamic = "force-dynamic";

const LITE_SWAP_BASE = "https://lite-api.jup.ag/swap/v1";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const quoteResponse = body?.quoteResponse;
  const userPublicKey = body?.userPublicKey;

  if (!quoteResponse || !userPublicKey) {
    return NextResponse.json(
      { error: "quoteResponse and userPublicKey are required" },
      { status: 400 },
    );
  }

  if (!isAllowedSwapPair(quoteResponse.inputMint, quoteResponse.outputMint)) {
    return NextResponse.json(
      { error: "Unsupported mint pair for looping" },
      { status: 400 },
    );
  }

  const res = await fetch(`${LITE_SWAP_BASE}/swap-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse, userPublicKey }),
    cache: "no-store",
  });
  const out = await res.json();
  if (!res.ok || out?.error) {
    return NextResponse.json(
      { error: out?.error ?? `Swap instructions failed: ${res.status}` },
      { status: res.ok ? 502 : res.status },
    );
  }
  return NextResponse.json(out);
}
