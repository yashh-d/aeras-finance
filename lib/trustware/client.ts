// Browser-side helpers that call our own Trustware proxy routes. The proxy
// injects the server-only API key and enforces the destination allowlist, so the
// client never sees TRUSTWARE_API_KEY.

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
