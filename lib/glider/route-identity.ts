// What every app/api/glider route needs first: a verified Privy identity
// with an embedded EVM wallet, and one way to turn a GliderError into a
// response. The EVM address is the Glider owner; it is read off the token and
// never accepted from the request, the same rule app/api/trustware/route
// states for payout addresses.

import "server-only";

import { NextResponse } from "next/server";

import { authenticate } from "@/lib/privy/auth";

import { GliderError } from "./server";

export interface GliderIdentity {
  privyDid: string;
  evmAddress: string;
  solanaAddress: string | null;
}

export async function identifyForGlider(
  request: Request,
): Promise<GliderIdentity | NextResponse> {
  const identity = await authenticate(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (!identity.embedded.evm) {
    return NextResponse.json(
      { error: "No embedded Ethereum wallet on this account yet. It provisions on first sign-in; try again in a moment." },
      { status: 409 },
    );
  }
  return {
    privyDid: identity.privyDid,
    evmAddress: identity.embedded.evm,
    solanaAddress: identity.embedded.solana,
  };
}

export function gliderErrorResponse(err: unknown): NextResponse {
  if (err instanceof GliderError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return NextResponse.json(
      { error: err.message, code: err.code },
      {
        status,
        headers: err.retryAfterSeconds != null ? { "retry-after": String(err.retryAfterSeconds) } : {},
      },
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: msg }, { status: 502 });
}
