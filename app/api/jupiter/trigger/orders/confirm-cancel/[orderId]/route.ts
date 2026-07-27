import { NextResponse } from "next/server";
import { bearer, requireApiKey, triggerProxy } from "@/lib/jupiter/trigger-server";

export const dynamic = "force-dynamic";

// Step 2 of cancellation: submit the signed withdrawal transaction to finalize.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const auth = requireApiKey();
  if ("error" in auth) return auth.error;

  const authorization = bearer(request);
  if (!authorization) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as {
    signedTransaction?: string;
    cancelRequestId?: string;
  };
  if (!body.signedTransaction || !body.cancelRequestId) {
    return NextResponse.json(
      { error: "signedTransaction and cancelRequestId are required" },
      { status: 400 },
    );
  }

  const { orderId } = await params;
  return triggerProxy(`/orders/price/confirm-cancel/${orderId}`, {
    method: "POST",
    apiKey: auth.key,
    authorization,
    body,
  });
}
