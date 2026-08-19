// Shapes returned by Lighter's public REST API, narrowed to the fields the hedge
// slice reads. Transcribed from live responses on 2026-08-16 rather than from
// the reference docs, which omit several of the margin and funding fields.
//
// Note the inconsistent JSON types: mark_price and index_price arrive as
// strings, last_trade_price and the daily_* aggregates as numbers, and the
// margin fractions as integers. Preserving that distinction here is deliberate,
// so a caller cannot silently do float arithmetic on a value we intend to parse
// as an exact decimal.

export interface LighterMarketConfig {
  market_margin_mode: number;
  insurance_fund_account_index: number;
  liquidation_mode: number;
  force_reduce_only: boolean;
  // Empty string means no restriction. Equity markets carry "" and trade 24/7,
  // confirmed by pulling recentTrades for SPY on a Sunday.
  trading_hours: string;
  funding_fee_discounts_enabled: boolean;
  hidden: boolean;
  rfq_enabled: boolean;
}

export interface LighterOrderBookDetail {
  symbol: string;
  market_id: number;
  market_type: string;
  status: string;

  taker_fee: string;
  maker_fee: string;
  liquidation_fee: string;

  // Decimal strings. min_quote_amount is the USD floor on an order and binds
  // more often than min_base_amount does.
  min_base_amount: string;
  min_quote_amount: string;
  order_quote_limit: string;

  // How many decimals a size or price may carry before it is scaled to the
  // integer that crosses the wire. Varies per market.
  size_decimals: number;
  price_decimals: number;
  supported_size_decimals: number;
  supported_price_decimals: number;
  supported_quote_decimals: number;

  // Integers scaled by LIGHTER_MARGIN_FRACTION_SCALE, where 10000 is 100%.
  default_initial_margin_fraction: number;
  min_initial_margin_fraction: number;
  maintenance_margin_fraction: number;
  closeout_margin_fraction: number;

  mark_price: string;
  index_price: string;
  last_trade_price: number;

  open_interest: number;
  daily_quote_token_volume: number;
  daily_price_change: number;

  // Funding inputs. base_interest_rate and the clamps are percent-valued
  // decimal strings.
  base_interest_rate: string;
  funding_clamp_small: string;
  funding_clamp_big: string;
  funding_premium_multiplier: number;

  market_config: LighterMarketConfig;
}

export interface LighterOrderBookDetailsResponse {
  code?: number;
  order_book_details: LighterOrderBookDetail[];
}

// The normalized market we pass around internally. Everything sizing and risk
// need, with the wire's mixed types resolved into decimal strings, and the
// tradeability judgement already made.
export interface LighterMarket {
  symbol: string;
  marketId: number;
  // False when the market is not "active" or has no usable price. A market we
  // cannot price is treated as untradeable rather than assumed healthy, because
  // sizing against a price we never received is worse than offering no hedge.
  tradeable: boolean;
  status: string;

  // Decimal strings throughout.
  markPrice: string;
  indexPrice: string;
  minBaseAmount: string;
  minQuoteAmount: string;
  orderQuoteLimit: string;

  sizeDecimals: number;
  priceDecimals: number;

  takerFee: string;
  makerFee: string;

  // Percentages, 0 to 1, converted out of the 10000 scale.
  initialMarginFraction: number;
  minInitialMarginFraction: number;
  maintenanceMarginFraction: number;
  // 1 / minInitialMarginFraction, rounded down.
  maxLeverage: number;

  baseInterestRate: string;
  // Empty string means the market never closes.
  tradingHours: string;
  openInterest: number;
  dailyQuoteVolume: number;
}

// A Lighter account, keyed by the L1 address that funded it. Provisioned by the
// first deposit, not by a signature or a contract call.
//
// accountsByL1Address returns sub_accounts, plural. One L1 address can own
// several: account_type 0 is the main cross-margin account and is the only one
// we trade, while isolated-margin sub-accounts appear alongside it with a
// different type and an index in the hundreds of trillions. Selecting the first
// element of that array rather than the first main account would eventually
// route orders to the wrong one.
export interface LighterAccount {
  index: number;
  accountType: number;
  l1Address: string;
  status: number;
  collateral: string;
  availableBalance: string;
  pendingOrderCount: number;
  totalOrderCount: number;
}

// An open position on one market.
//
// Two things about the wire shape are easy to get wrong, both confirmed against
// live accounts on 2026-08-16.
//
// Direction lives only in `sign`, 1 for long and -1 for short. `position` and
// `position_value` are unsigned magnitudes, so a short reads as a positive size
// and reading it as signed makes every position look long. Since the whole point
// of this tab is telling a hedge from a doubled-up long, that would invert the
// one fact the user is here for.
//
// And the account carries a row for every market it has ever touched, with size
// zero once closed. One live account returned six positions of which one was
// real. Callers get only the non-zero ones from here.
export interface LighterPosition {
  marketId: number;
  symbol: string;
  isShort: boolean;
  // Unsigned. Direction is isShort.
  size: string;
  notionalUsd: string;
  entryPriceUsd: string;
  unrealizedPnlUsd: string;
  // "0" when the position cannot be liquidated by price, which is what a flat or
  // fully collateralized account reports.
  liquidationPriceUsd: string;
}

// An account with its live margin state and open positions. Separate from
// LighterAccount, which comes from accountsByL1Address and carries no positions.
export interface LighterAccountDetail {
  index: number;
  collateralUsd: string;
  availableBalanceUsd: string;
  totalAssetValueUsd: string;
  // What cross margin currently ties up across every open position. A new hedge
  // has to fit inside availableBalanceUsd, not collateralUsd.
  crossInitialMarginUsd: string;
  crossMaintenanceMarginUsd: string;
  positions: LighterPosition[];
}

// A trading key registered against an account. public_key is 40-byte hex and is
// what our derived key has to match for the account to be usable.
export interface LighterApiKey {
  accountIndex: number;
  apiKeyIndex: number;
  nonce: number;
  publicKey: string;
}
