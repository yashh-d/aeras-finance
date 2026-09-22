// Which catalog assets have a Nasdaq listing to read company data from, and
// under which asset class. The equities are companies; SPY, QQQ and GLD are
// funds, which Nasdaq serves under `etf` (asking for GLD as a stock is a 400);
// the bullion tokens are metal and have no listing at all.
//
// The TradingView symbol is the candle chart's subject: the underlying on its
// home exchange, or spot gold for the metal tokens. Checked against
// TradingView's symbol search by scripts/company-check.mts.

import { XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";
import { underlyingTicker } from "@/lib/terminal/quotes";

import type { CompanySection } from "./types";

export type NasdaqAssetClass = "stocks" | "etf";

export interface NasdaqListing {
  ticker: string;
  assetClass: NasdaqAssetClass;
}

const FUNDS: ReadonlySet<string> = new Set(["SPYx", "QQQx", "GLDx"]);

export function nasdaqListing(xstock: XStock): NasdaqListing | null {
  if (xstock.category === "stocks") {
    return { ticker: underlyingTicker(xstock), assetClass: "stocks" };
  }
  if (FUNDS.has(xstock.symbol)) {
    return { ticker: underlyingTicker(xstock), assetClass: "etf" };
  }
  return null;
}

// The sections a listing can answer. A fund has a quote and a summary and
// nothing to say about income statements or insiders.
export function sectionsFor(listing: NasdaqListing): readonly CompanySection[] {
  return listing.assetClass === "stocks"
    ? ["quote", "summary", "financials", "profile", "dividends", "insiders", "filings"]
    : ["quote", "summary"];
}

// The catalog asset behind a ticker the route was asked for, or undefined
// when nothing in the catalog is listed under it. Resolving through the
// catalog is what keeps the route from proxying an arbitrary symbol.
export function listedAssetByTicker(ticker: string): { xstock: XStock; listing: NasdaqListing } | undefined {
  for (const xstock of XSTOCKS) {
    const listing = nasdaqListing(xstock);
    if (listing && listing.ticker === ticker) return { xstock, listing };
  }
  return undefined;
}

const TRADINGVIEW: Readonly<Record<string, string>> = {
  AAPLx: "NASDAQ:AAPL",
  TSLAx: "NASDAQ:TSLA",
  NVDAx: "NASDAQ:NVDA",
  MSFTx: "NASDAQ:MSFT",
  AMZNx: "NASDAQ:AMZN",
  METAx: "NASDAQ:META",
  GOOGLx: "NASDAQ:GOOGL",
  COINx: "NASDAQ:COIN",
  CRCLx: "NYSE:CRCL",
  MSTRx: "NASDAQ:MSTR",
  SPYx: "AMEX:SPY",
  QQQx: "NASDAQ:QQQ",
  SPCXx: "NASDAQ:SPCX",
  HOODx: "NASDAQ:HOOD",
  PLTRx: "NASDAQ:PLTR",
  MCDx: "NYSE:MCD",
  AVGOx: "NASDAQ:AVGO",
  GLDx: "AMEX:GLD",
  PAXG: "TVC:GOLD",
  XAUt0: "TVC:GOLD",
};

export function tradingViewSymbol(xstock: XStock): string | null {
  return TRADINGVIEW[xstock.symbol] ?? null;
}

// A sector per catalog asset, for the "related" list beside the ticket.
// Nasdaq's own sector names for the companies, read 2026-09-11; the funds
// and metals are grouped by what they are. A registry rather than a fetch
// because one related list needs every asset's sector and a summary call per
// asset per viewer is the wrong price for a list of chips.
const SECTORS: Readonly<Record<string, string>> = {
  AAPLx: "Technology",
  TSLAx: "Consumer Discretionary",
  NVDAx: "Technology",
  MSFTx: "Technology",
  AMZNx: "Consumer Discretionary",
  METAx: "Technology",
  GOOGLx: "Technology",
  COINx: "Finance",
  CRCLx: "Finance",
  MSTRx: "Technology",
  SPYx: "Index funds",
  QQQx: "Index funds",
  SPCXx: "Industrials",
  HOODx: "Finance",
  PLTRx: "Technology",
  MCDx: "Consumer Discretionary",
  AVGOx: "Technology",
  GLDx: "Gold",
  PAXG: "Gold",
  XAUt0: "Gold",
};

export function sectorOf(xstock: XStock): string | null {
  return SECTORS[xstock.symbol] ?? null;
}

// Other catalog assets in the same sector, in registry order. Falls back to
// the other companies when the sector has no one else in it, so the list is
// never empty for a company.
export function relatedAssets(xstock: XStock, limit: number): XStock[] {
  const sector = sectorOf(xstock);
  const same = XSTOCKS.filter((x) => x.mint !== xstock.mint && sectorOf(x) === sector);
  if (same.length > 0) return same.slice(0, limit);
  return XSTOCKS.filter((x) => x.mint !== xstock.mint && x.category === xstock.category).slice(0, limit);
}
