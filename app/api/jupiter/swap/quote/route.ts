import { NextResponse } from "next/server";

import { isAllowedSwapPair } from "@/lib/jupiter/swap-pairs";

export const dynamic = "force-dynamic";

const LITE_SWAP_BASE = "https://lite-api.jup.ag/swap/v1";

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

  if (!isAllowedSwapPair(inputMint, outputMint)) {
    return NextResponse.json(
      { error: "Unsupported mint pair" },
      { status: 400 },
    );
  }

  const url = new URL(`${LITE_SWAP_BASE}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", slippageBps);

  // Account budget for the route. Only the looping path sends this: a plain
  // swap owns the whole transaction and should route freely, but a loop packs
  // the swap in beside a flashloan and a vault operate, and Solana locks at
  // most 64 accounts per transaction. Jupiter treats it as a rough estimate
  // rather than a hard cap, so the caller still counts the compiled message.
  const maxAccounts = searchParams.get("maxAccounts");
  if (maxAccounts) {
    const n = Number(maxAccounts);
    if (!Number.isInteger(n) || n < 1 || n > 64) {
      return NextResponse.json(
        { error: "maxAccounts must be an integer between 1 and 64" },
        { status: 400 },
      );
    }
    url.searchParams.set("maxAccounts", String(n));
  }

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
