import { equivalenceByUnderlying, type EquivalentSource } from "@/lib/trustware/equivalents";

// Which perp offsets which tokenized stock, and whether the stock can pay for
// its own hedge.
//
// Two facts drive this table, both verified against the live API:
//
//   1. SPY-USD.P and QQQ-USD.P exist but carry disabled: true in production, so
//      S&P and Nasdaq exposure can only be hedged with the index perps. Those
//      track a correlated index rather than the ETF itself, which is real basis
//      risk and has to be disclosed rather than hidden. Sandbox leaves both
//      enabled, so this cannot be confirmed by testing there.
//   2. Only SPYon and QQQon of our four Jupiter Lend underlyings are accepted as
//      collateral. TSLAon and NVDAon are not, despite TSLA-USD.P and NVDA-USD.P
//      being live markets.
//
// So exactly the two assets that can self-collateralize are the two that cannot
// be hedged exactly. Everything else is the reverse. The table records both
// dimensions so the UI can explain precisely why a hedge is unavailable instead
// of silently omitting the asset.

export type HedgeMatch = "exact" | "proxy";

export interface HedgeRoute {
  xstockSymbol: string;
  underlying: string;
  market: string;
  match: HedgeMatch;
  // The Ondo token accepted as margin for this underlying, or null when none is.
  collateralSymbol: string | null;
}

const ROUTES: readonly HedgeRoute[] = [
  { xstockSymbol: "SPYx", underlying: "SPY", market: "US500-USD.P", match: "proxy", collateralSymbol: "SPYon" },
  { xstockSymbol: "QQQx", underlying: "QQQ", market: "US100-USD.P", match: "proxy", collateralSymbol: "QQQon" },
  { xstockSymbol: "TSLAx", underlying: "TSLA", market: "TSLA-USD.P", match: "exact", collateralSymbol: null },
  { xstockSymbol: "NVDAx", underlying: "NVDA", market: "NVDA-USD.P", match: "exact", collateralSymbol: null },
  { xstockSymbol: "AAPLx", underlying: "AAPL", market: "AAPL-USD.P", match: "exact", collateralSymbol: null },
  { xstockSymbol: "METAx", underlying: "META", market: "META-USD.P", match: "exact", collateralSymbol: null },
  { xstockSymbol: "GOOGLx", underlying: "GOOGL", market: "GOOGL-USD.P", match: "exact", collateralSymbol: null },
  { xstockSymbol: "COINx", underlying: "COIN", market: "COIN-USD.P", match: "exact", collateralSymbol: null },
  { xstockSymbol: "CRCLx", underlying: "CRCL", market: "CRCL-USD.P", match: "exact", collateralSymbol: null },
  { xstockSymbol: "MSTRx", underlying: "MSTR", market: "MSTR-USD.P", match: "exact", collateralSymbol: null },
] as const;

export function hedgeRouteFor(xstockSymbol: string): HedgeRoute | undefined {
  return ROUTES.find((r) => r.xstockSymbol === xstockSymbol);
}

export function selfCollateralizingRoutes(): HedgeRoute[] {
  return ROUTES.filter((r) => r.collateralSymbol !== null);
}

// Where Trustware should deliver the converted stock. Pulled from the existing
// equivalence registry rather than re-hardcoded, so there is one place in the
// repo that owns a token address. Returns undefined for an underlying whose Ondo
// token is not accepted as margin.
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
