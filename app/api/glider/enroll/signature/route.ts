import { NextResponse } from "next/server";

import { checkEligibility, countryFromHeaders } from "@/lib/glider/eligibility";
import { gliderErrorResponse, identifyForGlider } from "@/lib/glider/route-identity";
import { findPortfolio, prepareEnrollment } from "@/lib/glider/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stage 1 of enrolling this user into Bitwise Mag7X: the digest the embedded
// EVM wallet signs. The owner is the embedded EVM address on the verified
// identity, never a parameter.
//
// This is the eligibility gate. The holdings are Reg S tokenized stocks and
// Glider's API enforces nothing about who enrolls, so the country the edge
// saw and the user's own attestation are checked here, before Glider is
// asked for anything. See lib/glider/eligibility.ts.
//
// Answers with the existing portfolio when the user already has one, so a
// ticket can call this without first asking whether it needs to.
export async function POST(request: Request) {
  const id = await identifyForGlider(request);
  if (id instanceof NextResponse) return id;

  let body: { attest?: unknown } = {};
  try {
    body = (await request.json()) as { attest?: unknown };
  } catch {
    // An empty body is an un-attested request, handled below.
  }
  const eligibility = checkEligibility({
    country: countryFromHeaders(request.headers),
    attested: body.attest === true,
  });
  if (!eligibility.ok) {
    return NextResponse.json({ error: eligibility.reason }, { status: 403 });
  }

  try {
    const existing = await findPortfolio(id.evmAddress);
    if (existing) {
      return NextResponse.json({
        existing: { portfolioId: existing.portfolioId, smartAccount: existing.smartAccount },
      });
    }
    const prepared = await prepareEnrollment(id.evmAddress);
    return NextResponse.json({ prepared });
  } catch (err) {
    return gliderErrorResponse(err);
  }
}
