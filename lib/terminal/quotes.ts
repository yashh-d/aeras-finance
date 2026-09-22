// One price line for the Terminal's tape and overview strip, whatever it is
// priced by. Catalog assets are priced by Jupiter, the crypto majors by their
// Lighter perp mark, and the two surfaces should not have to know which.
//
// The target says what a click does. A catalog asset becomes the selected
// asset, which puts its chart and ticket on screen; a perp opens the Perps
// tab, because nothing on the Terminal trades a perp.

import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS, xstockBySymbol, type XStock } from "@/lib/jupiter/xstocks";
import type { LighterMarket } from "@/lib/lighter/types";
import { marketLogo } from "@/lib/tokens/market-logos";

export type QuoteTarget =
  | { kind: "asset"; xstock: XStock }
  | { kind: "perp"; symbol: string };

export interface Quote {
  id: string;
  // What the tape prints. The catalog symbol, or "BTC-PERP" for a perp so it
  // is not mistaken for spot.
  symbol: string;
  // What the strip prints above the price.
  name: string;
  price: number | null;
  // Percent over 24 hours, signed. Null until priced.
  change: number | null;
  // Public path to a mark, where one exists. The chips draw it; the tape,
  // which is one line of text, does not.
  logo?: string;
  target: QuoteTarget;
}

export function catalogQuote(
  xstock: XStock,
  prices: JupiterPriceMap | null,
): Quote {
  const entry = prices?.[xstock.mint];
  return {
    id: `asset:${xstock.mint}`,
    symbol: xstock.symbol,
    name: xstock.name,
    price: entry?.usdPrice ?? null,
    change: entry?.priceChange24h ?? null,
    logo: xstock.logo,
    target: { kind: "asset", xstock },
  };
}

export function perpQuote(
  symbol: string,
  name: string,
  markets: readonly LighterMarket[],
  // A mark to fall back on when the perps market list has none. The equity
  // perps pass the catalog asset's, which is the same company.
  fallbackLogo?: string,
): Quote {
  const market = markets.find((m) => m.symbol === symbol);
  const mark = market ? Number(market.markPrice) : NaN;
  return {
    id: `perp:${symbol}`,
    symbol: `${symbol}-PERP`,
    name,
    price: Number.isFinite(mark) && mark > 0 ? mark : null,
    change: market?.dailyPriceChange ?? null,
    logo: marketLogo(symbol) ?? fallbackLogo,
    target: { kind: "perp", symbol },
  };
}

// The Lighter perp on each catalog name's underlying, for the names that have
// one. Lighter's catalog does not say which of its markets are equities, so
// the catalog is the list and the underlying ticker is the key: "AAPLx" looks
// up "AAPL", "PAXG" looks up "PAXG". Only markets present in `markets` are
// returned, and the hook that feeds this has already dropped inactive ones,
// which is what keeps SPCXx on the live SPCX book rather than the dead SPACEX
// one that lib/lighter/hedge.ts warns about. GLDx has no GLD market and is
// left out rather than shown against spot gold, which is a different
// instrument at a different price.
export function equityPerpQuotes(markets: readonly LighterMarket[]): Quote[] {
  const out: Quote[] = [];
  for (const xstock of XSTOCKS) {
    const underlying = underlyingTicker(xstock);
    if (!markets.some((m) => m.symbol === underlying)) continue;
    out.push(perpQuote(underlying, xstock.name, markets, xstock.logo));
  }
  return out;
}

// "AAPLx" to "AAPL". A bullion symbol has no suffix and is its own ticker.
export function underlyingTicker(xstock: Pick<XStock, "symbol">): string {
  return xstock.symbol.replace(/x$/, "");
}

// The catalog asset whose underlying a Lighter market is on, if any. "AAPL"
// finds Apple; "HYPE" finds nothing.
export function xstockForPerp(symbol: string): XStock | undefined {
  return XSTOCKS.find((x) => underlyingTicker(x) === symbol);
}

// What a market is called on the Terminal: the catalog name for a market on
// a catalog underlying, the major's name for the three majors, else the
// symbol itself, which is what Lighter calls it too.
export function perpName(symbol: string): string {
  return (
    xstockForPerp(symbol)?.name ??
    CRYPTO_PERPS.find((p) => p.symbol === symbol)?.name ??
    symbol
  );
}

// Every tradeable market, busiest first, with the catalog's mark where the
// market has no mark of its own. `limit` caps the list for a row; the picker
// takes all of it.
export function allPerpQuotes(
  markets: readonly LighterMarket[],
  limit = Infinity,
): Quote[] {
  return [...markets]
    .sort((a, b) => b.dailyQuoteVolume - a.dailyQuoteVolume)
    .slice(0, limit)
    .map((m) => {
      const quote = perpQuote(m.symbol, perpName(m.symbol), markets);
      return quote.logo ? quote : { ...quote, logo: xstockForPerp(m.symbol)?.logo };
    });
}

// The crypto majors the tape and strip carry beside the catalog. Lighter's
// symbols; all three are active markets, checked live 2026-09-10.
export const CRYPTO_PERPS: readonly { symbol: string; name: string }[] = [
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "SOL", name: "Solana" },
] as const;

export function cryptoPerpQuotes(markets: readonly LighterMarket[]): Quote[] {
  return CRYPTO_PERPS.map((p) => perpQuote(p.symbol, p.name, markets));
}

// The overview strip: the two index funds, Bitcoin and Ethereum, and gold.
// Solana stays on the tape but not here; the strip is the market at a glance
// and the two majors say what crypto did. Gold is Tether's ounce (XAUt0)
// rather than the ETF share, so the figure is the one a reader recognises as
// the gold price.
const OVERVIEW_PERPS: readonly string[] = ["BTC", "ETH"];

export function overviewQuotes(
  prices: JupiterPriceMap | null,
  markets: readonly LighterMarket[],
): Quote[] {
  const out: Quote[] = [];
  for (const symbol of ["SPYx", "QQQx"]) {
    const x = xstockBySymbol(symbol);
    if (x) out.push(catalogQuote(x, prices));
  }
  for (const perp of CRYPTO_PERPS) {
    if (OVERVIEW_PERPS.includes(perp.symbol)) {
      out.push(perpQuote(perp.symbol, perp.name, markets));
    }
  }
  const gold = xstockBySymbol("XAUt0");
  if (gold) out.push({ ...catalogQuote(gold, prices), name: "Gold, oz" });
  return out;
}

// The tape: the whole catalog in registry order, then the crypto majors.
export function tapeQuotes(
  prices: JupiterPriceMap | null,
  markets: readonly LighterMarket[],
): Quote[] {
  return [
    ...XSTOCKS.map((x) => catalogQuote(x, prices)),
    ...cryptoPerpQuotes(markets),
  ];
}
