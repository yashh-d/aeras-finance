import { NextResponse } from "next/server";

import { ondoAddressBookChallenge } from "@/lib/ondo/server";
import { OndoSessionMissing, requireOndoSession } from "@/lib/ondo/session";
import { ONDO_ADDRESS_BOOK_CHAIN_ID } from "@/lib/ondo/withdraw";

export const dynamic = "force-dynamic";

// Step 1 of registering a payout address.
//
// **This route takes no address.** The withdrawal address is the wallet that
// owns the session, read server-side from the httpOnly cookie, and there is no
// request body that can change it. That is the single most important line in
// this file.
//
// The reasoning is the mirror of app/api/ondo/deposit-address: on the way in,
// the destination is Ondo's and is never caller-supplied, because a caller who
// could name it could route a user's bridge output anywhere. On the way out the
// destination is the user's own wallet, and the same argument applies with more
// force: an address parameter here would let a compromised page, or an injected
// instruction, register an attacker's address and then drain the account
// through it. Ondo's own SIWE step would still demand a signature from the
// user's wallet, but the signed message names the withdrawal address, and a
// user approving what looks like a routine "register your wallet" prompt is not
// a meaningful defence. So the address never travels.
//
// The consequence is deliberate and worth stating: Aeras cannot withdraw to a
// Ledger, an exchange deposit address, or any other wallet. Ondo's own app can.
// If that changes, it should change with an explicit confirmation flow showing
// the address, not by adding a field here.
export async function POST() {
  let session;
  try {
    session = await requireOndoSession();
  } catch (err) {
    if (err instanceof OndoSessionMissing) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  try {
    const challenge = await ondoAddressBookChallenge(session.token, {
      walletAddress: session.address,
      // The chain the signature is made on, not the chain the withdrawal lands
      // on. Ondo's enum here is EVM-only, which is one of two independent
      // reasons a withdrawal cannot be pointed at a Solana address.
      chainId: ONDO_ADDRESS_BOOK_CHAIN_ID,
      withdrawalAddress: session.address,
    });

    return NextResponse.json({
      id: challenge.id,
      message: challenge.message,
      // Echoed so the browser can show what it is about to authorise rather
      // than asking the user to trust an opaque signing prompt.
      withdrawalAddress: session.address,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
