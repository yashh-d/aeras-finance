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
      // Fetched by scripts/market-logos-fetch.mts on 2026-09-12 for every
      // Lighter market that had no mark: crypto from CoinGecko, matched by
      // symbol and taking the largest by market cap where symbols collide,
      // equities from a stock-logo source by ticker. Re-run it when Lighter
      // lists a market this table does not know.
      ["0G", "png"],
      ["1000BONK", "png"],
      ["1000FLOKI", "png"],
      ["1000NOT", "png"],
      ["1000PEPE", "png"],
      ["1000SHIB", "png"],
      ["2Z", "png"],
      ["AAOI", "png"],
      ["AAVE", "png"],
      ["ADA", "png"],
      ["ADI", "png"],
      ["AERO", "png"],
      ["AI", "png"],
      ["ANSEM", "png"],
      ["APEX", "png"],
      ["APT", "png"],
      ["ARB", "png"],
      ["ARC", "png"],
      ["ASML", "png"],
      ["ASTER", "png"],
      ["AVAX", "png"],
      ["AVNT", "png"],
      ["AXS", "png"],
      ["AXTI", "png"],
      ["AZTEC", "png"],
      ["BCH", "png"],
      ["BE", "png"],
      ["BERA", "png"],
      ["BIO", "png"],
      ["BMNR", "png"],
      ["BNB", "png"],
      ["BOT", "png"],
      ["BOTZ", "png"],
      ["CAP", "png"],
      ["CASHCAT", "png"],
      ["CC", "png"],
      ["CHIP", "png"],
      ["CRO", "png"],
      ["CRV", "png"],
      ["CTR", "png"],
      ["DASH", "png"],
      ["DATA", "png"],
      ["DELL", "png"],
      ["DOGE", "png"],
      ["DOLO", "png"],
      ["DOT", "png"],
      ["DYDX", "png"],
      ["EDEN", "png"],
      ["EDGE", "png"],
      ["EIGEN", "png"],
      ["ENA", "png"],
      ["ETHFI", "png"],
      ["FARTCOIN", "png"],
      ["FF", "png"],
      ["FIL", "png"],
      ["FOGO", "png"],
      ["FOLKS", "png"],
      ["GEV", "png"],
      ["GME", "png"],
      ["GMX", "png"],
      ["GRAM", "png"],
      ["GRASS", "png"],
      ["HBAR", "png"],
      ["ICP", "png"],
      ["IWM", "png"],
      ["JTO", "png"],
      ["JUP", "png"],
      ["KAITO", "png"],
      ["KORU", "png"],
      ["LDO", "png"],
      ["LINEA", "png"],
      ["LINK", "png"],
      ["LIT", "png"],
      ["LTC", "png"],
      ["MCD", "png"],
      ["MEGA", "png"],
      ["MET", "png"],
      ["MNT", "png"],
      ["MON", "png"],
      ["MORPHO", "png"],
      ["MRNA", "png"],
      ["MYX", "png"],
      ["NEAR", "png"],
      ["NMR", "png"],
      ["NOK", "png"],
      ["NOW", "png"],
      ["OP", "png"],
      ["PAXG", "png"],
      ["PENDLE", "png"],
      ["PENGU", "png"],
      ["POL", "png"],
      ["PONS", "png"],
      ["POPCAT", "png"],
      ["PROVE", "png"],
      ["PUMP", "png"],
      ["PYTH", "png"],
      ["QCOM", "png"],
      ["QNT", "png"],
      ["RAIL", "png"],
      ["RAY", "png"],
      ["RESOLV", "png"],
      ["RIVER", "png"],
      ["RKLB", "png"],
      ["ROBO", "png"],
      ["S", "png"],
      ["SEI", "png"],
      ["SKR", "png"],
      ["SKY", "png"],
      ["SOXS", "png"],
      ["SPX", "png"],
      ["STABLE", "png"],
      ["STBL", "png"],
      ["STRC", "png"],
      ["STRK", "png"],
      ["SUI", "png"],
      ["SYRUP", "png"],
      ["TAO", "png"],
      ["TIA", "png"],
      ["TRUMP", "png"],
      ["TRX", "png"],
      ["TTWO", "png"],
      ["UNI", "png"],
      ["URA", "png"],
      ["USELESS", "png"],
      ["VIRTUAL", "png"],
      ["VVV", "png"],
      ["WDC", "png"],
      ["WEN", "png"],
      ["WIF", "png"],
      ["WLD", "png"],
      ["WLFI", "png"],
      ["XLM", "png"],
      ["XMR", "png"],
      ["XPL", "png"],
      ["XRP", "png"],
      ["ZEC", "png"],
      ["ZK", "png"],
      ["ZORA", "png"],
      ["ZRO", "png"],
    ] as ReadonlyArray<readonly [string, string]>
  ).map(([t, ext]) => [t, `/logos/markets/${t}.${ext}`]),
);

