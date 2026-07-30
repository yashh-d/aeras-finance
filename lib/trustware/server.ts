// Server-only Trustware client. Reads TRUSTWARE_API_KEY (no NEXT_PUBLIC_ prefix)
// and injects it as X-API-Key. Per Trustware's docs the REST key must never reach
// the browser, so this module is imported only from app/api/trustware/* routes.

import "server-only";

import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";
import { TRUSTWARE_API_BASE_URL, TRUSTWARE_SOLANA_CHAIN } from "./constants";
import type { TrustwareQuoteRequest, TrustwareQuoteResponse } from "./types";

// The only destinations we let the proxy route to: the canonical Solana xStock
// mints that Jupiter Lend borrow vaults accept as collateral. This keeps the
// key-bearing proxy from being used as an open cross-chain swap for arbitrary
// tokens.
const ALLOWED_DEST_MINTS = new Set(
  XSTOCK_BORROW_VAULTS.map((v) => v.collateralMint),
);

// Validate an incoming quote/route request against the allowlist. Returns an
// error string for the caller to surface as a 400, or null when valid.
export function validateTrustwareRequest(
  req: Partial<TrustwareQuoteRequest>,
): string | null {
  const required: (keyof TrustwareQuoteRequest)[] = [
    "fromChain",
    "fromToken",
    "fromAmount",
    "fromAddress",
    "toAddress",
  ];
  for (const field of required) {
    if (!req[field]) return `${field} is required`;
  }
  if (req.toChain !== TRUSTWARE_SOLANA_CHAIN) {
    return `toChain must be ${TRUSTWARE_SOLANA_CHAIN}`;
  }
  if (!req.toToken || !ALLOWED_DEST_MINTS.has(req.toToken)) {
    return "toToken is not a supported xStock destination";
  }
  return null;
}

const UPSTREAM_TIMEOUT_MS = 12_000;
const UPSTREAM_RETRIES = 2;

function apiKey(): string {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) {
    throw new Error("TRUSTWARE_API_KEY is not set");
  }
  return key;
}

// POST to a Trustware routes endpoint with timeout + retry. `path` is appended
// to TRUSTWARE_API_BASE_URL (e.g. "/quote", "/route").
async function trustwarePost(
  path: string,
  body: unknown,
): Promise<TrustwareQuoteResponse> {
  const key = apiKey();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= UPSTREAM_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(`${TRUSTWARE_API_BASE_URL}${path}`, {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timeout);
      const text = await res.text();
      let parsed: TrustwareQuoteResponse;
      try {
        parsed = JSON.parse(text) as TrustwareQuoteResponse;
      } catch {
        throw new Error(`Trustware ${path}: non-JSON response (${res.status})`);
      }
      if (!res.ok) {
        throw new Error(
          `Trustware ${path} ${res.status}: ${parsed.error ?? text.slice(0, 200)}`,
        );
      }
      return parsed;
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (attempt < UPSTREAM_RETRIES) {
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1) ** 2));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Trustware ${path}: ${String(lastErr)}`);
}

export function trustwareQuote(
  req: TrustwareQuoteRequest,
): Promise<TrustwareQuoteResponse> {
  return trustwarePost("/quote", req);
}

export function trustwareRoute(
  req: TrustwareQuoteRequest,
): Promise<TrustwareQuoteResponse> {
  return trustwarePost("/route", req);
}
