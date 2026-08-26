// Browser-side reads and writes, through our own proxy routes. Mirrors
// lib/trustware/client.ts: nothing in the browser talks to Ondo directly.
//
// The session that authorises the calls below is an httpOnly cookie the browser
// cannot read, so there is no token to pass here. That is why these are plain
// fetches with no auth argument: the credential travels with the request and
// stays out of page JavaScript. See lib/ondo/session.ts.

import type { OndoCatalogWithCollateral } from "./collateral";
import type {
  OndoAddressBookEntry,
  OndoBalance,
  OndoBuilderCode,
  OndoCandle,
  OndoOrder,
  OndoPosition,
  OndoDeposit,
  OndoProvisionedAddress,
  OndoWithdrawalResult,
} from "./types";
import type { OndoWithdrawalView } from "./withdraw";

export async function fetchOndoCatalog(): Promise<OndoCatalogWithCollateral> {
  const res = await fetch("/api/ondo/markets", { cache: "no-store" });
  const body = (await res.json()) as OndoCatalogWithCollateral & { error?: string };

  if (!res.ok) {
    throw new Error(body.error ?? `Ondo catalog failed: ${res.status}`);
  }
  return {
    environment: body.environment,
    markets: body.markets,
    collateral: body.collateral,
    creditable: body.creditable,
  };
}

export interface OndoAccountSnapshot {
  address: string;
  account: {
    accountID: string;
    accountState: string;
    termsVersion: number;
    privacyVersion: number;
    perpsEnabled: boolean;
    cooldownPeriodSecs?: number;
  };
  balance: OndoBalance;
  // Confirmed deposits, newest first. The only place the collateral is named:
  // the balance endpoint is pooled totals and there is no spot wallet.
  deposits: OndoDeposit[];
  // Zero-quantity rows are already filtered out server side.
  positions: OndoPosition[];
  // Recovered from the balance, not returned by Ondo. This is the number that
  // decides whether the exchange sells the collateral backing the hedge.
  collateralHealth: {
    nonUsdcMarginValueUsd: number;
    usdcDebtUsd: number;
    ltv: number;
    headroomToAutoExchangeUsd: number;
  };
}

