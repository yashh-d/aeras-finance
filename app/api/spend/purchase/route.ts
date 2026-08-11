import { NextResponse } from "next/server";
import { authenticate } from "@/lib/privy/auth";
import { charge } from "@/spend/rain";
import { getCardId } from "@/spend/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs a purchase against this account's card. Sandbox has no real merchants,
// so a charge is Rain's authorize plus settle, which is what the card sees when
// a merchant captures a payment.

const MAX_CENTS = 100_000;

export async function POST(request: Request) {
  const identity = await authenticate(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    amount?: number;
    merchantName?: string;
    mcc?: string;
  };
  const amount = Math.round(Number(body.amount));
  const merchantName = body.merchantName?.trim();
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_CENTS) {
    return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
  }
  if (!merchantName) {
    return NextResponse.json({ error: "Enter a merchant." }, { status: 400 });
  }

  try {
    const cardId = await getCardId(identity.privyDid);
    if (!cardId) {
      return NextResponse.json({ error: "No card on this account." }, { status: 404 });
    }
    const result = await charge(cardId, amount, merchantName, body.mcc ?? "5814");
    if (result.declined) {
      return NextResponse.json({
        declined: true,
        reason: result.reason ?? "declined",
      });
    }
    return NextResponse.json({ declined: false });
  } catch (err) {
    console.error("spend purchase error", (err as Error)?.message ?? err);
    return NextResponse.json({ error: "The purchase did not go through." }, { status: 502 });
  }
}
