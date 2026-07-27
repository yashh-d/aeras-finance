// Server-only helpers for proxying the Jupiter Trigger V2 API. Imported only from
// route handlers under app/api/jupiter/trigger/*, never from client code, because
// it reads JUPITER_API_KEY.

import { NextResponse } from "next/server";
import { TRIGGER_V2_BASE, USDC_MINT, SOL_MINT } from "./constants";
import { xstockByMint } from "./xstocks";

const QUOTE_MINTS = new Set([USDC_MINT, SOL_MINT]);

// Returns the configured API key, or a 500 response to bubble back to the client
// when the key is missing so the UI can show a clear, non-cryptic message.
export function requireApiKey(): { key: string } | { error: NextResponse } {
  const key = process.env.JUPITER_API_KEY;
  if (!key) {
    return {
      error: NextResponse.json(
        { error: "Limit orders are not configured. Set JUPITER_API_KEY on the server." },
        { status: 500 },
      ),
    };
  }
  return { key };
}

// The JWT the client holds in memory and forwards. We pass it straight through to
// Jupiter on authenticated endpoints.
export function bearer(request: Request): string | null {
  return request.headers.get("authorization");
}

// Limit orders are constrained to the same pairs as market orders: a curated
// xStock on one side and USDC/SOL on the other.
export function isAllowedPair(inputMint: string, outputMint: string): boolean {
  const isBuy = QUOTE_MINTS.has(inputMint) && Boolean(xstockByMint(outputMint));
  const isSell = Boolean(xstockByMint(inputMint)) && QUOTE_MINTS.has(outputMint);
  return isBuy || isSell;
}

interface TriggerFetchOptions {
  method?: "GET" | "POST" | "PATCH";
  apiKey: string;
  authorization?: string | null;
  body?: unknown;
}

// Calls Jupiter's Trigger V2 API and relays the raw status + JSON body back to the
// client. Trigger errors are returned in-band as non-2xx with a JSON body.
export async function triggerProxy(
  path: string,
  { method = "GET", apiKey, authorization, body }: TriggerFetchOptions,
): Promise<NextResponse> {
  const headers: Record<string, string> = { "x-api-key": apiKey };
  if (authorization) headers["authorization"] = authorization;
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${TRIGGER_V2_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || `Trigger request failed (${res.status})` };
  }
  return NextResponse.json(payload, { status: res.status });
}
