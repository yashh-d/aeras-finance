import { NextResponse } from "next/server";
import {
  bearer,
  isAllowedPair,
  requireApiKey,
  triggerProxy,
} from "@/lib/jupiter/trigger-server";

export const dynamic = "force-dynamic";

// List orders. `state` is "active" or "past"; `mint` filters by input/output mint.
export async function GET(request: Request) {
  const auth = requireApiKey();
  if ("error" in auth) return auth.error;

  const authorization = bearer(request);
  if (!authorization) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state") ?? "active";
  const mint = searchParams.get("mint");

  const query = new URLSearchParams({ state, limit: "100" });
  if (mint) query.set("mint", mint);

  return triggerProxy(`/orders/history?${query.toString()}`, {
    apiKey: auth.key,
    authorization,
  });
}

// Create a single (limit) order.
export async function POST(request: Request) {
  const auth = requireApiKey();
  if ("error" in auth) return auth.error;

  const authorization = bearer(request);
  if (!authorization) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as {
    depositRequestId?: string;
    depositSignedTx?: string;
    userPubkey?: string;
    inputMint?: string;
    inputAmount?: string;
    outputMint?: string;
    triggerMint?: string;
    triggerCondition?: "above" | "below";
    triggerPriceUsd?: number;
    slippageBps?: number;
    expiresAt?: number;
  };

  const required = [
    body.depositRequestId,
    body.depositSignedTx,
    body.userPubkey,
    body.inputMint,
    body.inputAmount,
    body.outputMint,
    body.triggerMint,
    body.triggerCondition,
    body.triggerPriceUsd,
    body.expiresAt,
  ];
  if (required.some((v) => v == null || v === "")) {
    return NextResponse.json(
      { error: "Missing required order fields" },
      { status: 400 },
    );
  }
  if (!isAllowedPair(body.inputMint!, body.outputMint!)) {
    return NextResponse.json(
      { error: "Unsupported mint pair for v1" },
      { status: 400 },
    );
  }

  return triggerProxy("/orders/price", {
    method: "POST",
    apiKey: auth.key,
    authorization,
    body: { orderType: "single", ...body },
  });
}
