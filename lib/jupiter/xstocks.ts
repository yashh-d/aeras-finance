export interface XStock {
  symbol: string;
  name: string;
  mint: string;
  decimals: 8;
  // Coingecko coin id for chart and price data. Verified against
  // https://api.coingecko.com/api/v3/coins/list with platforms.solana = mint.
  coingeckoId: string;
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
    logo: "/logos/apple.svg",
  },
  {
    symbol: "TSLAx",
    name: "Tesla",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
    coingeckoId: "tesla-xstock",
    logo: "/logos/tesla.svg",
  },
  {
    symbol: "NVDAx",
    name: "NVIDIA",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
    coingeckoId: "nvidia-xstock",
    logo: "/logos/nvidia-eye.svg",
  },
  {
    symbol: "METAx",
    name: "Meta",
    mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    decimals: 8,
    coingeckoId: "meta-xstock",
    logo: "/logos/meta.svg",
  },
  {
    symbol: "GOOGLx",
    name: "Alphabet",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    decimals: 8,
    coingeckoId: "alphabet-xstock",
    logo: "/logos/google.svg",
  },
  {
    symbol: "COINx",
    name: "Coinbase",
    mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    decimals: 8,
    coingeckoId: "coinbase-xstock",
    logo: "/logos/coinbase.png",
  },
  {
    symbol: "CRCLx",
    name: "Circle",
    mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    decimals: 8,
    coingeckoId: "circle-xstock",
    logo: "/logos/circle.svg",
  },
  {
    symbol: "MSTRx",
    name: "MicroStrategy",
    mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    decimals: 8,
    coingeckoId: "microstrategy-xstock",
    logo: "/logos/strategy.png",
  },
  {
    symbol: "SPYx",
    name: "S&P 500",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
    coingeckoId: "sp500-xstock",
    logo: "/logos/spy.png",
  },
  {
    symbol: "QQQx",
    name: "Nasdaq 100",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    decimals: 8,
    coingeckoId: "nasdaq-xstock",
    logo: "/logos/qqq.png",
  },
] as const;

export function xstockByMint(mint: string): XStock | undefined {
  return XSTOCKS.find((x) => x.mint === mint);
}

export function xstockBySymbol(symbol: string): XStock | undefined {
  return XSTOCKS.find((x) => x.symbol === symbol);
}

// What <AssetLogo /> needs for a mint that may not be in the curated catalog.
// Kamino lists a few xStocks we do not trade yet, so a borrow row can reference
// a mint with no catalog entry. Those fall back to a symbol monogram.
export function assetIdentity(
  mint: string,
  symbol: string,
): Pick<XStock, "symbol" | "name" | "logo"> {
  return xstockByMint(mint) ?? { symbol, name: symbol };
}
