import { NextResponse } from "next/server";

import { ondoGetChallenge } from "@/lib/ondo/server";

export const dynamic = "force-dynamic";

// Step 1 of the Ondo SIWE handshake, proxied.
//
// The browser could call Ondo directly here, since the challenge endpoint is
// unauthenticated and returns a message meant to be shown to the user. It goes
// through us anyway for two reasons: Ondo answers 403 to requests without a
// browser-like User-Agent, which is easier to control server side, and browser
// -direct calls would need our public URL on Ondo's CORS allowlist, which
// server-to-server requests sidestep entirely.
//
// The challenge that comes back expires five minutes after it is issued. That
// deadline is stated inside the message itself, so a signature made against a
// stale challenge is rejected at complete_challenge rather than here. The
// client asks for a fresh one rather than retrying an old signature.
export async function POST(request: Request) {
  let payload: { walletAddress?: unknown };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { walletAddress } = payload;

  if (typeof walletAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return NextResponse.json(
      { error: "walletAddress must be a 0x EVM address" },
      { status: 400 },
    );
  }

  try {
    const challenge = await ondoGetChallenge(walletAddress);
    return NextResponse.json(challenge);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
