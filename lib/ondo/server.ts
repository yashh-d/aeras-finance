import { ONDO_API_BASE_URL, ONDO_AUTH_CHAIN_ID } from "./constants";
import type {
  OndoAccount,
  OndoAddressBookChallengeRequest,
  OndoAddressBookCompleteRequest,
  OndoAddressBookResult,
  OndoBalance,
  OndoDeposit,
  OndoChallenge,
  OndoContract,
  OndoEnvelope,
  OndoHistory,
  OndoMarketsResult,
  OndoMaxOrderSizes,
  OndoOrder,
  OndoOrderRequest,
  OndoPosition,
  OndoProvisionAddressRequest,
  OndoProvisionedAddress,
  OndoSessionToken,
  OndoWalletWithdrawal,
  OndoWithdrawRequest,
  OndoWithdrawalLimits,
  OndoWithdrawalResult,
  OndoWithdrawalStatusResult,
} from "./types";

// Server-side calls to Ondo Perps. Everything the browser needs goes through an
// API route rather than direct, matching the Trustware proxies: it keeps the
// builder code and any future API key server-only, and it sidesteps the CORS
// allowlisting the integration guide describes, since server-to-server requests
// carry no browser origin.
//
// The reads below need no authentication, which is why the market catalog and
// hedge sizing can be built and verified before Ondo issues a builder code.

// Ondo returns 403 to requests without a browser-like User-Agent.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Ondo answers a rejected request with HTTP 400 and a populated envelope, so
// the error_code is only reachable by parsing the body of a non-ok response.
// Throwing on `!response.ok` before reading it would turn every named reason
// ("insufficient_margin", "reduce_only_no_open_position") into an opaque 400.
export class OndoApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(path: string, status: number, message: string, code?: string) {
    super(`Ondo Perps ${path}: ${message}`);
    this.name = "OndoApiError";
    this.status = status;
    this.code = code;
  }
}

interface OndoRequestInit {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  token?: string;
  baseUrl?: string;
}

