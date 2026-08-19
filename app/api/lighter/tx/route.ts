import { NextResponse } from "next/server";

import {
  LIGHTER_TX_TYPE_CANCEL_ORDER,
  LIGHTER_TX_TYPE_CHANGE_PUBKEY,
  LIGHTER_TX_TYPE_CREATE_ORDER,
} from "@/lib/lighter/constants";
import { lighterSendTx } from "@/lib/lighter/server";

export const dynamic = "force-dynamic";

// Frankfurt. This is a compliance choice, not a latency one.
//
// Lighter geo-blocks sendTx and only sendTx: every read, and even
// createIntentAddress, answers normally from a blocked region. Vercel defaults
// to iad1 in Virginia, which is blocked, so without this line every hedge fails
// with code 20558 no matter where the user is.
//
// Several Vercel regions are unusable for the same reason. Lighter's terms name
// the United States, Canada, the United Kingdom and China among others, which
// rules out iad1, cle1, pdx1, sfo1, lhr1 and hkg1. dub1, arn1, cdg1 and sin1
// would all work as well as fra1.
export const preferredRegion = "fra1";

// Relays a transaction the browser already signed.
//
// The relay cannot forge anything. Every transaction carries a Schnorr signature
// over the user's own trading key, made in their browser, and any edit in
// transit invalidates it. What this route decides is only where the request
// appears to originate.
//
// Transaction types are allowlisted to the three the product actually performs.
// Without that this is a general purpose relay into Lighter, including for
// withdrawals and transfers we do not offer, and a bug or an abusive caller
// could reach operations the UI never exposes.
const RELAYABLE_TX_TYPES = new Set([
  LIGHTER_TX_TYPE_CHANGE_PUBKEY,
  LIGHTER_TX_TYPE_CREATE_ORDER,
  LIGHTER_TX_TYPE_CANCEL_ORDER,
]);

export async function POST(request: Request) {
  let payload: { txType?: unknown; txInfo?: unknown };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { txType, txInfo } = payload;

  if (typeof txType !== "number" || !RELAYABLE_TX_TYPES.has(txType)) {
    return NextResponse.json(
      { error: `Transaction type ${String(txType)} is not relayed` },
      { status: 400 },
    );
  }
  if (typeof txInfo !== "string" || txInfo.length === 0) {
    return NextResponse.json({ error: "txInfo is required" }, { status: 400 });
  }

  try {
    const txHash = await lighterSendTx(txType, txInfo);
    return NextResponse.json({ txHash });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
