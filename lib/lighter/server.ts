import {
  LIGHTER_ACCOUNT_NOT_FOUND,
  LIGHTER_API_BASE_URL,
  LIGHTER_API_PREFIX,
  LIGHTER_INTENT_CHAIN_IDS,
  LIGHTER_MAIN_ACCOUNT_TYPE,
  LIGHTER_RESTRICTED_JURISDICTION,
  type LighterIntentChain,
} from "./constants";
import {
  candleWindow,
  parseCandles,
  type CandleRange,
  type LighterCandle,
} from "./candles";
import type {
  LighterAccount,
  LighterAccountDetail,
  LighterApiKey,
  LighterOrderBookDetail,
  LighterOrderBookDetailsResponse,
  LighterPosition,
} from "./types";

// Server-side reads from Lighter. Everything the browser needs goes through an
// API route rather than direct, matching the Trustware and Ondo proxies.
//
// Two reasons beyond convention. Lighter rate limits by IP at 60 weighted
// requests a minute for unauthenticated callers, so fetching from the browser
// would meter every user against their own connection and give us no way to
// cache or batch. And routing through our own origin keeps any future API key
// server-only.
//
// The catalog needs no authentication, which is why sizing and risk can be built
// and verified before a single wallet is connected.

async function lighterGet<T>(
  path: string,
  baseUrl = LIGHTER_API_BASE_URL,
): Promise<T> {
  const response = await fetch(`${baseUrl}${LIGHTER_API_PREFIX}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Lighter ${path} failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

// Static config and live prices in one read: increments, margin fractions,
// minimums, mark and index price, funding inputs. Unlike Ondo there is no second
// endpoint to join, so nothing here can go stale against itself.
//
// The response also carries spot_order_book_details, which we ignore. Aeras
// hedges with perps only, and a spot market that shares a symbol with a perp
// would be a silent mis-route if it were merged in here.
export async function lighterOrderBookDetails(
  baseUrl?: string,
): Promise<LighterOrderBookDetail[]> {
  const body = await lighterGet<LighterOrderBookDetailsResponse>(
    "/orderBookDetails",
    baseUrl,
  );

  if (!Array.isArray(body.order_book_details)) {
    throw new Error("Lighter /orderBookDetails returned no market list");
  }
  return body.order_book_details;
}

interface SubAccountResponse {
  index: number;
  account_type: number;
  l1_address: string;
  status: number;
  collateral: string;
  available_balance: string;
  pending_order_count: number;
  total_order_count: number;
}

interface AccountsByL1AddressResponse {
  code: number;
  message?: string;
  sub_accounts?: SubAccountResponse[];
}

// The main cross-margin account for an L1 address, or null when the address has
// never been funded.
//
// An unprovisioned address is not an error condition here. Lighter answers with
// HTTP 400 and code 21100 "account not found", which is the normal state for
// every user before their first deposit, so it is mapped to null rather than
// thrown. Any other failure still throws.
export async function lighterAccountByL1Address(
  l1Address: string,
): Promise<LighterAccount | null> {
  const url =
    `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/accountsByL1Address` +
    `?l1_address=${encodeURIComponent(l1Address)}`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const body = (await response.json()) as AccountsByL1AddressResponse;

  if (body.code === LIGHTER_ACCOUNT_NOT_FOUND) {
    return null;
  }
  if (!response.ok || body.code !== 200 || !body.sub_accounts) {
    throw new Error(`Lighter accountsByL1Address failed: ${body.message ?? response.status}`);
  }

  const main = body.sub_accounts
    .filter((account) => account.account_type === LIGHTER_MAIN_ACCOUNT_TYPE)
    .sort((a, b) => a.index - b.index)[0];

  if (!main) {
    return null;
  }

  return {
    index: main.index,
    accountType: main.account_type,
    l1Address: main.l1_address,
    status: main.status,
    collateral: main.collateral,
    availableBalance: main.available_balance,
    pendingOrderCount: main.pending_order_count,
    totalOrderCount: main.total_order_count,
  };
}

interface PositionResponse {
  market_id: number;
  symbol: string;
  sign: number;
  position: string;
  position_value: string;
  avg_entry_price: string;
  unrealized_pnl: string;
  liquidation_price: string;
}

interface AccountDetailResponse {
  code: number;
  message?: string;
  accounts?: {
    index: number;
    collateral: string;
    available_balance: string;
    total_asset_value: string;
    cross_initial_margin_requirement: string;
    cross_maintenance_margin_requirement: string;
    positions?: PositionResponse[];
  }[];
}

// Open positions and live margin state for one account.
//
// A different endpoint from accountsByL1Address and a different shape: this one
// is keyed by index and is the only place positions appear. Rows with zero size
// are dropped here rather than in the UI, because they are not positions, they
// are markets the account once touched, and one live account reported six of
// them against a single real holding.
export async function lighterAccountDetail(
  accountIndex: number,
): Promise<LighterAccountDetail> {
  const body = await lighterGet<AccountDetailResponse>(
    `/account?by=index&value=${accountIndex}`,
  );

  const account = body.accounts?.[0];
  if (body.code !== 200 || !account) {
    throw new Error(`Lighter account failed: ${body.message ?? body.code}`);
  }

  const positions: LighterPosition[] = (account.positions ?? [])
    .filter((position) => Number(position.position) !== 0)
    .map((position) => ({
      marketId: position.market_id,
      symbol: position.symbol,
      // sign carries the direction on its own; position is a magnitude.
      isShort: position.sign < 0,
      size: position.position,
      notionalUsd: position.position_value,
      entryPriceUsd: position.avg_entry_price,
      unrealizedPnlUsd: position.unrealized_pnl,
      liquidationPriceUsd: position.liquidation_price,
    }));

  return {
    index: account.index,
    collateralUsd: account.collateral,
    availableBalanceUsd: account.available_balance,
    totalAssetValueUsd: account.total_asset_value,
    crossInitialMarginUsd: account.cross_initial_margin_requirement,
    crossMaintenanceMarginUsd: account.cross_maintenance_margin_requirement,
    positions,
  };
}

interface ApiKeysResponse {
  code: number;
  message?: string;
  api_keys?: {
    account_index: number;
    api_key_index: number;
    nonce: number;
    public_key: string;
  }[];
}

// Every trading key registered against an account. Slots that were never
// registered are simply absent from the list, so a caller checking a specific
// slot has to treat "missing" and "registered" as the two outcomes rather than
// expecting a placeholder.
export async function lighterAccountApiKeys(
  accountIndex: number,
): Promise<LighterApiKey[]> {
  const body = await lighterGet<ApiKeysResponse>(
    `/apikeys?account_index=${accountIndex}`,
  );

  if (body.code !== 200 || !body.api_keys) {
    throw new Error(`Lighter apikeys failed: ${body.message ?? body.code}`);
  }

  return body.api_keys.map((key) => ({
    accountIndex: key.account_index,
    apiKeyIndex: key.api_key_index,
    nonce: key.nonce,
    publicKey: key.public_key,
  }));
}

interface NextNonceResponse {
  code: number;
  message?: string;
  nonce?: number;
}

// Nonces are per api key slot, not per account, so ours advances independently
// of the user's session on app.lighter.xyz. Always read it immediately before
// signing: a signature over a stale nonce is rejected, and the rejection still
// consumes the attempt.
export async function lighterNextNonce(
  accountIndex: number,
  apiKeyIndex: number,
): Promise<number> {
  const body = await lighterGet<NextNonceResponse>(
    `/nextNonce?account_index=${accountIndex}&api_key_index=${apiKeyIndex}`,
  );

  if (body.code !== 200 || typeof body.nonce !== "number") {
    throw new Error(`Lighter nextNonce failed: ${body.message ?? body.code}`);
  }
  return body.nonce;
}

interface SendTxResponse {
  code: number;
  message?: string;
  tx_hash?: string;
}

// Submits a signed transaction. This is the only write path: registering a
// trading key and placing a hedge both come through here.
//
// It is also the only endpoint Lighter geo-blocks. Reads and even
// createIntentAddress answer normally from a restricted jurisdiction, but this
// one returns code 20558 regardless of the payload. That is why it is called
// from a server route pinned to a permitted region rather than from the browser.
export async function lighterSendTx(
  txType: number,
  txInfo: string,
): Promise<string> {
  const response = await fetch(
    `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/sendTx`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        tx_type: String(txType),
        tx_info: txInfo,
      }),
      cache: "no-store",
    },
  );

  const body = (await response.json()) as SendTxResponse;

  if (body.code === LIGHTER_RESTRICTED_JURISDICTION) {
    throw new Error(
      "Lighter refused the transaction: restricted jurisdiction. The request " +
        "reached Lighter from a blocked region.",
    );
  }
  if (!response.ok || body.code !== 200 || !body.tx_hash) {
    throw new Error(`Lighter sendTx rejected: ${body.message ?? response.status}`);
  }
  return body.tx_hash;
}

interface IntentAddressResponse {
  code: number;
  intent_address?: string;
  message?: string;
}

// Where a user sends USDC to fund their Lighter account. The address is derived
// from their L1 address, so it is stable per user per chain and a deposit stays
// attributable without any memo or tag.
//
// On Solana this returns a base58 SPL token account rather than a 0x address.
// Callers must not assume the shape: sending Solana USDC to an EVM-shaped
// address, or the reverse, loses the funds.
//
// POST, but it is idempotent. Calling it twice for the same address returns the
// same account, so it is safe to call on every visit to the deposit screen.
export async function lighterIntentAddress(
  l1Address: string,
  chain: LighterIntentChain,
): Promise<string> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(l1Address)) {
    throw new Error(`Not an L1 address: ${l1Address}`);
  }

  const body = new URLSearchParams({
    chain_id: String(LIGHTER_INTENT_CHAIN_IDS[chain]),
    from_addr: l1Address,
    amount: "0",
    is_external_deposit: "true",
  });

  const response = await fetch(
    `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/createIntentAddress`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    },
  );

  const parsed = (await response.json()) as IntentAddressResponse;

  // A non-200 body code carries the real reason even when the HTTP status is
  // fine, and an unsupported chain is reported that way rather than as a 4xx.
  if (!response.ok || parsed.code !== 200 || !parsed.intent_address) {
    throw new Error(
      `Lighter createIntentAddress rejected ${chain}: ${parsed.message ?? response.status}`,
    );
  }
  return parsed.intent_address;
}

// Price history for one market.
//
// The path is `/candles`, not the `/candlesticks` the docs name. That path is
// not routed, and CloudFront answers an unrouted path with an empty 403, which
// reads exactly like Lighter's geo-block. If this ever starts returning 403,
// check the path before concluding the region is blocked.
export async function lighterCandles(
  marketId: number,
  range: CandleRange,
  nowMs: number = Date.now(),
): Promise<{ candles: LighterCandle[]; resolution: string }> {
  const window = candleWindow(range, nowMs);
  const params = new URLSearchParams({
    market_id: String(marketId),
    resolution: window.resolution,
    start_timestamp: String(window.startMs),
    end_timestamp: String(window.endMs),
    // Ignored by the server, which caps at LIGHTER_MAX_CANDLES regardless. Sent
    // anyway because it is a required parameter: omitting it is a 20001.
    count_back: String(window.bars),
    set_timestamp_to_end: "true",
  });

  const body = await lighterGet<unknown>(`/candles?${params}`);
  return { candles: parseCandles(body), resolution: window.resolution };
}
