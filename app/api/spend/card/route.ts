import { NextResponse } from "next/server";
import { authenticate } from "@/lib/privy/auth";
import { CARD_CAP_CENTS, getCard, issueCard, listPurchases } from "@/spend/rain";
import { claimCard, getCardId } from "@/spend/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET returns this account's card and its purchases, or { card: null } if it
// has not issued one yet. POST issues the card, and is the only moment the
// number is ever available: the encrypted PAN and CVC pass straight through to
// the browser that generated the session ID.

export async function GET(request: Request) {
  const identity = await authenticate(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const cardId = await getCardId(identity.privyDid);
    if (!cardId) return NextResponse.json({ card: null });
    const [card, purchases] = await Promise.all([
      getCard(cardId),
      listPurchases(cardId),
    ]);
    return NextResponse.json({ card, purchases, capCents: CARD_CAP_CENTS });
  } catch (err) {
    console.error("spend card read error", (err as Error)?.message ?? err);
    return NextResponse.json({ error: "Could not load your card." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const identity = await authenticate(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { sessionId } = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
  };
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session." }, { status: 400 });
  }

  try {
    if (await getCardId(identity.privyDid)) {
      return NextResponse.json(
        { error: "This account already has a card." },
        { status: 409 },
      );
    }
    const issued = await issueCard(sessionId);
    const claimed = await claimCard(identity.privyDid, issued.id);
    if (claimed !== issued.id) {
      return NextResponse.json(
        { error: "This account already has a card." },
        { status: 409 },
      );
    }
    return NextResponse.json({ card: issued, capCents: CARD_CAP_CENTS });
  } catch (err) {
    console.error("spend card issue error", (err as Error)?.message ?? err);
    return NextResponse.json({ error: "Could not issue a card." }, { status: 502 });
  }
}