async function ondoRequest<T>(path: string, init: OndoRequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  const response = await fetch(`${init.baseUrl ?? ONDO_API_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  const text = await response.text();
  let body: OndoEnvelope<T>;
  try {
    body = JSON.parse(text) as OndoEnvelope<T>;
  } catch {
    throw new OndoApiError(path, response.status, text.slice(0, 200) || "unreadable response");
  }

  if (!body.success || body.result === undefined) {
    throw new OndoApiError(
      path,
      response.status,
      body.error ?? body.error_code ?? `http ${response.status}`,
      body.error_code,
    );
  }
  return body.result;
}

function ondoGet<T>(path: string, baseUrl = ONDO_API_BASE_URL): Promise<T> {
  return ondoRequest<T>(path, { baseUrl });
}

// Static config: increments, leverage brackets, position caps, and the
// tokenConfig that says which assets are valid collateral on which chains.
//
// `baseUrl` exists so the verification script can read both environments in one
// run and diff them. App code should leave it alone: reading a catalog from an
// environment other than the one orders go to is how a hedge gets sized against
// the wrong market.
export function ondoMarkets(baseUrl?: string): Promise<OndoMarketsResult> {
  return ondoGet<OndoMarketsResult>("/v1/markets", baseUrl);
}

// Live tickers: prices, isClosed, funding. Disjoint from the static config.
export function ondoContracts(baseUrl?: string): Promise<OndoContract[]> {
  return ondoGet<OndoContract[]>("/v1/perps/contracts", baseUrl);
}

// ---------------------------------------------------------------------------
// Authenticated. Everything below carries the user's own SIWE-issued JWT.
//
// The JWT authorises trading on their Ondo account, so it never reaches page
// JavaScript: it is minted here, stored in an httpOnly cookie by
// lib/ondo/session.ts, and read back here on the next request. The browser
// signs the challenge and sees nothing else.
// ---------------------------------------------------------------------------

// Step 1 of SIWE. Ondo mints a challenge for any address with no invite code
// and no builder code, in both environments (verified 2026-08-25), so this is
// not gated on anything we had to be granted.
//
// The builder code used to be passed here and baked into the JWT. Guide v1.0.5
// removed that flow and the field is gone from the live request schema. It goes
// on each order instead, via lib/ondo/builder.ts.
export function ondoGetChallenge(walletAddress: string): Promise<OndoChallenge> {
  return ondoRequest<OndoChallenge>("/v1/auth/erc-4361/login/get_challenge", {
    method: "POST",
    body: { walletAddress, chainId: ONDO_AUTH_CHAIN_ID },
  });
}

// Step 2. The signature is over the challenge message verbatim, personal_sign
// style, produced by the user's embedded EVM wallet in the browser.
export function ondoCompleteChallenge(
  id: string,
  signature: string,
): Promise<OndoSessionToken> {
  return ondoRequest<OndoSessionToken>("/v1/auth/erc-4361/login/complete_challenge", {
    method: "POST",
    body: { id, signature },
  });
}

// Accepting Ondo's terms of service and privacy policy on the user's behalf.
//
// Deliberately not called anywhere in the sign-in path. This is consent, and it
// has to be an explicit action the user takes with the documents in front of
// them, not a side effect of logging in. Reads work without it: a fresh account
// sits at termsVersion 0 and still returns balance, positions and orders.
//
// Not present in Ondo's OpenAPI spec, only in the integration guide. Live and
// working, but treat the versions as something to re-check.
export function ondoAcceptTerms(
  token: string,
  versions: { termsVersion: number; privacyVersion: number },
): Promise<unknown> {
  return ondoRequest<unknown>("/v1/agreement", {
    method: "POST",
    body: versions,
    token,
  });
}

export function ondoAccount(token: string): Promise<OndoAccount> {
  return ondoRequest<OndoAccount>("/v1/account", { token });
}

export function ondoBalance(token: string): Promise<OndoBalance> {
  return ondoRequest<OndoBalance>("/v1/perps/balance", { token });
}

// What was actually deposited, newest first.
//
// The only endpoint that names the asset. /v1/perps/balance is pooled totals
// and there is no spot-balance endpoint at all, because Ondo runs one unified
// account: "There is no separate spot wallet. Collateral is part of your margin
// account." So after a self-collateralized hedge this is what proves the
// SPCXon is there and how much of it went in.
export function ondoDeposits(token: string): Promise<OndoDeposit[]> {
  return ondoRequest<OndoDeposit[]>("/v1/wallet/deposits", { token });
}

export function ondoPositions(token: string): Promise<OndoPosition[]> {
  return ondoRequest<OndoPosition[]>("/v1/perps/positions", { token });
}

// Ondo's own ceiling on what this account can trade right now, in base units.
// A short reads maxAskBaseSize; there is no side parameter. `buffer` scales the
// answer down to absorb price drift between quoting and placing, and Ondo
// defaults it to 0.9 when omitted.
export function ondoMaxOrderSize(
  token: string,
  market: string,
  buffer?: number,
): Promise<OndoMaxOrderSizes> {
  const query = new URLSearchParams({ market });
  if (buffer !== undefined) query.set("buffer", String(buffer));

  return ondoRequest<OndoMaxOrderSizes>(`/v1/perps/max_order_size?${query}`, { token });
}

// The one call in this file that moves money. Callers build the request through
// lib/ondo/orders.ts rather than assembling it inline, so the builder code and
// the market-order field combination cannot be got wrong at a call site.
export function ondoPlaceOrder(
  token: string,
  order: OndoOrderRequest,
): Promise<OndoOrder> {
  return ondoRequest<OndoOrder>("/v1/perps/orders", {
    method: "POST",
    body: order,
    token,
  });
}

export function ondoOrder(token: string, orderId: string): Promise<OndoOrder> {
  return ondoRequest<OndoOrder>(`/v1/perps/orders/${encodeURIComponent(orderId)}`, {
    token,
  });
}

export function ondoCancelOrder(token: string, orderId: string): Promise<unknown> {
  return ondoRequest<unknown>(`/v1/perps/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE",
    token,
  });
}

// Leverage is per market but collateral stays pooled: margin is cross only,
// there is no isolated mode. So this changes how much margin a position on one
// market reserves, not which collateral backs it.
//
// Ondo refuses a value above the market's own maximum, and refuses to *reduce*
// leverage when the open position could no longer be supported at the lower
// setting, answering `insufficient_margin` rather than partially applying it.
export function ondoSetLeverage(
  token: string,
  market: string,
  leverage: number,
): Promise<unknown> {
  return ondoRequest<unknown>("/v1/perps/leverage", {
    method: "POST",
    body: { market, leverage },
    token,
  });
}

