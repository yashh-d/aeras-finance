import { NextResponse } from "next/server";
import { bearer, requireApiKey, triggerProxy } from "@/lib/jupiter/trigger-server";

export const dynamic = "force-dynamic";

// Get-or-register: the vault may not exist on a wallet's first limit order, in
// which case Jupiter returns non-OK and we register one.
export async function GET(request: Request) {
  const auth = requireApiKey();
  if ("error" in auth) return auth.error;

  const authorization = bearer(request);
  if (!authorization) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const existing = await triggerProxy("/vault", {
    apiKey: auth.key,
    authorization,
  });
  if (existing.ok) return existing;

  return triggerProxy("/vault/register", {
    apiKey: auth.key,
    authorization,
  });
}
