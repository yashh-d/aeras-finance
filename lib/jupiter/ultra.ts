import { numberToAtomicString } from "@/lib/decimal";
import { JUPITER_ULTRA_BASE_URL } from "./constants";

export interface UltraOrderParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker?: string;
}

export interface UltraPlatformFee {
  feeBps: number;
  feeMint: string;
}

export interface UltraOrderResponse {
  // Quote
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  inUsdValue: number;
  outUsdValue: number;
  swapUsdValue: number;
  slippageBps: number;
  feeBps: number;
  priceImpactPct: number;
  swapMode: "ExactIn" | "ExactOut";
  router: string;
  swapType?: string;
  platformFee?: UltraPlatformFee;
  // Tx + execution metadata (only when `taker` is supplied and no error)
  transaction?: string;
  requestId: string;
  gasless?: boolean;
  prioritizationFeeLamports?: number;
  rentFeeLamports?: number;
  signatureFeeLamports?: number;
  // Who actually pays the signature fee. Jupiter's docs call comparing this to
  // the taker "the deterministic opt-out" for gasless, and describe `gasless`
  // as a summary of three separate paths (automatic sponsorship, a JupiterZ
  // market maker, an integrator payer). Null when the transaction could not be
  // built, which is why it is optional.
  signatureFeePayer?: string | null;
  // Errors (Ultra returns these in-band, not as HTTP errors)
  error?: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface UltraExecuteResponse {
  status: "Success" | "Failed";
  signature?: string;
  slot?: string;
  code?: number;
  error?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
}

export async function fetchUltraOrderDirect(
  params: UltraOrderParams,
): Promise<UltraOrderResponse> {
  const url = new URL(`${JUPITER_ULTRA_BASE_URL}/order`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount);
  if (params.taker) url.searchParams.set("taker", params.taker);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    // Ultra puts the reason in the body — {"error":"Invalid taker"} — and it is
    // the only thing that distinguishes one 400 from another. Dropping it left
    // the ticket able to report a number and nothing else.
    throw new Error(
      `Jupiter Ultra /order failed: ${res.status}${await upstreamReason(res)}`,
    );
  }
  return (await res.json()) as UltraOrderResponse;
}

// The upstream's own explanation, as " — <reason>", or "" when it gave none.
// Truncated because an error page rather than a JSON body would otherwise
// arrive in full at a toast in the UI.
async function upstreamReason(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  let reason = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    reason = (parsed.error ?? parsed.message ?? reason).trim();
  } catch {
    // Not JSON. Keep the raw text.
  }
  if (!reason) return "";
  return ` — ${reason.length > 200 ? `${reason.slice(0, 200)}…` : reason}`;
}

export async function fetchUltraOrderViaProxy(
  params: UltraOrderParams,
): Promise<UltraOrderResponse> {
  const url = new URL("/api/jupiter/order", window.location.origin);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount);
  if (params.taker) url.searchParams.set("taker", params.taker);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as
    | (UltraOrderResponse & { error?: string })
    | null;
  if (!res.ok) {
    // The route answers a failure as { error }, carrying Jupiter's own words.
    // Reporting the status alone here threw that away a second time.
    throw new Error(body?.error ?? `Order proxy failed: ${res.status}`);
  }
  if (!body) throw new Error("Order proxy returned an unreadable response");
  return body;
}

export async function executeUltraOrder(input: {
  signedTransaction: string;
  requestId: string;
}): Promise<UltraExecuteResponse> {
  const res = await fetch(`${JUPITER_ULTRA_BASE_URL}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  // Ultra's /execute returns 200 even on failed swaps; check `status` in body.
  return (await res.json()) as UltraExecuteResponse;
}

export function toAtomic(amount: number, decimals: number): string {
  // String math to avoid float precision loss for token amounts. Shared, not
  // inlined here: three modules had their own copy and all three broke on an
  // amount small enough for toString to go exponential. See lib/decimal.ts.
  return numberToAtomicString(amount, decimals);
}

export function fromAtomic(atomic: string, decimals: number): number {
  const padded = atomic.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  return Number(`${whole}.${frac}`);
}
