import { NextResponse } from "next/server";

import { checkEligibility, countryFromHeaders } from "@/lib/glider/eligibility";
import { gliderErrorResponse, identifyForGlider } from "@/lib/glider/route-identity";
import { completeEnrollment, findPortfolio, GliderError } from "@/lib/glider/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const ROUND_TRIP = /^[A-Za-z0-9_:\-.]{1,128}$/;

// Stage 2: the signed digest goes to Glider, which creates the portfolio and
// its Base smart account. The round-trip fields are echoed from stage 1
// unchanged; the owner is again the verified identity's embedded wallet.
export async function POST(request: Request) {
  const id = await identifyForGlider(request);
  if (id instanceof NextResponse) return id;

  let body: {
    attest?: unknown;
    signature?: unknown;
    flowId?: unknown;
    accountIndex?: unknown;
    agentAccountId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const eligibility = checkEligibility({
    country: countryFromHeaders(request.headers),
    attested: body.attest === true,
  });
  if (!eligibility.ok) {
    return NextResponse.json({ error: eligibility.reason }, { status: 403 });
  }

  const { signature, flowId, accountIndex, agentAccountId } = body;
  if (typeof signature !== "string" || !HEX_SIGNATURE.test(signature)) {
    return NextResponse.json({ error: "signature must be a 65-byte hex string" }, { status: 400 });
  }
  if (typeof flowId !== "string" || !ROUND_TRIP.test(flowId)) {
    return NextResponse.json({ error: "flowId is required" }, { status: 400 });
  }
  if (typeof accountIndex !== "string" || !/^\d{1,6}$/.test(accountIndex)) {
    return NextResponse.json({ error: "accountIndex is required" }, { status: 400 });
  }
  if (typeof agentAccountId !== "string" || !/^eip155:0:0x[0-9a-fA-F]{40}$/.test(agentAccountId)) {
    return NextResponse.json({ error: "agentAccountId is required" }, { status: 400 });
  }

  try {
    const result = await completeEnrollment({
      evmAddress: id.evmAddress,
      prepared: { agentAccountId, accountIndex, flowId },
      signature,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // Already enrolled (a stage 2 replayed after the page lost its answer):
    // hand back the portfolio that exists rather than an error.
    if (err instanceof GliderError && (err.code === "API_202" || err.status === 409)) {
      try {
        const existing = await findPortfolio(id.evmAddress);
        if (existing) {
          return NextResponse.json({
            portfolioId: existing.portfolioId,
            smartAccount: existing.smartAccount,
          });
        }
      } catch {
        // Fall through to the original error.
      }
    }
    return gliderErrorResponse(err);
  }
}
