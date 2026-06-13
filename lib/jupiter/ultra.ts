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
    throw new Error(`Jupiter Ultra /order failed: ${res.status}`);
  }
  return (await res.json()) as UltraOrderResponse;
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
  if (!res.ok) {
    throw new Error(`Order proxy failed: ${res.status}`);
  }
  return (await res.json()) as UltraOrderResponse;
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
  // String math to avoid float precision loss for token amounts.
  const [whole, frac = ""] = amount.toString().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "") || "0";
  return combined;
}

export function fromAtomic(atomic: string, decimals: number): number {
  const padded = atomic.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  return Number(`${whole}.${frac}`);
}
