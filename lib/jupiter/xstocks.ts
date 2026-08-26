import { tokenIdentityByMint, tokenLogoBySymbol } from "@/lib/tokens/logos";

// Asset class, used to group the Markets catalog. The catalog is small enough
// that one flat table works, but a user shopping for index exposure should not
// have to scan past eight single-name equities to find it.
export type XStockCategory = "stocks" | "indices" | "metals";

export interface XStock {
  symbol: string;
  name: string;
  mint: string;
  decimals: 8;
  // Coingecko coin id for chart and price data. Verified against
  // https://api.coingecko.com/api/v3/coins/list with platforms.solana = mint.
  coingeckoId: string;
  category: XStockCategory;
  // Public path to the company logo (under /public). Optional: assets without
  // a logo fall back to a symbol monogram in the UI.
  logo?: string;
}

// Verified against Jupiter's token API on 2026-05-19. All entries have the
// `verified` and `xstocks` tags and use the Token-2022 program
// (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb), which discriminates the real
// Backed Finance issuance from the many pump.fun impostor mints sharing these
// symbols. Do not let users supply arbitrary mints in v1.
export const XSTOCKS: readonly XStock[] = [
  {
    symbol: "AAPLx",
    name: "Apple",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    decimals: 8,
    coingeckoId: "apple-xstock",
    category: "stocks",
    logo: "/logos/apple.png",
  },
  {
    symbol: "TSLAx",
    name: "Tesla",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
    coingeckoId: "tesla-xstock",
    category: "stocks",
    logo: "/logos/tesla.png",
  },
  {
    symbol: "NVDAx",
    name: "NVIDIA",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
    coingeckoId: "nvidia-xstock",
    category: "stocks",
    logo: "/logos/nvidia-eye.png",
  },
  {
    symbol: "METAx",
    name: "Meta",
    mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    decimals: 8,
    coingeckoId: "meta-xstock",
    category: "stocks",
    logo: "/logos/meta.png",
  },
  {
    symbol: "GOOGLx",
    name: "Alphabet",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    decimals: 8,
    coingeckoId: "alphabet-xstock",
    category: "stocks",
    logo: "/logos/google.png",
  },
  {
    symbol: "COINx",
    name: "Coinbase",
    mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    decimals: 8,
    coingeckoId: "coinbase-xstock",
    category: "stocks",
    logo: "/logos/coinbase.png",
  },
  {
    symbol: "CRCLx",
    name: "Circle",
    mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    decimals: 8,
    coingeckoId: "circle-xstock",
    category: "stocks",
    logo: "/logos/circle.png",
  },
  {
    symbol: "MSTRx",
    name: "MicroStrategy",
    mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    decimals: 8,
    coingeckoId: "microstrategy-xstock",
    category: "stocks",
    logo: "/logos/strategy.png",
  },
  {
    symbol: "SPYx",
    name: "S&P 500",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
    coingeckoId: "sp500-xstock",
    category: "indices",
    logo: "/logos/spy.png",
  },
  {
    symbol: "QQQx",
    name: "Nasdaq 100",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    decimals: 8,
    coingeckoId: "nasdaq-xstock",
    category: "indices",
    logo: "/logos/qqq.png",
  },
  {
    symbol: "SPCXx",
    name: "SpaceX",
    mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
    decimals: 8,
    // Plural, unlike every other entry here. Verified by looking the mint up on
    // CoinGecko's Solana contract endpoint rather than following the pattern:
    // "spacex-xstock" is a 404, so the obvious guess would have left the chart
    // and price silently empty.
    coingeckoId: "spacex-xstocks",
    category: "stocks",
    logo: "/logos/spacex.png",
  },
  // Backed also issues SLVx (silver) and TBLLx (T-bills), but both quote under
  // $10 of Jupiter liquidity, so a buy would move the price against the user.
  // Gold is the only non-equity xStock with a route worth listing.
  {
    symbol: "GLDx",
    name: "Gold",
    mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    decimals: 8,
    coingeckoId: "gold-xstock",
    category: "metals",
    logo: "/logos/gld.png",
  },
] as const;

// Display order for the grouped catalog, and the labels the filter pills use.
// Groups with no assets are skipped by the UI rather than rendered empty.
export const XSTOCK_CATEGORIES: readonly {
  id: XStockCategory;
  label: string;
}[] = [
  { id: "stocks", label: "Stocks" },
  { id: "indices", label: "Index funds" },
  { id: "metals", label: "Metals" },
] as const;

export function xstockByMint(mint: string): XStock | undefined {
  return XSTOCKS.find((x) => x.mint === mint);
}

export function xstockBySymbol(symbol: string): XStock | undefined {
  return XSTOCKS.find((x) => x.symbol === symbol);
}

// What <AssetLogo /> needs for a mint that may not be in the curated catalog.
// Resolved in order: the curated xStock catalog, then the stablecoin and SOL
// registry in lib/tokens/logos.ts, then a symbol monogram.
//
// The second step is what the Earn tab needs. Every asset it lists is a
// stablecoin or SOL, so before that registry existed every row there fell
// through to a monogram. Kamino also lists a few xStocks we do not trade yet,
// so a borrow row can still reference a mint with no entry anywhere; that is
// the case the monogram is for.
export function assetIdentity(
  mint: string,
  symbol: string,
): Pick<XStock, "symbol" | "name" | "logo"> {
  const xstock = xstockByMint(mint);
  if (xstock) return xstock;
  const token = tokenIdentityByMint(mint);
  if (token) return token;
  return { symbol, name: symbol, logo: tokenLogoBySymbol(symbol) };
}
