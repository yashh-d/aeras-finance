// Server-only Trustware client. Reads TRUSTWARE_API_KEY (no NEXT_PUBLIC_ prefix)
// and injects it as X-API-Key. Per Trustware's docs the REST key must never reach
// the browser, so this module is imported only from app/api/trustware/* routes.

import "server-only";

import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_DATA_BASE_URL,
  TRUSTWARE_EVM_RPC_BASE_URL,
  TRUSTWARE_INTENT_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "./constants";
import type {
  TrustwareAllowanceResponse,
  TrustwareBalancesResponse,
  TrustwareQuoteRequest,
  TrustwareQuoteResponse,
  TrustwareReceiptResponse,
  TrustwareStatusResponse,
} from "./types";

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

// A wallet address safe to interpolate into an upstream URL path. This is a
// security check, not a correctness one: the address is caller-supplied and goes
// straight into the request path, so anything outside these two alphabets could
// escape the endpoint and reach other parts of the key-bearing API.
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSupportedAddress(address: string): boolean {
  return EVM_ADDRESS.test(address) || SOLANA_ADDRESS.test(address);
}

// GET an absolute Trustware URL with the key attached. `label` only shapes error
// messages.
async function trustwareGet<T extends { error?: string }>(
  url: string,
  label: string,
): Promise<T> {
  const key = apiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "x-api-key": key },
    });
    const text = await res.text();
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      throw new Error(`Trustware ${label}: non-JSON response (${res.status})`);
    }
    if (!res.ok) {
      const err = new Error(
        `Trustware ${label} ${res.status}: ${parsed.error ?? text.slice(0, 200)}`,
      );
      // The caller needs to tell "no receipt submitted yet" (a normal early
      // state on /status) apart from a real failure.
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

// Cross-chain holdings for one address. Trustware scans every chain the address
// format can exist on, so an EVM address covers Ethereum and BNB Chain in a
// single call and a Solana address covers Solana. Read-only.
export function trustwareBalances(
  address: string,
): Promise<TrustwareBalancesResponse> {
  if (!isSupportedAddress(address)) {
    throw new Error("unsupported address format");
  }
  return trustwareGet<TrustwareBalancesResponse>(
    `${TRUSTWARE_DATA_BASE_URL}/balances/${encodeURIComponent(address)}`,
    "/balances",
  );
}

// Current ERC-20 allowance, read through Trustware's RPC proxy.
export function trustwareAllowance(args: {
  chainId: string;
  tokenAddress: string;
  ownerAddress: string;
  spenderAddress: string;
}): Promise<TrustwareAllowanceResponse> {
  const qs = new URLSearchParams(args);
  return trustwareGet<TrustwareAllowanceResponse>(
    `${TRUSTWARE_EVM_RPC_BASE_URL}/allowance?${qs}`,
    "/allowance",
  );
}

// Intent IDs are echoed straight back into a URL path, so they are constrained
// to the UUID-ish shape Trustware issues before being interpolated.
const INTENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidIntentId(intentId: string): boolean {
  return INTENT_ID.test(intentId);
}

// Hand the broadcast hash to Trustware so it can start tracking. Trustware
// treats this as idempotent, and if it never lands the route becomes untrackable,
// so callers should retry hard.
export async function trustwareSubmitReceipt(
  intentId: string,
  txHash: string,
): Promise<TrustwareReceiptResponse> {
  if (!isValidIntentId(intentId)) throw new Error("malformed intentId");
  const key = apiKey();
  const res = await fetch(
    `${TRUSTWARE_INTENT_BASE_URL}/${encodeURIComponent(intentId)}/receipt`,
    {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ txHash }),
    },
  );
  const text = await res.text();
  let parsed: TrustwareReceiptResponse;
  try {
    parsed = JSON.parse(text) as TrustwareReceiptResponse;
  } catch {
    throw new Error(`Trustware /receipt: non-JSON response (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(
      `Trustware /receipt ${res.status}: ${parsed.error ?? text.slice(0, 200)}`,
    );
  }
  return parsed;
}

// Route progress. Returns 404 until a receipt has been submitted, which is a
// normal early state rather than an error.
export function trustwareStatus(
  intentId: string,
): Promise<TrustwareStatusResponse> {
  if (!isValidIntentId(intentId)) throw new Error("malformed intentId");
  return trustwareGet<TrustwareStatusResponse>(
    `${TRUSTWARE_INTENT_BASE_URL}/${encodeURIComponent(intentId)}/status`,
    "/status",
  );
}
