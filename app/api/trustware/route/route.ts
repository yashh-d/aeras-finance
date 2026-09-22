import { NextResponse } from "next/server";

import { verifyGliderSmartAccount } from "@/lib/glider/server";
import { authenticate } from "@/lib/privy/auth";
import {
  destinationForShape,
  trustwareRoute,
  validateTrustwareRequest,
} from "@/lib/trustware/server";
import { TRUSTWARE_DEFAULT_SLIPPAGE } from "@/lib/trustware/constants";
import type { TrustwareQuoteRequest } from "@/lib/trustware/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Build an executable route (intentId + txReq) for a cross-chain conversion.
// Still signs nothing here: the returned txReq is signed client-side by the
// Privy wallet.
//
// **The payout address is not a parameter.** This route verifies the Privy
// access token, reads the embedded wallets off that identity, and overwrites
// `toAddress` with the one the matched shape delivers to. Whatever the browser
// sent is discarded.
//
// That is the same rule app/api/loops and app/api/ondo/address-book/challenge
// already state, and it is here for a sharper reason than either. This is the
// one route that hands back a SIGNABLE transaction, and
// embeddedWallets.showWalletUIs is false in lib/privy/provider.tsx, so there is
// no wallet confirmation between a call to the signer and a broadcast. A script
// on the page that could name its own destination would therefore have a silent
// drain: build a route to an address it controls, sign it with the signer
// already in the page, done. Pinning the destination server-side means the
// worst that same script achieves is moving the user's funds between the user's
// own wallets.
//
// The three shapes that genuinely deliver elsewhere (Ondo margin, Lighter
// margin, a Glider deposit) keep their caller-supplied address and have to ask
// for it by name through `intent`. The Glider one is verified here: the
// address must be the Base smart account of a Mag7X portfolio Glider says
// this identity's embedded EVM wallet owns. Verifying the other two against
// Ondo and Lighter is not done here yet; today the guarantee is that the
// address came from our own server routes, and lib/ondo/fund.ts checks it
// against Ondo before planning.
export async function POST(request: Request) {
  const identity = await authenticate(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let req: Partial<TrustwareQuoteRequest>;
  try {
    req = (await request.json()) as Partial<TrustwareQuoteRequest>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const validation = validateTrustwareRequest(req);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const destination = destinationForShape(
    validation.shape,
    req.toChain!,
    identity.embedded,
  );
  if ("error" in destination) {
    return NextResponse.json({ error: destination.error }, { status: 409 });
  }

  if (validation.shape === "glider-deposit") {
    let owned = false;
    try {
      owned = await verifyGliderSmartAccount(identity.embedded.evm, req.toAddress!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Could not confirm the Mag7X deposit address with Glider. ${msg}` },
        { status: 502 },
      );
    }
    if (!owned) {
      return NextResponse.json(
        { error: "That address is not the Base smart account of your Bitwise Mag7X portfolio." },
        { status: 409 },
      );
    }
  }

  const built: TrustwareQuoteRequest = {
    ...(req as TrustwareQuoteRequest),
    // "passthrough" is the Ondo/Lighter margin case, where the destination is
    // an address a third party provisioned for this user and the caller's value
    // is the only one that can be right.
    toAddress:
      "address" in destination ? destination.address : req.toAddress!,
    slippage: req.slippage ?? TRUSTWARE_DEFAULT_SLIPPAGE,
  };

  try {
    const route = await trustwareRoute(built);
    return NextResponse.json(route);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
