import { NextResponse } from "next/server";

import { isSupportedAddress, trustwareAllowance } from "@/lib/trustware/server";

export const dynamic = "force-dynamic";

// Current ERC-20 allowance for a route's spender, read through Trustware's RPC
// proxy so we need no EVM RPC of our own. Read-only.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainId = params.get("chainId")?.trim();
  const tokenAddress = params.get("tokenAddress")?.trim();
  const ownerAddress = params.get("ownerAddress")?.trim();
  const spenderAddress = params.get("spenderAddress")?.trim();

  if (!chainId || !/^\d+$/.test(chainId)) {
    return NextResponse.json(
      { error: "chainId must be a numeric EVM chain id" },
      { status: 400 },
    );
  }
  for (const [label, value] of [
    ["tokenAddress", tokenAddress],
    ["ownerAddress", ownerAddress],
    ["spenderAddress", spenderAddress],
  ] as const) {
    if (!value || !isSupportedAddress(value)) {
      return NextResponse.json(
        { error: `${label} is missing or malformed` },
        { status: 400 },
      );
    }
  }

  try {
    return NextResponse.json(
      await trustwareAllowance({
        chainId,
        tokenAddress: tokenAddress!,
        ownerAddress: ownerAddress!,
        spenderAddress: spenderAddress!,
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
