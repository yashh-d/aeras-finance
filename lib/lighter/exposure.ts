// What the user is long on Solana, set against what they are short on Lighter.
//
// The hedge tab exists to answer one question per ticker: how much of this
// holding is currently offset. That answer is a join across three sources that
// know nothing about each other. The wallet holds xStocks keyed by mint, Jupiter
// prices them by mint, Lighter carries positions keyed by its own market symbol,
// and the route table in hedge.ts is the only thing that connects the last two.
//
// Kept pure and separate from the panel so the arithmetic can be checked without
// a browser, and so the panel never has to reach for a price or a route itself.
//
// Everything here is display math in ordinary numbers, following risk.ts rather
// than sizing.ts: nothing computed in this file is submitted anywhere. The order
// size is derived from these figures by computeHedgeSize, in exact BigInt, at the
// moment the user commits.

import { hedgeRouteFor, type HedgeRoute } from "./hedge";
import { findMarket } from "./markets";
import type { LighterMarket, LighterPosition } from "./types";

export interface HedgeableHolding {
  xstockSymbol: string;
  mint: string;
  // Tokens held, as an exact decimal string. Taken from xstocksAtomic rather
  // than the float field, since this is what an order is eventually sized from.
  //
  // This is the TOTAL exposure: wallet balance plus any of the same token
  // posted as borrow collateral. Collateral in a vault is still price exposure,
  // and it is exactly what a borrow-funded hedge creates, so a view keyed to
  // the wallet alone showed "nothing to hedge" the moment that flow deposited
  // the stock, which is the moment the hedge matters most.
  quantity: string;
  // The part of `quantity` sitting in the wallet and spendable. What a NEW
  // borrow can post as collateral; the rest is already posted. Absent means
  // everything is in the wallet.
  walletQuantity?: string;
  tokenPriceUsd: number;
  exposureUsd: number;
}

export type HedgeCoverage =
  // No short against this holding.
  | "unhedged"
  // A short exists and offsets most of the holding.
  | "hedged"
  // A short exists but covers materially less than the holding.
  | "partial"
  // The short is larger than the holding, so the user is net short the
  // underlying rather than flat. Worth naming: it is the one outcome a user who
  // asked for a hedge did not ask for.
  | "over-hedged";

export interface HedgeView {
  route: HedgeRoute;
  holding: HedgeableHolding;
  // Null when the route names a market the catalog does not carry, or carries as
  // untradeable. The row is still shown, because a user holding the asset should
  // be told the hedge is unavailable rather than shown nothing.
  market: LighterMarket | null;
  // The existing short, if any. A long position on the same market is not a
  // hedge and is deliberately not treated as one.
  position: LighterPosition | null;
  shortNotionalUsd: number;
  // Short notional over exposure. 1 is fully offset. Zero exposure yields 0
  // rather than a division by zero.
  coverageRatio: number;
  coverage: HedgeCoverage;
}

// How far off a full hedge still counts as hedged. Perp sizes are quantized to
// the market increment and the two legs are priced independently, so an offset
// hedge is never exactly 1.00 and a stricter test would report a correct hedge
// as partial forever.
const COVERAGE_TOLERANCE = 0.02;

export function coverageFor(ratio: number): HedgeCoverage {
  if (ratio <= 0) return "unhedged";
  if (ratio > 1 + COVERAGE_TOLERANCE) return "over-hedged";
  if (ratio >= 1 - COVERAGE_TOLERANCE) return "hedged";
  return "partial";
}

// Only shorts count, and only on the market this holding actually routes to.
// Matching by the xStock symbol instead would miss GLDx entirely, which hedges
// against XAU.
function shortFor(
  positions: LighterPosition[],
  marketSymbol: string,
): LighterPosition | null {
  return (
    positions.find((p) => p.symbol === marketSymbol && p.isShort) ?? null
  );
}

export function buildHedgeViews(input: {
  // Exact token amounts keyed by mint, from AccountBalances.xstocksAtomic
  // converted to decimal strings.
  holdings: {
    xstockSymbol: string;
    mint: string;
    quantity: string;
    walletQuantity?: string;
  }[];
  priceUsdByMint: Record<string, number | undefined>;
  catalog: LighterMarket[];
  positions: LighterPosition[];
}): HedgeView[] {
  const views: HedgeView[] = [];

  for (const holding of input.holdings) {
    const route = hedgeRouteFor(holding.xstockSymbol);
    // An xStock with no route is not hedgeable here and is left out rather than
    // shown as a row that can never do anything.
    if (!route) continue;

    const quantity = Number(holding.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const tokenPriceUsd = input.priceUsdByMint[holding.mint] ?? 0;
    const exposureUsd = quantity * tokenPriceUsd;

    const market = findMarket(input.catalog, route.market) ?? null;
    const position = shortFor(input.positions, route.market);
    const shortNotionalUsd = position ? Number(position.notionalUsd) : 0;
    const coverageRatio =
      exposureUsd > 0 ? shortNotionalUsd / exposureUsd : 0;

    views.push({
      route,
      holding: {
        xstockSymbol: holding.xstockSymbol,
        mint: holding.mint,
        quantity: holding.quantity,
        walletQuantity: holding.walletQuantity,
        tokenPriceUsd,
        exposureUsd,
      },
      market: market && market.tradeable ? market : null,
      position,
      shortNotionalUsd,
      coverageRatio,
      coverage: coverageFor(coverageRatio),
    });
  }

  // Largest exposure first. That is the position a user came to hedge.
  return views.sort((a, b) => b.holding.exposureUsd - a.holding.exposureUsd);
}

export interface HedgeTotals {
  exposureUsd: number;
  shortNotionalUsd: number;
  coverageRatio: number;
}

// Portfolio-level coverage across every hedgeable holding.
//
// Summed in USD notional and not per share, which is the same reason sizing.ts
// works in notional: GLDx and its XAU hedge are priced an order of magnitude
// apart, so share counts do not add up to anything meaningful.
export function hedgeTotals(views: HedgeView[]): HedgeTotals {
  const exposureUsd = views.reduce((sum, v) => sum + v.holding.exposureUsd, 0);
  const shortNotionalUsd = views.reduce((sum, v) => sum + v.shortNotionalUsd, 0);

  return {
    exposureUsd,
    shortNotionalUsd,
    coverageRatio: exposureUsd > 0 ? shortNotionalUsd / exposureUsd : 0,
  };
}
