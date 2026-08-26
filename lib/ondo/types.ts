// Shapes verified against the live production API on 2026-08-10. Numeric fields
// arrive as strings throughout, so they are typed as strings here and parsed at
// the point of use rather than eagerly coerced.

// Every response is wrapped. `success: false` carries the reason.
export interface OndoEnvelope<T> {
  success: boolean;
  error?: string;
  error_code?: string;
  deprecated?: boolean;
  result?: T;
}

// Per-market margin brackets. Currently one bracket per market at $1m notional.
export interface OndoMarginBracket {
  positionBracketUsd: string;
  maxLeverage: string;
  maintenanceMarginRate: string;
  maintenanceAmount: string;
}

// Trading hours. Undocumented but present on the live payload, and it refutes
// the docs' "markets are open 24/7" claim. Index and commodity markets run a
// different calendar to equities, including a daily 17:00-18:00 ET break.
export interface OndoSchedule {
  timezone: string;
  openHours: string[];
  holidays?: { date: string; openHours: string }[];
}

// Static per-market config from GET /v1/markets. Carries the increments and
// caps but no prices.
export interface OndoTradingPair {
  market: string;
  displayName: string;
  longName: string;
  pair: { base: string; quote: string };
  baseIncrement: string;
  quoteIncrement: string;
  marginInfo: OndoMarginBracket[];
  defaultLeverage: string;
  maxPositionBaseSize: string;
  makerFee: string;
  takerFee: string;
  tags: string[];
  disabled?: boolean;
  schedule?: OndoSchedule;
  logoUrl?: string;
  backgroundColour?: string;
}

// An asset that can be deposited as collateral. `networks` is the authoritative
// answer to "which chains can this be deposited on", and it is the field that
// disproves the docs' claim of Solana support.
export interface OndoTokenConfig {
  id: string;
  name: string;
  decimals: number;
  networks: Record<string, { contractAddress: string; contractDecimals: number }>;
}

export interface OndoMarketsResult {
  perps: { tradingPairs: OndoTradingPair[] };
  spot?: { tradingPairs: OndoTradingPair[] };
  tokenConfig: OndoTokenConfig[];
}

// Live ticker from GET /v1/perps/contracts. Disjoint from the static config:
// this has prices and `isClosed` but no increments, so the two must be merged.
export interface OndoContract {
  market: string;
  disabled?: boolean;
  isClosed?: boolean;
  lastPrice: string;
  indexPrice: string;
  bid?: string;
  ask?: string;
  fundingRate?: string;
  nextFundingRate?: string;
  nextFundingRateTimestamp?: number;
  openInterestUsd?: string;
  priceChangePercent?: string;
  usdVolume?: string;
  tags?: string[];
}

// Static config joined to the live ticker. This is what the rest of the code
// consumes so no caller has to remember which endpoint holds which field.
export interface OndoMarket {
  market: string;
  displayName: string;
  longName: string;
  tags: string[];
  tradeable: boolean;
  isClosed: boolean;
  baseIncrement: string;
  quoteIncrement: string;
  maxPositionBaseSize: string;
  maxLeverage: string;
  maintenanceMarginRate: string;
  takerFee: string;
  // Last traded price, or the index price when the market has never traded.
  price: string;
  indexPrice: string;
  fundingRate: string | null;
  schedule?: OndoSchedule;
  // Browse-only fields, for the market selector. None of these are inputs to
  // sizing or risk, so a missing value degrades a column to a dash rather than
  // blocking a trade.
  logoUrl?: string;
  backgroundColour?: string;
  priceChangePercent: string | null;
  usdVolume: string | null;
  openInterestUsd: string | null;
}

export interface OndoPosition {
  market: string;
  // Sign lives here. `netQuantity` is unsigned, so reading it alone loses the
  // direction of the position.
  direction: "long" | "short" | "neutral";
  netQuantity: string;
  averageEntryPrice: string;
  usedMargin: string;
  unrealizedPnl: string;
  markPrice: string;
  liquidationPrice: string;
  bankruptcyPrice: string;
  maintenanceMargin: string;
  notionalValue: string;
  leverage: string;
  netFundingSinceNeutral: string;
  returnOnEquity: string;
}

