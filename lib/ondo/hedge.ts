import { equivalenceByUnderlying, type EquivalentSource } from "@/lib/trustware/equivalents";

import { findMarket } from "./markets";
import type { OndoMarket } from "./types";

// Which perp offsets which tokenized stock, and whether the stock can pay for
// its own hedge.
//
// The table carries two markets per row rather than one, because which of them
// is correct is Ondo's decision to make at runtime and they have changed it
// under us once already:
//
//   On 2026-08-10, SPY-USD.P and QQQ-USD.P carried `disabled: true` in
//   production. S&P and Nasdaq exposure could only be hedged through the index
//   perps, which track a correlated index rather than the ETF and price at
//   index level (10x SPY, 41x QQQ). On 2026-08-25 both are enabled, open and
//   trading at ETF level. Nothing announced the change.
//
// So `market` is what we want and `proxyMarket` is what we fall back to, and
// resolveHedgeRoute picks between them by reading the live catalog. Hardcoding
// either one is how a hedge ends up routed to a market that rejects every order,
// or sized against an index when the exact instrument was available all along.
// Sandbox cannot settle the question: it enables and disables a different set.
//
// The second dimension is collateral. Only some Ondo tokens are accepted as
// margin: SPYon, QQQon, GLDon, SLVon, CRCLon, SPCXon and SNDKon as of
// 2026-08-25, and notably not TSLAon or NVDAon, though TSLA-USD.P and
// NVDA-USD.P are both live markets. A row with no collateralSymbol has a market
// to short but nothing to margin it with out of the holding itself, so the UI
// can say precisely why the hedge is unavailable instead of omitting the asset.

export type HedgeMatch = "exact" | "proxy";

export interface HedgeRoute {
  xstockSymbol: string;
  underlying: string;
  // The perp on the same instrument as the xStock. Preferred whenever it is
  // tradeable.
  market: string;
  // Correlated stand-in for when `market` is disabled. Priced at index level,
  // not ETF level, so it is only ever sized through USD notional. Absent where
  // no sensible proxy exists.
  proxyMarket?: string;
  // The Ondo token accepted as margin for this underlying, or null when none is.
  collateralSymbol: string | null;
}

const ROUTES: readonly HedgeRoute[] = [
  { xstockSymbol: "SPYx", underlying: "SPY", market: "SPY-USD.P", proxyMarket: "US500-USD.P", collateralSymbol: "SPYon" },
  { xstockSymbol: "QQQx", underlying: "QQQ", market: "QQQ-USD.P", proxyMarket: "US100-USD.P", collateralSymbol: "QQQon" },
  { xstockSymbol: "TSLAx", underlying: "TSLA", market: "TSLA-USD.P", collateralSymbol: null },
  { xstockSymbol: "NVDAx", underlying: "NVDA", market: "NVDA-USD.P", collateralSymbol: null },
  { xstockSymbol: "AAPLx", underlying: "AAPL", market: "AAPL-USD.P", collateralSymbol: null },
  { xstockSymbol: "METAx", underlying: "META", market: "META-USD.P", collateralSymbol: null },
  { xstockSymbol: "GOOGLx", underlying: "GOOGL", market: "GOOGL-USD.P", collateralSymbol: null },
  { xstockSymbol: "COINx", underlying: "COIN", market: "COIN-USD.P", collateralSymbol: null },
  // CRCLon became accepted collateral between 2026-08-10 and 2026-08-25. The
  // hedge still cannot be funded end to end, because lib/trustware/equivalents.ts
  // only holds the four underlyings with Jupiter Lend borrow vaults and CRCL is
  // not one of them. Recorded here as Ondo's own answer; the funding leg is
  // what has to catch up.
  { xstockSymbol: "CRCLx", underlying: "CRCL", market: "CRCL-USD.P", collateralSymbol: "CRCLon" },
  { xstockSymbol: "MSTRx", underlying: "MSTR", market: "MSTR-USD.P", collateralSymbol: null },
  // SPCXon is in Ondo's token config and marks against a live SPCX-USD.P, so
  // it is recorded as accepted collateral. The funding leg has the same gap as
  // CRCL above: lib/trustware/equivalents.ts carries only the four underlyings
  // with Jupiter Lend borrow vaults, and SPCX is not one of them.
  { xstockSymbol: "SPCXx", underlying: "SPCX", market: "SPCX-USD.P", collateralSymbol: "SPCXon" },
  // Gold has no ETF perp on Ondo. XAU-USD.P is spot gold, roughly 11x the GLD
  // share price, so this route is a proxy in the same sense the index perps
  // were: correlated, differently scaled, sized through notional only.
  { xstockSymbol: "GLDx", underlying: "GLD", market: "XAU-USD.P", collateralSymbol: "GLDon" },
] as const;

