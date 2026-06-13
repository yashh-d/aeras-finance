import { NextResponse } from "next/server";
import { authenticate } from "@/lib/privy/auth";
import { syncFromPrivy, toView } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called after Privy login with the access token in the Authorization header.
// Verifies the token, merges the identity into the users table (creating the
// row if needed), and returns the access status the gate routes on.
export async function POST(request: Request) {
  const identity = await authenticate(request);
  if (!identity) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const row = await syncFromPrivy(identity);
    return NextResponse.json({ ok: true, user: await toView(row) });
  } catch (err) {
    console.error("auth sync error", err);
    return NextResponse.json({ error: "Sign-in sync failed." }, { status: 500 });
  }
}