// GET /v1/perps/balance. Note what is absent: there is no ltv, usdcDebt,
// nonUsdcMarginValue or haircut field anywhere on this response, so the
// collateral-health model in lib/ondo/risk.ts has to be computed client-side.
// A confirmed deposit, from GET /v1/wallet/deposits.
//
// Ondo runs a single unified account with no spot wallet, and /v1/perps/balance
// returns pooled totals only, so no endpoint answers "how much SPCXon do I
// hold". Deposit history is what does: it names the asset and the size that
// went in. Paired with collateralHealth.nonUsdcMarginValueUsd (what the
// non-USDC collateral is credited at right now) that is the whole picture.
//
// Field names are from Ondo's published OpenAPI spec, not guessed.
export interface OndoDeposit {
  coin: string;
  size: string;
  status: string;
  txid?: string;
  time?: string;
  chainId?: string;
  usdValue?: string;
}

export interface OndoBalance {
  walletBalance: string;
  realizedPnl: string;
  unrealizedPnl: string;
  marginBalance: string;
  usedMargin: string;
  availableMargin: string;
  withdrawableMargin: string;
  maintenanceMarginRequirement: string;
  totalMaintenanceMargin: string;
  // Maintenance margin over margin balance. Liquidation at 100%. Returns 9999
  // when margin balance is zero or negative. Distinct from the LTV that governs
  // collateral auto-exchange.
  marginRatio: string;
  leverage: string;
  underLiquidation: boolean;
  totalFundingPayments: string;
  totalTradingFees: string;
  totalPnL: string;
  netInvested?: string;
}

export interface OndoOrderSizes {
  maxBidBaseSize: string;
  maxAskBaseSize: string;
}

// GET /v1/perps/max_order_size. No side parameter: both directions come back
// together and a short reads maxAskBaseSize.
export interface OndoMaxOrderSizes {
  percent100: OndoOrderSizes;
  percent75: OndoOrderSizes;
  percent50: OndoOrderSizes;
  percent25: OndoOrderSizes;
}

// POST /v1/auth/erc-4361/login/get_challenge. The message is a full ERC-4361
// statement and is signed verbatim: it carries its own five-minute expiry, so
// it cannot be cached and replayed later.
export interface OndoChallenge {
  id: string;
  message: string;
}

export interface OndoSessionToken {
  token: string;
}

// GET /v1/account. termsVersion is 0 on a fresh account and stays 0 until the
// user accepts, which is a decision that belongs to them rather than to us.
// Reads work at 0; this is carried through so a caller can tell the difference
// between "not asked yet" and "declined".
export interface OndoAccount {
  accountID: string;
  identifier: string;
  authType: "web3" | "web2:email_pass" | "web2:google" | "unknown";
  accountState: "open" | "disabled" | "offboarding" | "closed";
  withdrawalFeeUSD: string;
  termsVersion: number;
  privacyVersion: number;
  disabledFunctionality?: {
    disablePerps?: boolean;
    disableTransfers?: boolean;
    disableAPIKeyCreation?: boolean;
  };
  // Withdrawal-address cooldown. Undocumented divergence between environments,
  // so it is read rather than assumed.
  cooldownPeriodSecs?: number;
}

// The builder attribution block. `feeRateBps`, the integer form, is deprecated
// upstream and `deprecated_field` is a live rejection code, so it is absent
// here on purpose: there is no way to send it from this codebase.
export interface OndoBuilderCode {
  code: string;
  // Bps, fractional allowed. Omitted means the fill earns no commission. Ondo
  // holds no default rate per builder code.
  feeRateBpsFractional?: number;
}

// POST /v1/perps/orders. Only `side` and `market` are required, and `type`
// defaults to "limit", so a market order that omits `type` is a limit order
// with no price, which is an error rather than an implicit market order.
export interface OndoOrderRequest {
  market: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  size: string;
  price?: string;
  // Not settable on market orders. Ondo rejects the combination outright.
  timeInForce?: "GTC" | "IOC";
  postOnly?: boolean;
  reduceOnly?: boolean;
  clientOrderId?: string;
  builderCode?: OndoBuilderCode;
}

export type OndoOrderStatus =
  | "open"
  | "fullyfilled"
  | "canceled"
  | "pending"
  | "untriggered";

export interface OndoOrder {
  orderId: string;
  clientOrderId?: string;
  market: string;
  side: "buy" | "sell";
  type: string;
  size: string;
  price: string;
  filledSize: string;
  filledCost: string;
  // Total fees on this order. Ondo's own taker fee and our builder commission
  // are not broken out separately.
  fee: string;
  realizedPnl?: string;
  status: OndoOrderStatus;
  createdAt: string;
}

// POST /v1/provision_address. The address returned is permanently bound to the
// account, so it is provisioned once and cached rather than re-requested.
export interface OndoProvisionAddressRequest {
  symbol: string;
  network: string;
  deposit_destination: { id: string; wallet: "margin" };
}

export interface OndoProvisionedAddress {
  chain: string;
  accountId: string;
  symbol: string;
  address: string;
}

