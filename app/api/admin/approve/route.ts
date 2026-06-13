import { NextResponse } from "next/server";
import { approveByEmail, isValidEmail, toView } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time compare so the secret can't be guessed by timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function authorized(request: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const h =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");
  if (!h) return false;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? timingSafeEqual(m[1], secret) : false;
}

// Admin-only: flip a waitlisted user to approved. Gated by ADMIN_SECRET.
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = (body as { email?: unknown })?.email;
  if (typeof email !== "string" || !isValidEmail(email)) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 },
    );
  }

  try {
    const result = await approveByEmail(email);
    if (!result) {
      return NextResponse.json(
        { error: "No waitlist entry for that email." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      alreadyApproved: result.alreadyApproved,
      user: await toView(result.row),
    });
  } catch (err) {
    console.error("admin approve error", err);
    return NextResponse.json({ error: "Approval failed." }, { status: 500 });
  }
}
