import { LIGHTER_MARGIN_FRACTION_SCALE } from "./constants";
import type { LighterMarket, LighterOrderBookDetail } from "./types";

// Normalizing the market catalog. Unlike Ondo, which splits the fields sizing
// needs across two endpoints that have to be joined, Lighter returns everything
// from orderBookDetails in one read. So this is a shape conversion rather than a
// merge, and the only judgement it makes is whether a market can be traded.

export function buildCatalog(
  details: LighterOrderBookDetail[],
): LighterMarket[] {
  return details.map(toMarket);
}

function toMarket(detail: LighterOrderBookDetail): LighterMarket {
  // mark_price is what positions are valued at, so it is the price a hedge is
  // sized against. index_price is the fallback for a market that has not traded,
  // matching the reason Ondo needed one: a fresh listing reports a zero last
  // price while its index is already real.
  const mark = usablePrice(detail.mark_price)
    ? detail.mark_price
    : detail.index_price;

  const minInitial =
    detail.min_initial_margin_fraction / LIGHTER_MARGIN_FRACTION_SCALE;

  return {
    symbol: detail.symbol,
    marketId: detail.market_id,
    // Inactive markets still appear in the catalog. SPACEX and MKR are listed
    // and inactive right now, so presence in the response says nothing about
    // whether an order would be accepted.
    tradeable: detail.status === "active" && usablePrice(mark),
    status: detail.status,

    markPrice: mark,
    indexPrice: detail.index_price,
    minBaseAmount: detail.min_base_amount,
    minQuoteAmount: detail.min_quote_amount,
    orderQuoteLimit: detail.order_quote_limit,

    sizeDecimals: detail.size_decimals,
    priceDecimals: detail.price_decimals,

    takerFee: detail.taker_fee,
    makerFee: detail.maker_fee,

    initialMarginFraction:
      detail.default_initial_margin_fraction / LIGHTER_MARGIN_FRACTION_SCALE,
    minInitialMarginFraction: minInitial,
    maintenanceMarginFraction:
      detail.maintenance_margin_fraction / LIGHTER_MARGIN_FRACTION_SCALE,
    // Rounded down so we never advertise leverage the exchange would reject.
    maxLeverage: minInitial > 0 ? Math.floor(1 / minInitial) : 1,

    baseInterestRate: detail.base_interest_rate,
    tradingHours: detail.market_config?.trading_hours ?? "",
    openInterest: detail.open_interest,
    dailyQuoteVolume: detail.daily_quote_token_volume,
    dailyPriceChange: detail.daily_price_change,
  };
}

function usablePrice(value: string | undefined): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function findMarket(
  catalog: LighterMarket[],
  symbol: string,
): LighterMarket | undefined {
  return catalog.find((m) => m.symbol === symbol);
}

export function findMarketById(
  catalog: LighterMarket[],
  marketId: number,
): LighterMarket | undefined {
  return catalog.find((m) => m.marketId === marketId);
}

export function tradeableMarkets(catalog: LighterMarket[]): LighterMarket[] {
  return catalog.filter((m) => m.tradeable);
}

// What the browser gets from /api/lighter/markets.
export interface LighterCatalog {
  markets: LighterMarket[];
  fetchedAt: number;
}
