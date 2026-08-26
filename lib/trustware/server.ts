// Server-only Trustware client. Reads TRUSTWARE_API_KEY (no NEXT_PUBLIC_ prefix)
// and injects it as X-API-Key. Per Trustware's docs the REST key must never reach
// the browser, so this module is imported only from app/api/trustware/* routes.

import "server-only";

import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";
import { USDC_MINT } from "@/lib/jupiter/constants";
import {
  MONAD_CHAIN_ID,
  MONAD_NATIVE_TOKEN,
  MONAD_USDC,
} from "@/lib/morpho/constants";
import { ONDO_MARGIN_TOKEN_ADDRESSES } from "@/lib/ondo/collateral";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_DATA_BASE_URL,
  TRUSTWARE_EVM_RPC_BASE_URL,
  TRUSTWARE_INTENT_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "./constants";
import { findSwapToken, isSamePair } from "./swap-tokens";
import type {
  TrustwareAllowanceResponse,
  TrustwareBalancesResponse,
  TrustwareQuoteRequest,
  TrustwareQuoteResponse,
  TrustwareReceiptResponse,
  TrustwareStatusResponse,
} from "./types";

// Deposit destinations: the canonical Solana xStock mints that Jupiter Lend
// borrow vaults accept as collateral.
const ALLOWED_DEST_MINTS = new Set(
  XSTOCK_BORROW_VAULTS.map((v) => v.collateralMint),
);

// Funding destinations for the Morpho-on-Monad earn venue, delivered to the
// user's embedded EVM wallet: USDC (the deposit asset) and native MON (the gas
// top-up so the wallet can sign the approve and deposit).
const MONAD_CHAIN = String(MONAD_CHAIN_ID);
const MONAD_FUNDING_TOKENS = new Set([
  MONAD_USDC.address.toLowerCase(),
  MONAD_NATIVE_TOKEN.toLowerCase(),
]);

// Margin destinations for Ondo Perps, delivered to the deposit address Ondo
// provisioned for the user's account. Ethereum only: Ondo credits no other
// network, and `provision_address` answers service_unavailable for Solana.
//
// The destination address here is NOT the user's own wallet, which is the one
// place this differs from every other shape below. Ondo's deposit addresses are
// permanently bound to an account and credit any supported asset sent to them,
// so routing the bridge straight at one removes the Ethereum gas problem
// entirely: the user never needs ETH, never switches chains, and signs once on
// Solana. What it costs is recoverability, since the funds land somewhere the
// user cannot sign for. lib/ondo/fund.ts is where that tradeoff is guarded.
const ETHEREUM_CHAIN = "1";

// Atomic amounts cross the wire as decimal strings. Anything else is rejected
// rather than forwarded, so a caller cannot smuggle scientific notation or a
// negative through to the upstream.
const ATOMIC_AMOUNT = /^\d+$/;

// Validate an incoming quote/route request. Returns an error string for the
// caller to surface as a 400, or null when valid.
//
// This is the control that keeps the key-bearing proxy from being used as an
// open cross-chain swap for arbitrary tokens. There are exactly five shapes it
// accepts, and all are allowlists resolved server-side from hardcoded
// registries. None takes the caller's word for what is permissible:
//
//   deposit  anything -> a Jupiter Lend vault's collateral mint on Solana.
//            The destination set is XSTOCK_BORROW_VAULTS. The source is
//            unconstrained here because the planner has already matched it
//            against the equivalence registry, and a wrong source can only
//            waste the caller's own funds.
//
//   funding  anything -> USDC or native MON on Monad, delivered to an EVM
//            address. The legs that fund a Morpho-on-Monad earn deposit (USDC
//            is the deposit asset, MON is the gas top-up). Same trust model as
//            deposit: the destination tokens and chain are pinned here, the
//            source is constrained by the client planner, and a wrong source
//            can only waste the caller's own funds.
//
//   return   anything -> canonical USDC on Solana, delivered to a Solana
//            address. The reverse of funding: money the user parked on Monad
//            (or another chain) coming home to the primary wallet. Destination
//            token and chain pinned here, same trust model as funding.
//
//   margin   anything -> an Ondo Perps collateral token on Ethereum, delivered
//            to an Ondo-provisioned deposit address. The destination token set
//            is ONDO_MARGIN_TOKENS, pinned in lib/ondo/collateral.ts and
//            asserted against Ondo's live token config by
//            scripts/ondo-collateral-check.mts. Unlike every other shape the
//            recipient is not the user's own wallet, so the caller-supplied
//            address is checked against Ondo before the route is built, in
//            lib/ondo/fund.ts, not here.
//
//   swap     a curated token -> a curated token, either direction, including
//            EVM destinations. BOTH sides must be in SWAP_TOKENS. Widening this
//            to "either side" would turn the proxy back into an open relay.
//
// Adding a token to lib/trustware/swap-tokens.ts widens this boundary, so that
// file is the thing to review, not this function.
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
  if (!ATOMIC_AMOUNT.test(req.fromAmount!)) {
    return "fromAmount must be an atomic decimal string";
  }
  // Both addresses are echoed to the upstream and one of them is a payout
  // destination, so neither is taken on trust.
  if (!isSupportedAddress(req.fromAddress!)) {
    return "fromAddress is not a supported address";
  }
  if (!isSupportedAddress(req.toAddress!)) {
    return "toAddress is not a supported address";
  }
  if (!req.toChain) return "toChain is required";
  if (!req.toToken) return "toToken is required";

  const isDeposit =
    req.toChain === TRUSTWARE_SOLANA_CHAIN && ALLOWED_DEST_MINTS.has(req.toToken);
  if (isDeposit) return null;

  const isMorphoFunding =
    req.toChain === MONAD_CHAIN &&
    MONAD_FUNDING_TOKENS.has(req.toToken.toLowerCase()) &&
    EVM_ADDRESS.test(req.toAddress!);
  if (isMorphoFunding) return null;

  const isFundingReturn =
    req.toChain === TRUSTWARE_SOLANA_CHAIN &&
    req.toToken === USDC_MINT &&
    SOLANA_ADDRESS.test(req.toAddress!);
  if (isFundingReturn) return null;

  const isOndoMargin =
    req.toChain === ETHEREUM_CHAIN &&
    ONDO_MARGIN_TOKEN_ADDRESSES.has(req.toToken.toLowerCase()) &&
    EVM_ADDRESS.test(req.toAddress!);
  if (isOndoMargin) return null;

  const from = findSwapToken(req.fromChain!, req.fromToken!);
  const to = findSwapToken(req.toChain, req.toToken);
  if (!from || !to) {
    return "that pair is not available to swap";
  }
  if (isSamePair(from, to)) {
    return "the source and destination are the same token";
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
