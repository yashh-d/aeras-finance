import { NextResponse } from "next/server";
import {
  bearer,
  isAllowedPair,
  requireApiKey,
  triggerProxy,
} from "@/lib/jupiter/trigger-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = requireApiKey();
  if ("error" in auth) return auth.error;

  const authorization = bearer(request);
  if (!authorization) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as {
    inputMint?: string;
    outputMint?: string;
    userAddress?: string;
    amount?: string;
  };
  if (!body.inputMint || !body.outputMint || !body.userAddress || !body.amount) {
    return NextResponse.json(
      { error: "inputMint, outputMint, userAddress, and amount are required" },
      { status: 400 },
    );
  }
  if (!isAllowedPair(body.inputMint, body.outputMint)) {
    return NextResponse.json(
      { error: "Unsupported mint pair for v1" },
      { status: 400 },
    );
  }

  return triggerProxy("/deposit/craft", {
    method: "POST",
    apiKey: auth.key,
    authorization,
    body: {
      inputMint: body.inputMint,
      outputMint: body.outputMint,
      userAddress: body.userAddress,
      amount: body.amount,
      orderType: "price",
      orderSubType: "single",
    },
  });
}
