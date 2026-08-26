import type { OndoCollateral } from "./collateral";
import { creditedMargin } from "./collateral";
import { hedgeRouteFor, isProxyRoute, resolveHedgeRoute, type HedgeRoute } from "./hedge";
import { autoExchangePrice, autoExchangeTrigger } from "./risk";
import type { OndoMarket, OndoPosition } from "./types";

// What the user is long on Solana, set against what they are short on Ondo.
//
// The sibling of lib/lighter/exposure.ts, and deliberately not a shared
// abstraction over it. The two venues answer the same question with different
// mechanics, and the differences are the whole reason both exist:
//
//   - **Which market offsets a holding is resolved at runtime.** Ondo has
//     flipped SPY-USD.P and QQQ-USD.P between enabled and disabled, so a row
//     carries the market it actually resolved to, plus whether that is the
//     exact instrument or an index proxy.
//   - **Margin can be the stock itself.** Lighter takes USDC only. On Ondo a
//     holding can be posted as its own collateral, so a row knows whether the
//     asset it is hedging is accepted margin, and what it would credit.
//   - **There is a second risk surface.** A Lighter hedge is liquidated. An
//     Ondo hedge can also have its collateral auto-sold at 30% LTV or $100k of
//     debt, which is not liquidation and does not close the position. A row
//     carries the auto-exchange trigger because it fires first for a
//     self-collateralized hedge and is the number that ends it.
//
// Pure, so the arithmetic can be checked without a browser. Ordinary numbers
// throughout, following risk.ts: nothing here is submitted. Order sizes come
// from sizing.ts in exact BigInt at the moment the user commits.

export type OndoCoverage = "unhedged" | "hedged" | "partial" | "over-hedged";

// Same 2% tolerance as the Lighter surface, for the same reason: perp sizes are
// quantized to the market increment and the two legs price independently, so an
// offset hedge never lands on exactly 1.00.
const COVERAGE_TOLERANCE = 0.02;

export function coverageFor(ratio: number): OndoCoverage {
  if (ratio <= 0) return "unhedged";
  if (ratio > 1 + COVERAGE_TOLERANCE) return "over-hedged";
  if (ratio >= 1 - COVERAGE_TOLERANCE) return "hedged";
  return "partial";
}

export interface OndoHedgeHolding {
  xstockSymbol: string;
  mint: string;
  // Exact decimal string. An order is eventually sized from this, not from the
  // float below.
  quantity: string;
  tokenPriceUsd: number;
  exposureUsd: number;
}

export interface OndoHedgeView {
  route: HedgeRoute;
  holding: OndoHedgeHolding;
  // The market this holding actually routes to right now, or null when neither
  // the exact market nor the proxy is tradeable. The row is still rendered, so
  // a user holding the asset is told why rather than shown nothing.
  market: OndoMarket | null;
  // True when the resolved market is a correlated stand-in rather than the same
  // instrument: an index perp for an ETF, or spot gold for GLDx. Read from the
  // market that resolved, never assumed per ticker.
  proxy: boolean;
  // The Ondo token this holding can be posted as, when Ondo credits one.
  collateral: OndoCollateral | null;
  // What the whole holding would credit as margin if posted. Null when the
  // asset is not accepted collateral, or has no market to mark against.
  creditableUsd: number | null;
  position: OndoPosition | null;
  shortNotionalUsd: number;
  coverageRatio: number;
  coverage: OndoCoverage;
  // Price of the underlying at which Ondo auto-sells the collateral backing
  // this hedge. Null when no rally reaches either trigger, and only meaningful
  // for a self-collateralized hedge.
  autoExchangePriceUsd: number | null;
  autoExchangeTrigger: "ltv" | "debt-cap" | "never";
}

// Only a short on the market this holding actually routes to counts. Matching
// by ticker instead would miss GLDx, which offsets against XAU, and would count
// a short opened against a different holding on a shared market.
function shortFor(positions: OndoPosition[], market: string): OndoPosition | null {
  return (
    positions.find(
      (p) => p.market === market && p.direction === "short" && Number(p.netQuantity) > 0,
    ) ?? null
  );
}