// The markets with no mark. Colours follow the asset's own convention rather
// than the app palette: gold is gold, silver is grey, and the two index
// products keep the colours the venue already uses for them.
const BADGES: Readonly<Record<string, MarketBadge>> = {
  XAU: { label: "Au", background: "#C8A227", foreground: "#1A1505" },
  XAG: { label: "Ag", background: "#9CA6AD", foreground: "#12171A" },
  COPPER: { label: "Cu", background: "#B06B3A", foreground: "#150C06" },
  NATGAS: { label: "NG", background: "#3E7C8C", foreground: "#F2FAFC" },
  US100: { label: "100", background: "#2F72B8", foreground: "#F2F7FC" },
  US500: { label: "500", background: "#B8383B", foreground: "#FCF3F3" },
  SMSN: { label: "SS", background: "#1428A0", foreground: "#EEF1FC" },
  CXMT: { label: "CX", background: "#4A5560", foreground: "#EFF2F5" },
  // Lighter markets with no mark anywhere, badged 2026-09-12. Currency pairs
  // carry the quote currency's sign, metals their element, the rest the
  // company's initials in the same neutral the CXMT badge uses.
  USDJPY: { label: "¥", background: "#3A4F6B", foreground: "#E6EEF7" },
  EURUSD: { label: "€", background: "#3A4F6B", foreground: "#E6EEF7" },
  GBPUSD: { label: "£", background: "#3A4F6B", foreground: "#E6EEF7" },
  USDCHF: { label: "Fr", background: "#3A4F6B", foreground: "#E6EEF7" },
  USDCAD: { label: "C$", background: "#3A4F6B", foreground: "#E6EEF7" },
  AUDUSD: { label: "A$", background: "#3A4F6B", foreground: "#E6EEF7" },
  NZDUSD: { label: "NZ$", background: "#3A4F6B", foreground: "#E6EEF7" },
  USDHKD: { label: "HK$", background: "#3A4F6B", foreground: "#E6EEF7" },
  USDKRW: { label: "₩", background: "#3A4F6B", foreground: "#E6EEF7" },
  BRENTOIL: { label: "Oil", background: "#2B2B2B", foreground: "#F2F2F2" },
  WHEAT: { label: "Wh", background: "#C9A24A", foreground: "#1B1405" },
  XCU: { label: "Cu", background: "#B06B3A", foreground: "#150C06" },
  XPT: { label: "Pt", background: "#8E8E9A", foreground: "#111114" },
  XPD: { label: "Pd", background: "#6E6E7A", foreground: "#F2F2F5" },
  US10Y: { label: "10Y", background: "#2F72B8", foreground: "#F2F7FC" },
  ANTHROPIC: { label: "An", background: "#4A5560", foreground: "#EFF2F5" },
  OPENAI: { label: "OA", background: "#4A5560", foreground: "#EFF2F5" },
  BYD: { label: "BYD", background: "#4A5560", foreground: "#EFF2F5" },
  H100: { label: "H1", background: "#4A5560", foreground: "#EFF2F5" },
  HYUNDAIUSD: { label: "Hy", background: "#4A5560", foreground: "#EFF2F5" },
  KIOXIA: { label: "Ki", background: "#4A5560", foreground: "#EFF2F5" },
  MINIMAX: { label: "MM", background: "#4A5560", foreground: "#EFF2F5" },
  POPMART: { label: "PM", background: "#4A5560", foreground: "#EFF2F5" },
  SAMSUNGUSD: { label: "SS", background: "#1428A0", foreground: "#EEF1FC" },
  SHEIN: { label: "Sh", background: "#4A5560", foreground: "#EFF2F5" },
  SKHYNIXUSD: { label: "SK", background: "#4A5560", foreground: "#EFF2F5" },
  SMIC: { label: "SM", background: "#4A5560", foreground: "#EFF2F5" },
  STABLECOINX: { label: "SX", background: "#4A5560", foreground: "#EFF2F5" },
  TENCENT: { label: "Tc", background: "#4A5560", foreground: "#EFF2F5" },
  UNITREE: { label: "Ut", background: "#4A5560", foreground: "#EFF2F5" },
  XIAOMI: { label: "Mi", background: "#4A5560", foreground: "#EFF2F5" },
  ZHIPU: { label: "Zh", background: "#4A5560", foreground: "#EFF2F5" },
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
