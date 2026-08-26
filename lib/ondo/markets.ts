import type { OndoEnv } from "./constants";
import type {
  OndoContract,
  OndoMarket,
  OndoMarketsResult,
  OndoTokenConfig,
  OndoTradingPair,
} from "./types";

// The catalog is split across two endpoints with no overlap in the fields we
// need: /v1/markets has the increments and caps, /v1/perps/contracts has the
// prices and isClosed. Neither alone is enough to size an order, so they are
// joined here once and every caller consumes the merged shape.

export function buildCatalog(
  markets: OndoMarketsResult,
  contracts: OndoContract[],
): OndoMarket[] {
  const tickers = new Map(contracts.map((c) => [c.market, c]));

  return markets.perps.tradingPairs.map((pair) => merge(pair, tickers.get(pair.market)));
}

function merge(
  pair: OndoTradingPair,
  ticker: OndoContract | undefined,
): OndoMarket {
  const bracket = pair.marginInfo[0];

  // A market with no live ticker is treated as untradeable rather than assumed
  // healthy: sizing an order against a price we never received is worse than
  // refusing to offer the hedge.
  const disabled = pair.disabled === true || ticker?.disabled === true;

  // SPY-USD.P has never traded so its lastPrice is "0" while indexPrice is
  // real. Falling back keeps a zero out of the denominator in sizing.
  const last = ticker?.lastPrice;
  const price =
    last && last !== "0" ? last : (ticker?.indexPrice ?? "0");

  return {
    market: pair.market,
    displayName: pair.displayName,
    longName: pair.longName,
    tags: pair.tags ?? [],
    tradeable: !disabled && ticker !== undefined,
    isClosed: ticker?.isClosed ?? true,
    baseIncrement: pair.baseIncrement,
    quoteIncrement: pair.quoteIncrement,
    maxPositionBaseSize: pair.maxPositionBaseSize,
    maxLeverage: bracket?.maxLeverage ?? "1",
    maintenanceMarginRate: bracket?.maintenanceMarginRate ?? "0",
    takerFee: pair.takerFee,
    price,
    indexPrice: ticker?.indexPrice ?? "0",
    fundingRate: ticker?.fundingRate ?? null,
    schedule: pair.schedule,
    // Ondo serves a logo for only 8 of 52 markets and a brand colour for even
    // fewer, so the UI treats both as optional and falls back to a monogram
    // badge. See lib/tokens/market-logos.ts.
    logoUrl: pair.logoUrl,
    backgroundColour: pair.backgroundColour,
    priceChangePercent: ticker?.priceChangePercent ?? null,
    usdVolume: ticker?.usdVolume ?? null,
    openInterestUsd: ticker?.openInterestUsd ?? null,
  };
}

// SPY-USD.P and QQQ-USD.P resolve as symbols but carry disabled: true in
// production, so checking that a symbol exists is not enough to know an order
// will be accepted. The set of disabled markets differs between production and
// sandbox and changes over time, so it is read rather than hardcoded.
export function findMarket(
  catalog: OndoMarket[],
  market: string,
): OndoMarket | undefined {
  return catalog.find((m) => m.market === market);
}

export function tradeableMarkets(catalog: OndoMarket[]): OndoMarket[] {
  return catalog.filter((m) => m.tradeable);
}

// Which assets Ondo will credit as margin, and on which chains. Read this rather
// than trusting the prose docs, which omit GLDon and SLVon and wrongly imply a
// Solana deposit path exists.
export interface OndoCollateralAsset {
  symbol: string;
  decimals: number;
  networks: { network: string; contractAddress: string; decimals: number }[];
}

export function collateralAssets(
  markets: OndoMarketsResult,
): OndoCollateralAsset[] {
  return markets.tokenConfig.map(toCollateralAsset);
}

function toCollateralAsset(token: OndoTokenConfig): OndoCollateralAsset {
  return {
    symbol: token.id,
    decimals: token.decimals,
    networks: Object.entries(token.networks).map(([network, cfg]) => ({
      network,
      contractAddress: cfg.contractAddress,
      decimals: cfg.contractDecimals,
    })),
  };
}

// What the browser gets from /api/ondo/markets. Both halves come from the same
// pair of upstream reads, so they are returned together rather than making the
// client fetch twice.
//
// `environment` is carried through because sandbox and production return
// materially different catalogs: sandbox enables SPY-USD.P and QQQ-USD.P and
// uses different collateral addresses. A caller that cannot tell which one it
// received will draw the wrong conclusion about how a hedge routes.
export interface OndoCatalog {
  environment: OndoEnv;
  markets: OndoMarket[];
  collateral: OndoCollateralAsset[];
}

export function collateralOnNetwork(
  assets: OndoCollateralAsset[],
  symbol: string,
  network: string,
): { contractAddress: string; decimals: number } | undefined {
  const asset = assets.find((a) => a.symbol === symbol);
  const match = asset?.networks.find((n) => n.network === network);
  return match
    ? { contractAddress: match.contractAddress, decimals: match.decimals }
    : undefined;
}
