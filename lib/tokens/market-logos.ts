// Logos for the Ondo perps catalog, keyed by base ticker.
//
// Ondo's own API carries `logoUrl` for only 8 of its 52 markets, all crypto,
// and `backgroundColour` for even fewer. The other 44 are equities, ETFs,
// indices and commodities, so the art comes from two places and one of them is
// deliberately not art at all:
//
//   1. A local file under /logos/markets, downloaded once and self-hosted.
//      Crypto marks come from Ondo's CDN so they match the venue; equity and
//      ETF marks come from a stock-logo source.
//   2. A monogram badge for the eight with no usable mark. Spot metals, index
//      products and two thinly-covered foreign names have no logo anywhere,
//      and Ondo's own interface draws exactly this: "Au" on gold, "Ag" on
//      silver-grey, "100" and "500" on their index colours. Inventing a logo
//      would be worse than the badge.

export interface MarketBadge {
  label: string;
  background: string;
  foreground: string;
}

// Tickers with a file at /logos/markets/<TICKER>.<ext>. Listed explicitly
// rather than probed, so a deleted file fails the check script instead of
// silently degrading to a monogram in production.
const FILES: Readonly<Record<string, string>> = Object.fromEntries(
  (
    [
      ["AAPL", "png"],
      ["AMD", "png"],
      ["AMZN", "png"],
      ["ARM", "png"],
      ["AVGO", "png"],
      ["BABA", "png"],
      ["BB", "png"],
      ["BRENT", "png"],
      ["BTC", "svg"],
      ["CBRS", "png"],
      ["COIN", "png"],
      ["CRCL", "png"],
      ["CRWV", "png"],
      ["DRAM", "png"],
      ["ETH", "svg"],
      ["EWY", "png"],
      ["GLW", "png"],
      ["GOOGL", "png"],
      ["HOOD", "png"],
      ["HYPE", "svg"],
      ["IBM", "png"],
      ["INTC", "png"],
      ["LITE", "png"],
      ["META", "png"],
      ["MRVL", "png"],
      ["MSFT", "png"],
      ["MSTR", "png"],
      ["MU", "png"],
      ["NBIS", "png"],
      ["NFLX", "png"],
      ["NVDA", "png"],
      ["ONDO", "svg"],
      ["ORCL", "png"],
      ["PLTR", "png"],
      ["QQQ", "svg"],
      ["SKHY", "png"],
      ["SNDK", "png"],
      ["SOL", "svg"],
      ["SOXL", "png"],
      ["SPCX", "png"],
      ["SPY", "svg"],
      ["TSLA", "png"],
      ["TSM", "png"],
      ["WTI", "png"],
    ] as ReadonlyArray<readonly [string, string]>
  ).map(([t, ext]) => [t, `/logos/markets/${t}.${ext}`]),
);

// The eight with no mark. Colours follow the asset's own convention rather than
// the app palette: gold is gold, silver is grey, and the two index products
// keep the colours the venue already uses for them.
const BADGES: Readonly<Record<string, MarketBadge>> = {
  XAU: { label: "Au", background: "#C8A227", foreground: "#1A1505" },
  XAG: { label: "Ag", background: "#9CA6AD", foreground: "#12171A" },
  COPPER: { label: "Cu", background: "#B06B3A", foreground: "#150C06" },
  NATGAS: { label: "NG", background: "#3E7C8C", foreground: "#F2FAFC" },
  US100: { label: "100", background: "#2F72B8", foreground: "#F2F7FC" },
  US500: { label: "500", background: "#B8383B", foreground: "#FCF3F3" },
  SMSN: { label: "SS", background: "#1428A0", foreground: "#EEF1FC" },
  CXMT: { label: "CX", background: "#4A5560", foreground: "#EFF2F5" },
};

// "SPCXon" -> "SPCX". Ondo's collateral tokens are the market ticker plus an
// "on" suffix, so they share the market's logo rather than needing their own.
export function collateralTicker(symbol: string): string {
  return symbol.endsWith("on") ? symbol.slice(0, -2) : symbol;
}

export function marketTicker(market: string): string {
  // "META-USD.P" -> "META"
  return market.split("-")[0] ?? market;
}

export function marketLogo(market: string): string | undefined {
  return FILES[marketTicker(market)];
}

export function marketBadge(market: string): MarketBadge {
  const t = marketTicker(market);
  return (
    BADGES[t] ?? {
      // Anything new Ondo lists gets a neutral badge until art is added, which
      // is a legible placeholder rather than a broken image.
      label: t.slice(0, 3),
      background: "#3A4048",
      foreground: "#E6EAEE",
    }
  );
}

// Category tabs, in the order the selector shows them. Ondo tags every market
// with exactly one of these.
export const MARKET_CATEGORIES = [
  { id: "all", label: "All", tag: null },
  { id: "crypto", label: "Crypto", tag: "Crypto" },
  { id: "stock", label: "Equities", tag: "Stock" },
  { id: "commodity", label: "Commodities", tag: "Commodity" },
  { id: "index", label: "Indices", tag: "Index" },
  { id: "etf", label: "ETFs", tag: "ETF" },
] as const;

export type MarketCategoryId = (typeof MARKET_CATEGORIES)[number]["id"];

export const MARKET_LOGO_TICKERS = Object.keys(FILES);
export const MARKET_BADGE_TICKERS = Object.keys(BADGES);
