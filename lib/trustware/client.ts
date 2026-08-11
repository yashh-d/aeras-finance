// Browser-side helpers that call our own Trustware proxy routes. The proxy
// injects the server-only API key and enforces the destination allowlist, so the
// client never sees TRUSTWARE_API_KEY.

import type { EquivalentBalances } from "./balances";
import type { TrustwareQuoteRequest, TrustwareQuoteResponse } from "./types";

async function postProxy(
  path: string,
  req: TrustwareQuoteRequest,
): Promise<TrustwareQuoteResponse> {
  const res = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  const body = (await res.json()) as TrustwareQuoteResponse;
  if (!res.ok) {
    throw new Error(body.error ?? `Trustware proxy ${path} failed: ${res.status}`);
  }
  return body;
}

export function fetchTrustwareQuoteViaProxy(
  req: TrustwareQuoteRequest,
): Promise<TrustwareQuoteResponse> {
  return postProxy("/api/trustware/quote", req);
}

export function fetchTrustwareRouteViaProxy(
  req: TrustwareQuoteRequest,
): Promise<TrustwareQuoteResponse> {
  return postProxy("/api/trustware/route", req);
}

// Convertible holdings across both of the user's addresses. Either may be
// omitted; passing neither is a caller error.
export async function fetchEquivalentBalancesViaProxy(args: {
  solanaAddress?: string;
  evmAddress?: string;
}): Promise<EquivalentBalances> {
  const params = new URLSearchParams();
  if (args.solanaAddress) params.set("solana", args.solanaAddress);
  if (args.evmAddress) params.set("evm", args.evmAddress);

  const res = await fetch(`/api/trustware/balances?${params}`, {
    cache: "no-store",
  });
  const body = (await res.json()) as EquivalentBalances & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Trustware balances proxy failed: ${res.status}`);
  }
  return body;
}