// ---------------------------------------------------------------------------
// Withdrawals. The way out of the account, and the mirror of provision_address
// above: deposits arrive at an address Ondo owns, withdrawals leave to an
// address the user owns and has registered in advance.
// ---------------------------------------------------------------------------

// POST /v1/auth/erc-4361/address_book/get_challenge.
//
// A second SIWE flow, separate from login and not satisfied by holding a valid
// session: registering a payout destination is re-authorised by the wallet
// itself. `chainId` is the chain the signature is made on, not the chain the
// withdrawal lands on, and its enum is EVM-only ("1" | "43114"). There is no
// Solana value, which is the first of two reasons the exit lands on Ethereum.
export interface OndoAddressBookChallengeRequest {
  walletAddress: string;
  chainId: string;
  withdrawalAddress: string;
}

// POST /v1/auth/erc-4361/address_book/complete_challenge.
export interface OndoAddressBookCompleteRequest {
  id: string;
  signature: string;
  addressLabel?: string;
}

export interface OndoAddressBookEntry {
  withdrawalAddress: string;
  label: string;
  lastUpdated: string;
}

export interface OndoAddressBookResult {
  addressBook?: OndoAddressBookEntry[];
}

// POST /v1/withdraw.
//
// `customer_withdrawal_id` is an idempotency key, not a label. Ondo rejects a
// repeat with `withdrawal_duplicate_customer_withdrawal_id`, which is the only
// thing standing between a double-submit and two withdrawals. It is generated
// once per attempt in lib/ondo/withdraw.ts and reused across retries.
//
// `network` is "ethereum" for every asset we can withdraw. The enum also
// carries "solana" and "avalanche"; neither has a live path, since assets come
// back on the chain they went out on and every deposit path is Ethereum.
export interface OndoWithdrawRequest {
  customer_withdrawal_id: string;
  symbol: string;
  network: string;
  amount: string;
  address: string;
  from?: { id: string; wallet: "main" | "margin" };
}

export type OndoWithdrawalStatus =
  | "complete"
  | "failure"
  | "pending"
  | "cancelled"
  | "unknown";

export interface OndoWithdrawalResult {
  withdrawal_status: OndoWithdrawalStatus;
  withdrawal_id: string;
  customer_withdrawal_id: string;
  // Present once Ondo has broadcast. Absent on a pending withdrawal, which is
  // the normal first response.
  hash?: string;
}

// GET /v1/wallet/withdrawals. The mirror of OndoDeposit, and the other half of
// the only per-asset ledger this API exposes: no endpoint returns "how much
// SPCXon do I hold", so held quantity is deposits minus withdrawals. See
// lib/ondo/withdraw.ts, which also cross-checks that against Ondo's own
// credited margin value rather than trusting the ledger alone.
export interface OndoWalletWithdrawal {
  coin: string;
  size: string;
  status: OndoWithdrawalStatus;
  address: string;
  withdrawal_id: string;
  txid: string;
  customer_withdrawal_id: string;
  time: string;
  chainId?: string;
  usdValue?: string;
  usdFee?: string;
}

// GET /v1/wallet/withdrawals/limit. A rolling per-period cap in USD, distinct
// from margin: an account can be well inside its withdrawable margin and still
// be refused with `withdrawal_limit_exceeded`.
export interface OndoWithdrawalLimits {
  currentWithdrawalsUsd: string;
  withdrawalLimitUsd: string;
}

// POST /v1/get_withdrawal_status. Takes exactly one of the two ids. Carries the
// on-chain txid and confirmation count, which is what turns "Ondo accepted it"
// into "it is on Ethereum".
export interface OndoWithdrawalStatusResult {
  original_request: {
    account_id?: string;
    customer_withdrawal_id?: string;
    symbol?: string;
    amount?: string;
    address?: string;
    network?: string;
  };
  withdrawal_id: string;
  txid: string;
  confirmation_number: number;
  withdrawal_status: OndoWithdrawalStatus;
}

// GET /v1/perps/history. The one endpoint that skips the response envelope: a
// TradingView UDF payload with parallel arrays at the top level.
//
// `s` is "ok" even when there is no data, with every array empty, which is what
// the wrong symbol format produces. Treat empty arrays as "no history", not as
// an error, and check the symbol before concluding the market is illiquid.
//
// `t` is in **seconds**, unlike Lighter's candles, which are milliseconds.
export interface OndoHistory {
  s: "ok" | "no_data" | "error";
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
  errmsg?: string;
}

export interface OndoCandle {
  // Milliseconds, converted on the way in so every chart in the app agrees.
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
