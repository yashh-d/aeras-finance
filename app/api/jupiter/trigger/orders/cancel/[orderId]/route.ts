import { NextResponse } from "next/server";
import { bearer, requireApiKey, triggerProxy } from "@/lib/jupiter/trigger-server";

export const dynamic = "force-dynamic";

// Step 1 of cancellation: moves the order to ready_to_cancel and returns an
// unsigned withdrawal transaction. The client signs it, then calls confirm-cancel.
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

  const { orderId } = await params;
  return triggerProxy(`/orders/price/cancel/${orderId}`, {
    method: "POST",
    apiKey: auth.key,
    authorization,
  });
}
