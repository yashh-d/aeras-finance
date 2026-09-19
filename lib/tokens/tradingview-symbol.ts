// The TradingView symbol for a perps market.
//
// The perps tab charts the underlying on TradingView rather than the venue's
// own candles, so both venues resolve a market to one of TradingView's symbols
// here. The input is the base ticker the venues already share: Lighter names
// a market by bare ticker ("TSLA", "BTC") and Ondo by "TSLA-USD.P", which
// marketTicker() in market-logos.ts reduces to the same thing.
//
// Three shapes come out. Equities, ETFs, indices and commodities are listed
// explicitly with their exchange, because a bare "SPY" or "XAU" resolves on
// TradingView to whatever its search ranks first, and for metals and indices
// that is a CFD or a futures contract rather than the spot price the venue
// marks against. Anything else is taken to be crypto and pointed at Binance's
// USDT perpetual, which is the closest thing to what a venue's perp trades and
// has the widest coverage of the long tail Lighter lists. And a few names are
// deliberately null: SpaceX and CXMT are not public, so there is no chart of
// the underlying anywhere, and the panel says so instead of showing
// TradingView's "invalid symbol" screen.
//
// The chart is the underlying, not the perp. A venue's mark can sit off the
// spot price by its funding and basis, so the footer says which is drawn.

const LISTED: Readonly<Record<string, string>> = {
  // Equities
  AAPL: "NASDAQ:AAPL",
  AMD: "NASDAQ:AMD",
  AMZN: "NASDAQ:AMZN",
  ARM: "NASDAQ:ARM",
  AVGO: "NASDAQ:AVGO",
  BABA: "NYSE:BABA",
  BB: "NYSE:BB",
  COIN: "NASDAQ:COIN",
  CRCL: "NYSE:CRCL",
  CRWV: "NASDAQ:CRWV",
  GLW: "NYSE:GLW",
  GOOGL: "NASDAQ:GOOGL",
  HOOD: "NASDAQ:HOOD",
  IBM: "NYSE:IBM",
  INTC: "NASDAQ:INTC",
  LITE: "NASDAQ:LITE",
  META: "NASDAQ:META",
  MRVL: "NASDAQ:MRVL",
  MSFT: "NASDAQ:MSFT",
  MSTR: "NASDAQ:MSTR",
  MU: "NASDAQ:MU",
  NBIS: "NASDAQ:NBIS",
  NFLX: "NASDAQ:NFLX",
  NVDA: "NASDAQ:NVDA",
  ORCL: "NYSE:ORCL",
  PLTR: "NASDAQ:PLTR",
  SNDK: "NASDAQ:SNDK",
  TSLA: "NASDAQ:TSLA",
  TSM: "NYSE:TSM",
  // Foreign listings Ondo carries under its own tickers.
  SKHY: "KRX:000660",
  SMSN: "KRX:005930",

  // ETFs
  EWY: "AMEX:EWY",
  QQQ: "NASDAQ:QQQ",
  SOXL: "AMEX:SOXL",
  SPY: "AMEX:SPY",

  // Indices. Ondo's US500 and US100 mark against the index level, so the cash
  // index rather than a CFD or a futures contract.
  US100: "NASDAQ:NDX",
  US500: "SP:SPX",

  // Commodities. Spot for the metals, which is what both venues mark gold and
  // silver against; the front-month contract for the rest, which have no spot
  // series on TradingView.
  XAU: "OANDA:XAUUSD",
  XAG: "OANDA:XAGUSD",
  COPPER: "COMEX:HG1!",
  NATGAS: "NYMEX:NG1!",
  BRENT: "ICEEUR:BRN1!",
  WTI: "NYMEX:CL1!",
};

// Markets whose underlying has no public price series.
const UNCHARTED: ReadonlySet<string> = new Set([
  "SPCX",
  "SPACEX",
  "CXMT",
  "DRAM",
]);

// Ondo tags every market with one category; Lighter has no tags at all. The
// hint only matters for a name missing from the table above: a tagged equity
// is passed through bare for TradingView to resolve, and everything else is
// treated as crypto.
export type TradingViewCategoryHint = "crypto" | "listed";

export function tradingViewSymbol(
  ticker: string,
  hint?: TradingViewCategoryHint,
): string | null {
  const t = ticker.toUpperCase();
  if (UNCHARTED.has(t)) return null;
  const listed = LISTED[t];
  if (listed) return listed;
  if (hint === "listed") return t;
  return `BINANCE:${t}USDT.P`;
}

// Ondo's tag vocabulary, from MARKET_CATEGORIES in market-logos.ts.
export function hintFromOndoTags(tags: readonly string[]): TradingViewCategoryHint {
  return tags.includes("Crypto") ? "crypto" : "listed";
}
