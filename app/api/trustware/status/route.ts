import { NextResponse } from "next/server";

import { isValidIntentId, trustwareStatus } from "@/lib/trustware/server";

export const dynamic = "force-dynamic";

// Progress of a conversion the user has already broadcast. Read-only.
//
// Trustware answers 404 until a receipt has been submitted, which is a normal
// early state rather than a failure, so that is passed through as a 404 with an
// explicit flag for the poller to act on.
export async function GET(request: Request) {
  const intentId = new URL(request.url).searchParams.get("intentId")?.trim();
  if (!intentId || !isValidIntentId(intentId)) {
    return NextResponse.json(
      { error: "intentId is missing or malformed" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await trustwareStatus(intentId));
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 404) {
      return NextResponse.json({ error: "not tracked yet" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
