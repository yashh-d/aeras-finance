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
