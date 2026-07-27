// Client-side helpers for the Jupiter Trigger V2 (limit order) API.
//
// These never talk to Jupiter directly. Trigger V2 requires an x-api-key on every
// request, so all calls go through our own /api/jupiter/trigger/* route handlers,
// which attach the key server-side. The challenge-response JWT, by contrast, is a
// per-wallet bearer token that the client holds in memory and forwards on each call;
// see lib/jupiter/use-trigger-auth.ts.

export type TriggerCondition = "above" | "below";

export interface TriggerChallengeResponse {
  type: "message";
  challenge: string;
}

export interface TriggerVerifyResponse {
  token: string;
}

export interface TriggerVault {
  userPubkey: string;
  vaultPubkey: string;
  privyVaultId?: string;
}

export interface CraftDepositResponse {
  transaction: string;
  requestId: string;
  receiverAddress: string;
  mint: string;
  amount: string;
  tokenDecimals: number;
  inputTokenAccount?: string;
}

export interface CreateOrderResponse {
  id: string;
  txSignature?: string;
}

export interface TriggerOrderEvent {
  type: "deposit" | "fill" | "withdrawal" | "cancelled" | "expired";
  timestamp: number;
  state?: string;
  txSignature?: string;
  mint?: string;
  amount?: string;
}

export interface TriggerOrder {
  id: string;
  orderType: "single" | "oco" | "otoco";
  orderState: string;
  rawState?: string;
  userPubkey: string;
  inputMint: string;
  initialInputAmount: string;
  remainingInputAmount: string;
  outputMint: string;
  triggerMint: string;
  triggerCondition: TriggerCondition;
  triggerPriceUsd: number;
  slippageBps: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  events?: TriggerOrderEvent[];
}

export interface OrderHistoryResponse {
  orders: TriggerOrder[];
  pagination: { total: number; limit: number; offset: number };
}

export interface CancelInitResponse {
  id: string;
  transaction: string;
  requestId: string;
}

export interface CreateOrderParams {
  depositRequestId: string;
  depositSignedTx: string;
  userPubkey: string;
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  triggerMint: string;
  triggerCondition: TriggerCondition;
  triggerPriceUsd: number;
  slippageBps: number;
  expiresAt: number;
}

function proxyUrl(path: string): string {
  return new URL(`/api/jupiter/trigger/${path}`, window.location.origin).toString();
}

// Pull a readable message out of a proxy error body, falling back to the status.
async function errorFrom(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return new Error(body.error ?? body.message ?? fallback);
  } catch {
    return new Error(fallback);
  }
}

function authHeaders(token: string): HeadersInit {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

export async function requestChallenge(
  walletPubkey: string,
): Promise<TriggerChallengeResponse> {
  const res = await fetch(proxyUrl("auth/challenge"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ walletPubkey }),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not start authentication");
  return (await res.json()) as TriggerChallengeResponse;
}

export async function verifyChallenge(
  walletPubkey: string,
  signature: string,
): Promise<TriggerVerifyResponse> {
  const res = await fetch(proxyUrl("auth/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ walletPubkey, signature }),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Authentication failed");
  return (await res.json()) as TriggerVerifyResponse;
}

export async function getVault(token: string): Promise<TriggerVault> {
  const res = await fetch(proxyUrl("vault"), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not load trigger vault");
  return (await res.json()) as TriggerVault;
}

export async function craftDeposit(
  input: { inputMint: string; outputMint: string; userAddress: string; amount: string },
  token: string,
): Promise<CraftDepositResponse> {
  const res = await fetch(proxyUrl("deposit"), {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not prepare deposit");
  return (await res.json()) as CraftDepositResponse;
}

export async function createOrder(
  params: CreateOrderParams,
  token: string,
): Promise<CreateOrderResponse> {
  const res = await fetch(proxyUrl("orders"), {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(params),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not create limit order");
  return (await res.json()) as CreateOrderResponse;
}

export async function listOrders(
  input: { state: "active" | "past"; mint?: string },
  token: string,
): Promise<OrderHistoryResponse> {
  const url = new URL(proxyUrl("orders"));
  url.searchParams.set("state", input.state);
  if (input.mint) url.searchParams.set("mint", input.mint);
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not load orders");
  return (await res.json()) as OrderHistoryResponse;
}

export async function cancelOrderInit(
  orderId: string,
  token: string,
): Promise<CancelInitResponse> {
  const res = await fetch(proxyUrl(`orders/cancel/${orderId}`), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not start cancellation");
  return (await res.json()) as CancelInitResponse;
}

export async function confirmCancelOrder(
  orderId: string,
  input: { signedTransaction: string; cancelRequestId: string },
  token: string,
): Promise<void> {
  const res = await fetch(proxyUrl(`orders/confirm-cancel/${orderId}`), {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, "Could not confirm cancellation");
}
