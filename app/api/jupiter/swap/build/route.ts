import { NextResponse } from "next/server";

import { isAllowedSwapPair } from "@/lib/jupiter/swap-pairs";

export const dynamic = "force-dynamic";

const LITE_SWAP_BASE = "https://lite-api.jup.ag/swap/v1";

// Turn a swap quote into a signable transaction.
//
// The sibling /instructions route returns raw instructions for callers that
// compose them into a larger transaction. This one returns the ready-made
// transaction, which is what a standalone conversion needs.
//
// Ultra cannot serve this: it rejects Ondo pairs with "Only USDC is available
// for swapping with Ondo tokens". The classic swap API routes them directly, so
// the signed transaction is broadcast by the client rather than handed back to
// Jupiter's execute endpoint.
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
      { error: "Unsupported mint pair" },
      { status: 400 },
    );
  }

  const res = await fetch(`${LITE_SWAP_BASE}/swap`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      // The conversion moves SPL tokens only, so there is no SOL to wrap.
      wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: true,
    }),
  });

  const parsed = await res.json();
  if (!res.ok) {
    return NextResponse.json(
      { error: parsed?.error ?? `Swap build failed: ${res.status}` },
      { status: res.status },
    );
  }

  // Jupiter simulates before returning. A failure here means the transaction
  // would not land, and catching it now saves the user a signature prompt.
  if (parsed?.simulationError) {
    return NextResponse.json(
      {
        error:
          typeof parsed.simulationError === "string"
            ? parsed.simulationError
            : (parsed.simulationError?.error ??
              "The swap failed simulation and was not returned."),
      },
      { status: 502 },
    );
  }

  return NextResponse.json(parsed);
}
