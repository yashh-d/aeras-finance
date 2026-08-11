import { NextResponse } from "next/server";

import { isValidIntentId, trustwareSubmitReceipt } from "@/lib/trustware/server";

export const dynamic = "force-dynamic";

// Hash shapes we broadcast: 32-byte EVM hex, or a base58 Solana signature.
const TX_HASH = /^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/;

// Hand a broadcast transaction hash to Trustware so it starts tracking the
// route. This is the one call that must not be skipped: without it Trustware
// cannot report on a conversion the user has already paid for. Trustware treats
// it as idempotent, so the client retries on failure.
export async function POST(request: Request) {
  let body: { intentId?: string; txHash?: string };
  try {
    body = (await request.json()) as { intentId?: string; txHash?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const intentId = body.intentId?.trim();
  const txHash = body.txHash?.trim();
  if (!intentId || !isValidIntentId(intentId)) {
    return NextResponse.json(
      { error: "intentId is missing or malformed" },
      { status: 400 },
    );
  }
  if (!txHash || !TX_HASH.test(txHash)) {
    return NextResponse.json(
      { error: "txHash is missing or malformed" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await trustwareSubmitReceipt(intentId, txHash));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