export function hedgeRouteFor(xstockSymbol: string): HedgeRoute | undefined {
  return ROUTES.find((r) => r.xstockSymbol === xstockSymbol);
}

export function selfCollateralizingRoutes(): HedgeRoute[] {
  return ROUTES.filter((r) => r.collateralSymbol !== null);
}

export interface ResolvedHedgeRoute {
  route: HedgeRoute;
  market: OndoMarket;
  match: HedgeMatch;
}

// Picks the market to short by asking the live catalog which of the row's two
// candidates is actually tradeable, preferring the exact one.
//
// `tradeable` is not the same question as "does this symbol exist". A disabled
// market resolves by name and then rejects every order, which is why this
// filters on the flag rather than on the lookup succeeding.
//
// Returns undefined when neither candidate is tradeable, which the caller
// reports as a blocked hedge rather than falling through to some third market.
export function resolveHedgeRoute(
  route: HedgeRoute,
  markets: OndoMarket[],
): ResolvedHedgeRoute | undefined {
  const exact = findMarket(markets, route.market);
  if (exact?.tradeable) {
    // A route with a proxy defined is an ETF hedged by an index perp when the
    // ETF market is down. When the exact market is up, there is no basis risk
    // to disclose.
    return { route, market: exact, match: "exact" };
  }

  if (route.proxyMarket) {
    const proxy = findMarket(markets, route.proxyMarket);
    if (proxy?.tradeable) return { route, market: proxy, match: "proxy" };
  }

  return undefined;
}

// GLDx is a proxy on Ondo whichever way the flags fall: XAU-USD.P is spot gold,
// not the ETF. Routes whose only market is a different instrument are marked
// here rather than inferred from the fallback, which is about availability.
const ALWAYS_PROXY = new Set(["GLDx"]);

export function isProxyRoute(resolved: ResolvedHedgeRoute): boolean {
  return resolved.match === "proxy" || ALWAYS_PROXY.has(resolved.route.xstockSymbol);
}

// Where Trustware should deliver the converted stock. Pulled from the existing
// equivalence registry rather than re-hardcoded, so there is one place in the
// repo that owns a token address. Returns undefined for an underlying whose Ondo
// token is not accepted as margin, and for one the registry does not carry.
export function ondoCollateralSource(
  underlying: string,
): EquivalentSource | undefined {
  const route = ROUTES.find((r) => r.underlying === underlying);
  if (!route?.collateralSymbol) return undefined;

  // The registry's Underlying union is narrower than our route table, so this
  // lookup is deliberately by string and allowed to miss.
  const entry = equivalenceByUnderlying(
    underlying as Parameters<typeof equivalenceByUnderlying>[0],
  );

  return entry?.sources.find(
    (s) =>
      s.issuer === "ondo" &&
      s.kind === "evm" &&
      s.chain === EVM_MAINNET_CHAIN &&
      s.symbol === route.collateralSymbol,
  );
}

// Trustware's chain id for Ethereum mainnet, the only network Ondo Perps credits
// equity collateral on.
export const EVM_MAINNET_CHAIN = "1";
