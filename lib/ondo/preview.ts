import { ONDO_DEPOSIT_NETWORK } from "./constants";
import { hedgeRouteFor, type HedgeRoute } from "./hedge";
import { collateralOnNetwork, findMarket, type OndoCatalog } from "./markets";
import {
  autoExchangePrice,
  autoExchangePriceMove,
  collateralLtv,
  marginHeadroom,
} from "./risk";
import { computeHedgeSize, type HedgeSize } from "./sizing";
import type { OndoMarket } from "./types";

// Everything the hedge panel needs for one holding, assembled from the catalog
// and the pure math in sizing.ts and risk.ts. No network calls, so the
// verification script can exercise the same code path the UI will.
//
// v1 only offers the self-collateralized routes, where the stock being hedged
// is itself accepted as margin. That is SPYx and QQQx and nothing else. The
// other eight curated xStocks resolve to a live perp market but have no Ondo
// margin token, so they are reported as blocked with a reason the UI can
// explain rather than omitted from the list.

export type HedgeBlocker =
  | "unsupported-asset"
  | "no-ondo-collateral"
  | "collateral-not-on-ethereum"
  | "market-missing"
  | "market-disabled"
  | "no-price"
  | "no-holding"
  | "dust";

export interface HedgeCollateral {
  symbol: string;
  network: string;
  contractAddress: string;
  decimals: number;
}

export interface HedgeRisk {
  // LTV the moment the hedge opens. Zero: the short has no loss yet.
  ltvAtOpen: number;
  // Rally that pushes LTV to the auto-exchange threshold, as a fraction.
  autoExchangeMove: number | null;
  // The same trigger as a token price, which is the number to show. Denominated
  // in the stock, not the index perp, because that is the price the user reads.
  autoExchangePriceUsd: number | null;
  marginSufficient: boolean;
}

export interface HedgePreview {
  ok: true;
  route: HedgeRoute;
  market: OndoMarket;
  collateral: HedgeCollateral;
  size: HedgeSize;
  risk: HedgeRisk;
  // Index perp standing in for an ETF. Real tracking error, and the UI has to
  // say so rather than presenting the hedge as exact.
  basisRisk: boolean;
  // Ondo accepts orders while a market is closed but they rest until it opens.
  marketClosed: boolean;
}

export interface HedgeBlocked {
  ok: false;
  reason: HedgeBlocker;
  route: HedgeRoute | undefined;
  market: OndoMarket | undefined;
}

export type HedgePreviewResult = HedgePreview | HedgeBlocked;

export interface HedgePreviewInput {
  catalog: OndoCatalog;
  xstockSymbol: string;
  // Free spot balance of the xStock, in tokens.
  quantity: string;
  tokenPriceUsd: string;
  // 0 to 1. The whole holding is posted as collateral regardless; this only
  // sizes the short.
  hedgeRatio: number;
  // USDC already in the perps account. Delays auto-exchange, never prevents it.
  usdcBalanceUsd?: number;
}

export function previewHedge(input: HedgePreviewInput): HedgePreviewResult {
  const route = hedgeRouteFor(input.xstockSymbol);
  if (!route) return { ok: false, reason: "unsupported-asset", route: undefined, market: undefined };

  const market = findMarket(input.catalog.markets, route.market);

  if (!route.collateralSymbol) {
    return { ok: false, reason: "no-ondo-collateral", route, market };
  }
  if (!market) return { ok: false, reason: "market-missing", route, market: undefined };
  if (!market.tradeable) return { ok: false, reason: "market-disabled", route, market };

  const onchain = collateralOnNetwork(
    input.catalog.collateral,
    route.collateralSymbol,
    ONDO_DEPOSIT_NETWORK,
  );
  if (!onchain) {
    return { ok: false, reason: "collateral-not-on-ethereum", route, market };
  }

  const price = Number(market.price);
  if (!(price > 0)) return { ok: false, reason: "no-price", route, market };

  const size = computeHedgeSize({
    quantity: input.quantity,
    tokenPriceUsd: input.tokenPriceUsd,
    hedgeRatio: input.hedgeRatio,
    marketPriceUsd: market.price,
    baseIncrement: market.baseIncrement,
    maxPositionBaseSize: market.maxPositionBaseSize,
  });

  const exposureUsd = Number(size.exposureNotionalUsd);
  if (exposureUsd <= 0) return { ok: false, reason: "no-holding", route, market };
  if (size.size === "0") return { ok: false, reason: "dust", route, market };

  const shortNotionalUsd = Number(size.notionalUsd);
  const usdcBalanceUsd = input.usdcBalanceUsd ?? 0;
  const projection = {
    collateralValueUsd: exposureUsd,
    shortNotionalUsd,
    usdcBalanceUsd,
  };

  return {
    ok: true,
    route,
    market,
    collateral: {
      symbol: route.collateralSymbol,
      network: ONDO_DEPOSIT_NETWORK,
      contractAddress: onchain.contractAddress,
      decimals: onchain.decimals,
    },
    size,
    risk: {
      ltvAtOpen: collateralLtv({
        collateralValueUsd: exposureUsd,
        usdcBalanceUsd,
        unrealizedPnlUsd: 0,
      }),
      autoExchangeMove: autoExchangePriceMove(projection),
      autoExchangePriceUsd: autoExchangePrice(
        projection,
        Number(input.tokenPriceUsd),
      ),
      marginSufficient: marginHeadroom({
        collateralValueUsd: exposureUsd,
        shortNotionalUsd,
        maxLeverage: Number(market.maxLeverage),
        usdcBalanceUsd,
      }).sufficient,
    },
    basisRisk: route.match === "proxy",
    marketClosed: market.isClosed,
  };
}