export function buildOndoHedgeViews(input: {
  holdings: { xstockSymbol: string; mint: string; quantity: string }[];
  priceUsdByMint: Record<string, number | undefined>;
  markets: OndoMarket[];
  positions: OndoPosition[];
  collateral: OndoCollateral[];
  // USDC sitting in the Ondo margin account. Cushions the auto-exchange
  // trigger, so a projection that ignores it reads worse than reality.
  usdcBalanceUsd?: number;
}): OndoHedgeView[] {
  const views: OndoHedgeView[] = [];

  for (const holding of input.holdings) {
    const route = hedgeRouteFor(holding.xstockSymbol);
    if (!route) continue;

    const quantity = Number(holding.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const tokenPriceUsd = input.priceUsdByMint[holding.mint] ?? 0;
    const exposureUsd = quantity * tokenPriceUsd;

    const resolved = resolveHedgeRoute(route, input.markets);
    const market = resolved?.market ?? null;

    const collateral =
      route.collateralSymbol === null
        ? null
        : (input.collateral.find((c) => c.symbol === route.collateralSymbol) ?? null);

    // What the holding would be worth as margin. Quantity is the whole holding,
    // not the hedged portion: the entire position is posted as collateral even
    // when only part of it is offset.
    const credited = collateral ? creditedMargin(collateral, quantity) : null;

    const position = market ? shortFor(input.positions, market.market) : null;
    const shortNotionalUsd = position ? Number(position.notionalValue) : 0;
    const coverageRatio = exposureUsd > 0 ? shortNotionalUsd / exposureUsd : 0;

    // The auto-exchange projection assumes the holding is posted as its own
    // margin, which is the flow this surface offers. It is left null for an
    // asset that cannot be, because there is no collateral for Ondo to sell.
    const projection = {
      collateralValueUsd: credited ? credited.marketValueUsd : 0,
      shortNotionalUsd,
      usdcBalanceUsd: input.usdcBalanceUsd ?? 0,
      haircut: collateral?.haircut,
    };
    const projectable = credited !== null && shortNotionalUsd > 0;

    views.push({
      route,
      holding: {
        xstockSymbol: holding.xstockSymbol,
        mint: holding.mint,
        quantity: holding.quantity,
        tokenPriceUsd,
        exposureUsd,
      },
      market,
      proxy: resolved ? isProxyRoute(resolved) : false,
      collateral,
      creditableUsd: credited?.creditedUsd ?? null,
      position,
      shortNotionalUsd,
      coverageRatio,
      coverage: coverageFor(coverageRatio),
      autoExchangePriceUsd: projectable
        ? autoExchangePrice(projection, tokenPriceUsd)
        : null,
      autoExchangeTrigger: projectable ? autoExchangeTrigger(projection) : "never",
    });
  }

  // Largest exposure first. That is the position a user came to hedge.
  return views.sort((a, b) => b.holding.exposureUsd - a.holding.exposureUsd);
}

export interface OndoHedgeTotals {
  exposureUsd: number;
  shortNotionalUsd: number;
  coverageRatio: number;
  // Exposure that could be posted as its own margin. The distinctive number on
  // this venue: it is what the user can hedge without spending USDC.
  selfCollateralizableUsd: number;
}

export function ondoHedgeTotals(views: OndoHedgeView[]): OndoHedgeTotals {
  const exposureUsd = views.reduce((sum, v) => sum + v.holding.exposureUsd, 0);
  const shortNotionalUsd = views.reduce((sum, v) => sum + v.shortNotionalUsd, 0);
  const selfCollateralizableUsd = views.reduce(
    (sum, v) => sum + (v.creditableUsd ?? 0),
    0,
  );

  return {
    exposureUsd,
    shortNotionalUsd,
    coverageRatio: exposureUsd > 0 ? shortNotionalUsd / exposureUsd : 0,
    selfCollateralizableUsd,
  };
}
