import { NextResponse } from "next/server";
import { requireApiKey, triggerProxy } from "@/lib/jupiter/trigger-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = requireApiKey();
  if ("error" in auth) return auth.error;

  const body = (await request.json()) as {
    walletPubkey?: string;
    signature?: string;
  };
  if (!body.walletPubkey || !body.signature) {
    return NextResponse.json(
      { error: "walletPubkey and signature are required" },
      { status: 400 },
    );
  }

  return triggerProxy("/auth/verify", {
    method: "POST",
    apiKey: auth.key,
    body: {
      type: "message",
      walletPubkey: body.walletPubkey,
      signature: body.signature,
    },
  });
}
