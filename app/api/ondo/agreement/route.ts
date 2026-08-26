import { NextResponse } from "next/server";

import { ondoAcceptTerms } from "@/lib/ondo/server";
import { OndoSessionMissing, requireOndoSession } from "@/lib/ondo/session";

export const dynamic = "force-dynamic";

// Records the user's acceptance of Ondo's terms of service and privacy policy.
//
// This is its own route, and nothing in the sign-in path calls it, on purpose.
// Accepting an exchange's terms is consent that belongs to the user, so it has
// to be a thing they do with the documents in front of them rather than a step
// that happens because they logged in. A fresh account sits at termsVersion 0
// and every read the hedge needs works there, so there is no pressure to slip
// it into the handshake.
//
// The versions come from the caller rather than being hardcoded, because the
// number that gets recorded has to match the document the user was actually
// shown. The integration guide currently documents version 1 of each.
const MAX_VERSION = 100;

export async function POST(request: Request) {
  let session;
  try {
    session = await requireOndoSession();
  } catch (err) {
    if (err instanceof OndoSessionMissing) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  let payload: { termsVersion?: unknown; privacyVersion?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { termsVersion, privacyVersion } = payload;

  if (!isVersion(termsVersion) || !isVersion(privacyVersion)) {
    return NextResponse.json(
      { error: "termsVersion and privacyVersion must be positive integers" },
      { status: 400 },
    );
  }

  try {
    await ondoAcceptTerms(session.token, { termsVersion, privacyVersion });
    return NextResponse.json({ termsVersion, privacyVersion });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

function isVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_VERSION
  );
}
