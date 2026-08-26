// Which Lighter market offsets which xStock.
//
// This table is the reason we moved off Ondo. Under Ondo, the two assets that
// could pay for their own hedge (SPY, QQQ) were the two that could not be hedged
// exactly, because SPY-USD.P and QQQ-USD.P are disabled in production and the
// hedge had to route through index perps priced 10x and 41x off the ETF. Here
// ten of eleven xStocks get a market that tracks the same instrument at the same
// price level, SPY and QQQ included.
//
// Verified against live orderBookDetails on 2026-08-16: every market below is
// status "active", and SPY marked 776.39 against the ETF's own 776, confirming
// share-level rather than index-level pricing. Lighter also lists US500 at
// 7783.5, so the index-level markets do exist here. Routing to one of those by
// mistake would open a position ten times too large, which is exactly the Ondo
// failure mode, so the table names markets explicitly and is asserted in
// scripts/lighter-check.mts.

export type HedgeMatch = "exact" | "proxy";

export interface HedgeRoute {
  xstockSymbol: string;
  // Lighter market symbol, not the underlying ticker. They coincide for every
  // exact route and deliberately do not for the proxy.
  market: string;
  match: HedgeMatch;
  // Why the match is inexact, for the UI to disclose. Null on exact routes.
  basis: string | null;
}

const ROUTES: readonly HedgeRoute[] = [
  { xstockSymbol: "SPYx", market: "SPY", match: "exact", basis: null },
  { xstockSymbol: "QQQx", market: "QQQ", match: "exact", basis: null },
  { xstockSymbol: "TSLAx", market: "TSLA", match: "exact", basis: null },
  { xstockSymbol: "NVDAx", market: "NVDA", match: "exact", basis: null },
  { xstockSymbol: "AAPLx", market: "AAPL", match: "exact", basis: null },
  // Lighter lists two SpaceX books. SPCX (id 194) is active and marks at
  // $138.42, matching the xStock. SPACEX (id 173) is inactive and marks at
  // $2,406, a differently denominated instrument, so routing here by name
  // would hedge against a dead book at 17x the wrong price.
  { xstockSymbol: "SPCXx", market: "SPCX", match: "exact", basis: null },
  { xstockSymbol: "METAx", market: "META", match: "exact", basis: null },
  { xstockSymbol: "GOOGLx", market: "GOOGL", match: "exact", basis: null },
  { xstockSymbol: "COINx", market: "COIN", match: "exact", basis: null },
  { xstockSymbol: "CRCLx", market: "CRCL", match: "exact", basis: null },
  { xstockSymbol: "MSTRx", market: "MSTR", match: "exact", basis: null },
  // The one gap. Lighter has no GLD market, so gold exposure routes to spot
  // gold, which marked 4388 against GLD's 400 or so. Sizing by USD notional
  // absorbs that ratio without a correction factor, but the tracking difference
  // is real: GLD holds slightly less than a tenth of an ounce per share and that
  // fraction erodes with the fund's expense ratio, so the hedge drifts against
  // the holding over long horizons.
  {
    xstockSymbol: "GLDx",
    market: "XAU",
    match: "proxy",
    basis:
      "Hedged with spot gold. GLD tracks gold net of fund expenses, so the hedge drifts slightly over time.",
  },
] as const;

export function hedgeRouteFor(xstockSymbol: string): HedgeRoute | undefined {
  return ROUTES.find((r) => r.xstockSymbol === xstockSymbol);
}

export function hedgeRoutes(): readonly HedgeRoute[] {
  return ROUTES;
}

export function exactRoutes(): HedgeRoute[] {
  return ROUTES.filter((r) => r.match === "exact");
}

// Index-level markets that must never be used to hedge an ETF holding. SPY and
// QQQ resolve to their own markets, so reaching one of these means the route
// table was bypassed. Asserted rather than merely documented.
export const INDEX_LEVEL_MARKETS = ["US500", "US100", "SPX"] as const;
