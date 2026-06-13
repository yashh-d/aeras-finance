import { NextResponse } from "next/server";
import { createFromForm, isValidEmail, toView } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public waitlist form. Anonymous: creates a waitlisted row keyed by email.
// Idempotent, so re-submitting the same email is safe.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = (body ?? {}) as Record<string, unknown>;
  const email = typeof data.email === "string" ? data.email : "";
  if (!email || !isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  try {
    const { created, row } = await createFromForm({
      email,
      name: str(data.name),
      reason: str(data.reason),
      walletAddress: str(data.walletAddress),
      referralCode: str(data.referral),
    });
    return NextResponse.json({ ok: true, created, user: await toView(row) });
  } catch (err) {
    console.error("waitlist route error", err);
    return NextResponse.json(
      { error: "Could not join the waitlist." },
      { status: 500 },
    );
  }
}