// Returns null when there is no session rather than throwing, because "not
// signed in to Ondo" is an ordinary state for a user who has never hedged, not
// an error to surface.
export async function fetchOndoAccount(): Promise<OndoAccountSnapshot | null> {
  const res = await fetch("/api/ondo/account", { cache: "no-store" });
  if (res.status === 401) return null;

  const body = (await res.json()) as OndoAccountSnapshot & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Ondo account read failed: ${res.status}`);
  }
  return body;
}

export interface OndoHedgeResult {
  order: OndoOrder;
  market: string;
  // Achieved size and ratio after both clamps, not what was requested.
  size: string;
  clampedByMargin?: boolean;
  limitedBy?: string;
  effectiveRatio?: number;
  basisRisk?: boolean;
  builderCode?: OndoBuilderCode;
  environment: string;
}

// The size is not passed in. The route recomputes it from the same preview the
// panel rendered, so a tab left open overnight cannot size an order against a
// stale price.
export function openOndoHedge(params: {
  xstockSymbol: string;
  quantity: string;
  tokenPriceUsd: string;
  hedgeRatio: number;
}): Promise<OndoHedgeResult> {
  return postJson<OndoHedgeResult>("/api/ondo/orders", { action: "open", ...params });
}

// Omitting `size` closes the whole position. Whatever is passed is clamped to
// the live position size server side, and the order itself is reduce-only, so
// a close can only ever shrink the short.
export function closeOndoHedge(params: {
  market: string;
  size?: string;
}): Promise<OndoHedgeResult> {
  return postJson<OndoHedgeResult>("/api/ondo/orders", { action: "close", ...params });
}

// A trade from the perps surface. Sized in dollars, either direction, against
// any Ondo market rather than only the ones an xStock routes to.
//
// The size is computed server side from `notionalUsd` against a freshly read
// catalog, for the same reason the hedge path does it: a tab left open should
// not size an order against a stale price.
export function placeOndoTrade(params: {
  market: string;
  side: "buy" | "sell";
  notionalUsd: string;
  // Closing an existing position. Reduce-only, so an oversized close stops at
  // flat rather than crossing into the opposite position.
  reduceOnly?: boolean;
}): Promise<OndoHedgeResult & { notionalUsd: string }> {
  return postJson("/api/ondo/orders", { action: "trade", ...params });
}

export function setOndoLeverage(
  market: string,
  leverage: number,
): Promise<{ market: string; leverage: number }> {
  return postJson("/api/ondo/leverage", { market, leverage });
}

// Chart history for one market. The route translates the market symbol into the
// unhyphenated form this endpoint needs; passing the order symbol straight
// through would return an empty series that looks like an illiquid market.
export async function fetchOndoCandles(
  market: string,
  resolution = "15",
  countback = 120,
): Promise<OndoCandle[]> {
  const query = new URLSearchParams({
    market,
    resolution,
    countback: String(countback),
  });
  const res = await fetch(`/api/ondo/history?${query}`, { cache: "no-store" });
  const body = (await res.json()) as { candles?: OndoCandle[]; error?: string };

  if (!res.ok) {
    throw new Error(body.error ?? `Ondo history failed: ${res.status}`);
  }
  return body.candles ?? [];
}

// Provisions the deposit address for a collateral asset. Permanently bound to
// the account, so the answer is worth holding onto rather than re-requesting.
//
// The route refuses any asset Ondo does not credit as margin. That check is not
// redundant with Ondo's own: Ondo issues a valid deposit address for TSLAon,
// which earns nothing.
export interface OndoDepositAddress extends OndoProvisionedAddress {
  contractAddress: string;
  decimals: number;
  haircut: number;
  capTokens: number | null;
  markPriceUsd: string | null;
  priceable: boolean;
}

export function provisionOndoDepositAddress(
  symbol: string,
): Promise<OndoDepositAddress> {
  return postJson("/api/ondo/deposit-address", { symbol });
}

// ---------------------------------------------------------------------------
// Withdrawals.
// ---------------------------------------------------------------------------

// Holdings, withdrawable amounts, registered payout addresses and history.
//
// Returns null with no session, matching fetchOndoAccount: a user who has never
// used Ondo has nothing to withdraw, and that is not an error.
export async function fetchOndoWithdrawalView(): Promise<OndoWithdrawalView | null> {
  const res = await fetch("/api/ondo/withdraw", { cache: "no-store" });
  if (res.status === 401) return null;

  const body = (await res.json()) as OndoWithdrawalView & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Ondo withdrawal read failed: ${res.status}`);
  }
  return body;
}

export interface OndoWithdrawalReceipt extends OndoWithdrawalResult {
  symbol: string;
  amount: string;
  address: string;
  network: string;
  valueUsd: number | null;
}

// Submits one withdrawal.
//
// No destination argument: the route withdraws to the session's own wallet and
// there is no field here that could change it.
//
// `customerWithdrawalId` is an idempotency key and the caller owns it. Generate
// it once when the user commits and reuse it on every retry, so a request that
// times out after Ondo accepted it cannot become a second withdrawal.
export function submitOndoWithdrawal(params: {
  symbol: string;
  amount: string;
  customerWithdrawalId: string;
}): Promise<OndoWithdrawalReceipt> {
  return postJson("/api/ondo/withdraw", params);
}

export interface OndoAddressBookView {
  addressBook: OndoAddressBookEntry[];
  ownAddress: string;
  registered?: boolean;
}

export async function fetchOndoAddressBook(): Promise<OndoAddressBookView | null> {
  const res = await fetch("/api/ondo/address-book", { cache: "no-store" });
  if (res.status === 401) return null;

  const body = (await res.json()) as OndoAddressBookView & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Ondo address book read failed: ${res.status}`);
  }
  return body;
}

export function removeOndoWithdrawalAddress(
  withdrawalAddress: string,
): Promise<OndoAddressBookView> {
  return deleteJson("/api/ondo/address-book", { withdrawalAddress });
}

// An idempotency key for one withdrawal attempt.
//
// Prefixed so a key is recognisable in Ondo's own withdrawal history, which
// echoes it back as `customer_withdrawal_id`.
export function newWithdrawalId(): string {
  return `aeras-${crypto.randomUUID()}`;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const parsed = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(parsed.error ?? `${path} failed: ${res.status}`);
  }
  return parsed;
}

async function deleteJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const parsed = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(parsed.error ?? `${path} failed: ${res.status}`);
  }
  return parsed;
}
