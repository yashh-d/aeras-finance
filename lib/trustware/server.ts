// Server-only Trustware client. Reads TRUSTWARE_API_KEY (no NEXT_PUBLIC_ prefix)
// and injects it as X-API-Key. Per Trustware's docs the REST key must never reach
// the browser, so this module is imported only from app/api/trustware/* routes.

import "server-only";

import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import { USDC_MINT } from "@/lib/jupiter/constants";
import {
  MONAD_CHAIN_ID,
  MONAD_NATIVE_TOKEN,
  MONAD_USDC,
} from "@/lib/morpho/constants";
import { XAUT } from "@/lib/morpho/gold-market";
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

// Every curated xStock mint, which is a wider set than the four above: only
// TSLAx, SPYx, QQQx and NVDAx have Jupiter Lend borrow vaults. Used by the
// `unwind` shape, where the destination is the user's own wallet rather than a
// lending vault, so there is nothing for a vault to be required for.
const XSTOCK_MINTS = new Set(XSTOCKS.map((x) => x.mint));

// Funding destinations for the Morpho-on-Monad earn venue, delivered to the
// user's embedded EVM wallet: USDC (the deposit asset) and native MON (the gas
// top-up so the wallet can sign the approve and deposit).
const MONAD_CHAIN = String(MONAD_CHAIN_ID);
const MONAD_FUNDING_TOKENS = new Set([
  MONAD_USDC.address.toLowerCase(),
  MONAD_NATIVE_TOKEN.toLowerCase(),
]);

// Collateral destination for the Morpho Blue gold market: XAUt on Ethereum,
// delivered to the user's own embedded EVM wallet.
//
// Narrower than it looks. Native ETH is NOT here even though the gold funding
// plan buys it for gas: ETH on Ethereum is already in SWAP_TOKENS, so the swap
// shape below covers the top-up with both sides curated, and repeating it here
// would widen the boundary for no gain. The one thing this shape adds over the
// swap shape is an UNCONSTRAINED SOURCE, which is what lets a user's GLDx or
// GLDon fund a deposit without either being in the swap registry.
//
// Same trust model as the Monad funding shape: the destination token and chain
// are pinned server-side, the recipient must be an EVM address, the client
// planner constrains the source against GOLD_COLLATERAL_SOURCES, and a wrong
// source can only waste the caller's own funds. Unlike the Ondo margin shape,
// the recipient here is the user's own wallet, so nothing is unrecoverable.
const MORPHO_GOLD_COLLATERAL_TOKENS = new Set([XAUT.address.toLowerCase()]);