// Chart history. Unauthenticated, and the one endpoint that does not use the
// response envelope: it answers a TradingView-style UDF payload with `s`, `t`,
// `o`, `h`, `l`, `c`, `v` at the top level.
//
// **The symbol format differs from every other endpoint.** Orders take
// `XAU-USD.P`; this takes `XAUUSD.P`, unhyphenated. The hyphenated form does
// not error, it returns `s: "ok"` with empty arrays, so a chart built by
// passing the order symbol renders blank and looks like missing liquidity.
// Never derive it by string surgery: every market carries `displayName`, and
// `displayName + ".P"` is exactly right across all of them.
export async function ondoHistory(
  symbol: string,
  resolution: string,
  to: number,
  countback: number,
): Promise<OndoHistory> {
  const query = new URLSearchParams({
    symbol,
    resolution,
    to: String(to),
    countback: String(countback),
  });

  const response = await fetch(`${ONDO_API_BASE_URL}/v1/perps/history?${query}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new OndoApiError("/v1/perps/history", response.status, `http ${response.status}`);
  }
  return (await response.json()) as OndoHistory;
}

// Provisions the deposit address the funding leg pays into. The address is
// permanently bound to the account, so this is idempotent in effect: call it
// once per asset and cache the answer rather than on every deposit.
//
// `network` is ethereum for every asset the hedge uses. The request schema
// still advertises solana and avalanche; the live token config does not carry a
// Solana path for anything, USDC included.
export function ondoProvisionAddress(
  token: string,
  request: OndoProvisionAddressRequest,
): Promise<OndoProvisionedAddress> {
  return ondoRequest<OndoProvisionedAddress>("/v1/provision_address", {
    method: "POST",
    body: request,
    token,
  });
}

// ---------------------------------------------------------------------------
// Withdrawals: the way out.
//
// Deposits and withdrawals are not symmetric here and the asymmetry is the
// whole shape of this section. A deposit needs an address from Ondo and a
// transfer we perform. A withdrawal needs an address from us, registered ahead
// of time with its own signature, and a transfer Ondo performs. That second
// difference is why the user needs no ETH for this leg: Ondo pays the gas on
// the Ethereum transfer out.
// ---------------------------------------------------------------------------

// Step 1 of registering a payout address.
//
// A valid session is deliberately not enough to add one. Ondo re-authorises
// this with a fresh wallet signature, which is the right call: a session cookie
// is a bearer credential for 24 hours, and adding a withdrawal address is the
// one action that could drain an account rather than merely trade it.
//
// The signing chain is Ethereum mainnet, matching login. It is unrelated to
// where the withdrawal lands.
export function ondoAddressBookChallenge(
  token: string,
  request: OndoAddressBookChallengeRequest,
): Promise<OndoChallenge> {
  return ondoRequest<OndoChallenge>("/v1/auth/erc-4361/address_book/get_challenge", {
    method: "POST",
    body: request,
    token,
  });
}

// Step 2. Same five-minute challenge expiry as login, so a stale prompt needs a
// new challenge rather than a retry of the signature.
export function ondoAddressBookComplete(
  token: string,
  request: OndoAddressBookCompleteRequest,
): Promise<unknown> {
  return ondoRequest<unknown>("/v1/auth/erc-4361/address_book/complete_challenge", {
    method: "POST",
    body: request,
    token,
  });
}

// Registered payout addresses. `POST /v1/withdraw` refuses anything absent from
// here with `withdrawal_address_not_found`, so this is the gate on where money
// can go, and reading it is how the UI knows whether a signature is still owed.
export function ondoAddressBook(token: string): Promise<OndoAddressBookResult> {
  return ondoRequest<OndoAddressBookResult>("/v1/wallet/address_book", { token });
}

export function ondoRemoveAddressBookEntry(
  token: string,
  withdrawalAddress: string,
): Promise<unknown> {
  return ondoRequest<unknown>("/v1/wallet/address_book", {
    method: "DELETE",
    body: { withdrawalAddress },
    token,
  });
}

// The second call in this file that moves money, and the only one that moves it
// off the exchange. Callers build the request through lib/ondo/withdraw.ts so
// the idempotency key, the network and the destination cannot be assembled
// wrongly at a call site.
export function ondoWithdraw(
  token: string,
  request: OndoWithdrawRequest,
): Promise<OndoWithdrawalResult> {
  return ondoRequest<OndoWithdrawalResult>("/v1/withdraw", {
    method: "POST",
    body: request,
    token,
  });
}

// Withdrawal history, newest first. Paired with ondoDeposits this is the only
// per-asset ledger Ondo exposes: there is no endpoint that returns a per-asset
// balance, so held quantity has to be reconstructed from the two.
export function ondoWithdrawals(token: string): Promise<OndoWalletWithdrawal[]> {
  return ondoRequest<OndoWalletWithdrawal[]>("/v1/wallet/withdrawals", { token });
}

// A rolling USD cap, independent of margin. An account can sit well inside its
// withdrawable margin and still be refused with `withdrawal_limit_exceeded`, so
// this is read before a withdrawal is offered rather than after it fails.
export function ondoWithdrawalLimits(token: string): Promise<OndoWithdrawalLimits> {
  return ondoRequest<OndoWithdrawalLimits>("/v1/wallet/withdrawals/limit", { token });
}

// Status of one withdrawal. Takes exactly one of the two ids; passing both is
// rejected upstream, so the caller picks.
export function ondoWithdrawalStatus(
  token: string,
  id: { withdrawal_id: string } | { customer_withdrawal_id: string },
): Promise<OndoWithdrawalStatusResult> {
  return ondoRequest<OndoWithdrawalStatusResult>("/v1/get_withdrawal_status", {
    method: "POST",
    body: id,
    token,
  });
}
