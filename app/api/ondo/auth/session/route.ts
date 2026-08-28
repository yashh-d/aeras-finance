import { NextResponse } from "next/server";

import { describeOndoAuthError } from "@/lib/ondo/errors";
import { OndoApiError, ondoAccount, ondoCompleteChallenge } from "@/lib/ondo/server";
import { clearOndoSession, setOndoSession } from "@/lib/ondo/session";

export const dynamic = "force-dynamic";

// Step 2 of the handshake: exchange the signed challenge for a JWT, and keep
// the JWT here.
//
// The token is deliberately not in the response. It authorises trading on the
// user's Ondo account for 24 hours, so it goes straight into an httpOnly
// cookie and the browser gets back only what it needs to render state: the
// account id, whether perps are enabled, and whether terms have been accepted.
//
// The address is stored alongside the token so a later request can tell that
// the Privy wallet has changed underneath the session. Trading through a
// session minted for a different address would be silent and wrong.
export async function POST(request: Request) {
  let payload: { id?: unknown; signature?: unknown; address?: unknown };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { id, signature, address } = payload;

  if (typeof id !== "string" || id.length === 0) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "signature must be a 0x hex string" }, { status: 400 });
  }
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "address must be a 0x EVM address" }, { status: 400 });
  }

  try {
    const { token } = await ondoCompleteChallenge(id, signature);

    // Read the account before setting the cookie. A token that cannot read its
    // own account is not a usable session, and storing it would leave the user
    // looking signed in with every subsequent call failing.
    const account = await ondoAccount(token);

    await setOndoSession({ token, address: address.toLowerCase() });

    return NextResponse.json({
      accountID: account.accountID,
      accountState: account.accountState,
      // 0 means the user has never accepted Ondo's terms. Reads work at 0; the
      // UI decides whether to ask, and POST /api/ondo/agreement records it.
      termsVersion: account.termsVersion,
      privacyVersion: account.privacyVersion,
      perpsEnabled: account.disabledFunctionality?.disablePerps === false,
    });
  } catch (err) {
    // Same treatment as the challenge route. The most likely failure on this
    // one is `challenge_not_found`, which means the five-minute window closed
    // while the wallet prompt sat open. Retrying the signature cannot fix that,
    // so the message has to send the user back to the start.
    if (err instanceof OndoApiError) {
      const described = describeOndoAuthError(err.code, err.message);
      return NextResponse.json(
        { error: described.message, failure: described.failure, code: described.code },
        { status: described.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), failure: "upstream" },
      { status: 502 },
    );
  }
}

// Signing out drops our copy of the token. Ondo has its own
// /v1/auth/invalidate_jwt, which is not called here: the session may be shared
// with the user's own Ondo login in another tab, and invalidating it there
// would sign them out of a session we did not create.
export async function DELETE() {
  await clearOndoSession();
  return NextResponse.json({ ok: true });
}
