import { NextResponse } from "next/server";

import {
  LIGHTER_API_BASE_URL,
  LIGHTER_API_PREFIX,
} from "@/lib/lighter/constants";

export const dynamic = "force-dynamic";

// Lighter's current secure-withdrawal delay. Dynamic on their side (measured at
// ~24 minutes and documented as high as a day), so it is read live rather than
// hardcoded, and cached for a minute because it moves on the scale of policy
// changes, not requests.
let cached: { at: number; seconds: number } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ seconds: cached.seconds });
  }
  try {
    const res = await fetch(
      `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/withdrawalDelay`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as { seconds?: number };
    if (!res.ok || typeof body.seconds !== "number") {
      throw new Error(`withdrawalDelay answered ${res.status}`);
    }
    cached = { at: Date.now(), seconds: body.seconds };
    return NextResponse.json({ seconds: body.seconds });
  } catch (err) {
    if (cached) return NextResponse.json({ seconds: cached.seconds });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
