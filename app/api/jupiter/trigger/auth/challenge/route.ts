import { NextResponse } from "next/server";
import { requireApiKey, triggerProxy } from "@/lib/jupiter/trigger-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = requireApiKey();
  if ("error" in auth) return auth.error;

  const body = (await request.json()) as { walletPubkey?: string };
  if (!body.walletPubkey) {
    return NextResponse.json({ error: "walletPubkey is required" }, { status: 400 });
  }

  return triggerProxy("/auth/challenge", {
    method: "POST",
    apiKey: auth.key,
    body: { walletPubkey: body.walletPubkey, type: "message" },
  });
}