// Chains a Lighter margin deposit may be bridged to, and the exact USDC contract
// on each. Arbitrum and Base are the two EVM chains Lighter issues intent
// addresses for that Trustware can also reach; Ethereum is excluded because
// createIntentAddress rejects it and the direct deposit contract is a different
// path entirely.
//
// Lower-cased values, compared against a lower-cased request token, so a caller
// cannot slip a different contract through on casing alone.
const LIGHTER_MARGIN_DESTINATIONS: Record<string, string> = {
  "42161": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

// Canonical USDC a margin deposit may be funded FROM, by chain. Solana is the
// wallet the app fills first; Ethereum and Base are the EVM chains
// lib/trustware/stables.ts scans, so a balance the wallet panel shows is a
// balance this shape accepts.
//
// This is an allowlist of exact contracts, not "any token on these chains".
// Widening the source of the margin shape is the one change here that lets a
// caller spend something other than USDC, so the addresses are pinned and
// lower-cased for comparison.
//
// All three chains stables.ts scans are here, each verified to return a
// signable route to Arbitrum by scripts/lighter-margin-sources-check.mts
// (2026-08-31). BNB Chain's USDC is 18 decimals rather than 6, which is the
// detail that made a first measurement call it unroutable; see the note in
// lib/lighter/margin-sources.ts.
const LIGHTER_MARGIN_SOURCES: Record<string, string> = {
  "1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "56": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
};

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

// The shapes a request can legitimately be. Returned by the validator so the
// route handler can decide where the money is allowed to land.
export type TrustwareShape =
  | "deposit"
  | "funding"
  | "return"
  | "gold"
  | "unwind"
  | "swap"
  | "ondo-margin"
  | "lighter-margin";

export type TrustwareValidation =
  | { ok: true; shape: TrustwareShape }
  | { ok: false; error: string };

// Which embedded wallet a shape delivers to.
//
// `null` means the destination is NOT the user's own wallet and the caller's
// toAddress stands. That is true of exactly two shapes, both of which send to
// an address a third party provisioned, and both of which the caller has to
// ask for by name through `intent`.
//
// This is the table that decides whether a payout address is caller-supplied,
// so read it as the security boundary it is rather than as a lookup.
const SHAPE_DESTINATION: Record<TrustwareShape, "solana" | "evm" | null> = {
  deposit: "solana",
  funding: "evm",
  return: "solana",
  gold: "evm",
  unwind: "solana",
  swap: null, // resolved per request: the destination chain decides. See below.
  "ondo-margin": null,
  "lighter-margin": null,
};

// The address a validated request is allowed to deliver to, or null to keep
// the caller's own toAddress.
//
// Called by app/api/trustware/route with the wallets read off a verified Privy
// access token. A shape that resolves to a wallet the user does not have yet
// is an error rather than a fallback to the request body: silently honouring
// the caller's address is the exact failure this exists to prevent.
export function destinationForShape(
  shape: TrustwareShape,
  toChain: string,
  embedded: { solana: string | null; evm: string | null },
): { address: string } | { passthrough: true } | { error: string } {
  const kind =
    shape === "swap"
      ? toChain === TRUSTWARE_SOLANA_CHAIN
        ? "solana"
        : "evm"
      : SHAPE_DESTINATION[shape];

  if (kind === null) return { passthrough: true };

  const address = kind === "solana" ? embedded.solana : embedded.evm;
  if (!address) {
    return {
      error:
        kind === "solana"
          ? "No Solana wallet has been provisioned on this account yet."
          : "No EVM wallet has been provisioned on this account yet.",
    };
  }
  return { address };
}

// Validate an incoming quote/route request. Returns the shape it matched, or an
// error string for the caller to surface as a 400.
//
// This is the control that keeps the key-bearing proxy from being used as an
// open cross-chain swap for arbitrary tokens. There are exactly eight shapes it
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
//   gold     anything -> XAUt on Ethereum, delivered to an EVM address. The
//            collateral leg of the Morpho Blue gold market: a user's GLDx or
//            GLDon becomes the XAUt that market takes. Destination token and
//            chain pinned here; the source is constrained by the client planner
//            against GOLD_COLLATERAL_SOURCES, and the recipient is the user's
//            own wallet, so a wrong source only wastes the caller's own funds.
//
//   margin   anything -> an Ondo Perps collateral token on Ethereum, delivered
//            to an Ondo-provisioned deposit address. The destination token set
//            is ONDO_MARGIN_TOKENS, pinned in lib/ondo/collateral.ts and
//            asserted against Ondo's live token config by
//            scripts/ondo-collateral-check.mts. Unlike every other shape the
//            recipient is not the user's own wallet, so the caller-supplied
//            address is checked against Ondo before the route is built, in
//            lib/ondo/fund.ts, not here. Requires `intent: "ondo-margin"`.
//
//   unwind   an Ondo collateral token on Ethereum -> a curated Solana xStock,
//            delivered to a Solana address. The reverse of margin, and the last
//            leg of the Ondo exit. Both sides pinned here. Its destination set
//            is every curated xStock rather than the four with borrow vaults,
//            because it returns a token to the user's own wallet rather than
//            into a lending vault; see the note at the branch.
//
//   swap     a curated token -> a curated token, either direction, including
//            EVM destinations. BOTH sides must be in SWAP_TOKENS. Widening this
//            to "either side" would turn the proxy back into an open relay.
//
// Adding a token to lib/trustware/swap-tokens.ts widens this boundary, so that
// file is the thing to review, not this function.
//
// **Where the money lands is no longer part of the request.** Six of the eight
// shapes deliver to the user's own embedded wallet, and app/api/trustware/route
// overwrites toAddress with the address on the verified Privy identity rather
// than validating what was sent. The two that cannot (an Ondo deposit address,
// a Lighter intent address) have to name themselves through `intent`, and are
// the only shapes where a caller-supplied destination survives. See
// destinationForShape above and the `intent` branches below.
export function validateTrustwareRequest(
  req: Partial<TrustwareQuoteRequest>,
): TrustwareValidation {
  const fail = (error: string): TrustwareValidation => ({ ok: false, error });
  const match = (shape: TrustwareShape): TrustwareValidation => ({
    ok: true,
    shape,
  });

  const required: (keyof TrustwareQuoteRequest)[] = [
    "fromChain",
    "fromToken",
    "fromAmount",
    "fromAddress",
    "toAddress",
  ];
  for (const field of required) {
    if (!req[field]) return fail(`${field} is required`);
  }
  if (!ATOMIC_AMOUNT.test(req.fromAmount!)) {
    return fail("fromAmount must be an atomic decimal string");
  }
  // Both addresses are echoed to the upstream, so neither is taken on trust
  // even though only one of them can still be a caller-chosen payout
  // destination once the route handler has resolved the identity.
  if (!isSupportedAddress(req.fromAddress!)) {
    return fail("fromAddress is not a supported address");
  }
  if (!isSupportedAddress(req.toAddress!)) {
    return fail("toAddress is not a supported address");
  }
  if (!req.toChain) return fail("toChain is required");
  if (!req.toToken) return fail("toToken is required");

  // The two shapes that keep the caller's toAddress have to be asked for by
  // name, and are the only shapes considered when they are.
  //
  // This exists because inferring them is genuinely ambiguous. Ethereum USDC
  // is BOTH an Ondo margin destination (ONDO_MARGIN_TOKENS.USDC) and a curated
  // swap token, so `to Ethereum USDC` alone cannot say whether the money is
  // going to an Ondo deposit address or back to the user's own wallet. While
  // the margin shapes were tried first and every shape kept the caller's
  // address, that ambiguity cost nothing. It decides everything now: reading a
  // swap as a margin deposit would hand the caller back control of where the
  // funds land, which is the whole thing this is closing.
  //
  // Declaring an intent the request does not fit is an error rather than a
  // fall-through to another shape, for the same reason: a fall-through is how
  // a passthrough destination gets attached to a request that never earned it.
  if (req.intent === "ondo-margin") {
    return req.toChain === ETHEREUM_CHAIN &&
      ONDO_MARGIN_TOKEN_ADDRESSES.has(req.toToken.toLowerCase()) &&
      EVM_ADDRESS.test(req.toAddress!)
      ? match("ondo-margin")
      : fail("that is not a valid Ondo margin deposit");
  }
  if (req.intent === "lighter-margin") {
    const fromIsMarginUsdc =
      (req.fromChain === TRUSTWARE_SOLANA_CHAIN && req.fromToken === USDC_MINT) ||
      LIGHTER_MARGIN_SOURCES[req.fromChain!] === req.fromToken!.toLowerCase();
    return fromIsMarginUsdc &&
      LIGHTER_MARGIN_DESTINATIONS[req.toChain] === req.toToken.toLowerCase() &&
      EVM_ADDRESS.test(req.toAddress!)
      ? match("lighter-margin")
      : fail("that is not a valid Lighter margin deposit");
  }

  // Everything below delivers to the user's own embedded wallet, so none of
  // these branches inspects toAddress: the route handler overwrites it with
  // the address on the verified identity. The chain still decides which of the
  // two embedded wallets that is, in destinationForShape above.
  const isDeposit =
    req.toChain === TRUSTWARE_SOLANA_CHAIN && ALLOWED_DEST_MINTS.has(req.toToken);
  if (isDeposit) return match("deposit");

  const isMorphoFunding =
    req.toChain === MONAD_CHAIN &&
    MONAD_FUNDING_TOKENS.has(req.toToken.toLowerCase());
  if (isMorphoFunding) return match("funding");

  const isFundingReturn =
    req.toChain === TRUSTWARE_SOLANA_CHAIN && req.toToken === USDC_MINT;
  if (isFundingReturn) return match("return");

  const isGoldCollateral =
    req.toChain === ETHEREUM_CHAIN &&
    MORPHO_GOLD_COLLATERAL_TOKENS.has(req.toToken.toLowerCase());
  if (isGoldCollateral) return match("gold");

  // unwind  an Ondo collateral token on Ethereum -> the canonical Solana
  //         xStock, delivered to a Solana address. The reverse of `margin`,
  //         and the last leg of the exit: withdrawing from Ondo lands an
  //         ERC-20 on Ethereum, and this brings it home.
  //
  // Both sides are pinned server-side. The source must be one of Ondo's own
  // margin tokens, the same fixed set the margin shape uses, and the
  // destination must be a curated xStock mint.
  //
  // **The destination set here is XSTOCK_MINTS, not ALLOWED_DEST_MINTS.** The
  // deposit shape targets the four xStocks with Jupiter Lend borrow vaults,
  // because a deposit has to land somewhere it can be lent. An unwind has no
  // such requirement: it returns a token the user already owns to their own
  // wallet, and restricting it to the borrow-vault four would strand exactly
  // the assets that need it most. SPCX is the live example, since SPCXon is
  // accepted Ondo collateral and SPCXx has no borrow vault.
  //
  // This widens the boundary, so it is worth being precise about by how much:
  // the source is still the eight Ondo tokens and nothing else, the
  // destination is still the curated xStock list and nothing else, and the
  // recipient is the user's own Solana wallet. It does not become a general
  // bridge.
  const isOndoUnwind =
    req.fromChain === ETHEREUM_CHAIN &&
    ONDO_MARGIN_TOKEN_ADDRESSES.has(req.fromToken!.toLowerCase()) &&
    req.toChain === TRUSTWARE_SOLANA_CHAIN &&
    XSTOCK_MINTS.has(req.toToken);
  if (isOndoUnwind) return match("unwind");

  const from = findSwapToken(req.fromChain!, req.fromToken!);
  const to = findSwapToken(req.toChain, req.toToken);
  if (!from || !to) {
    return fail("that pair is not available to swap");
  }
  if (isSamePair(from, to)) {
    return fail("the source and destination are the same token");
  }
  return match("swap");
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
