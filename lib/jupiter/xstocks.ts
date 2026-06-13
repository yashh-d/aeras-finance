export interface XStock {
  symbol: string;
  name: string;
  mint: string;
  decimals: 8;
  // Coingecko coin id for chart and price data. Verified against
  // https://api.coingecko.com/api/v3/coins/list with platforms.solana = mint.
  coingeckoId: string;
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
  },
  {
    symbol: "TSLAx",
    name: "Tesla",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
    coingeckoId: "tesla-xstock",
  },
  {
    symbol: "NVDAx",
    name: "NVIDIA",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
    coingeckoId: "nvidia-xstock",
  },
  {
    symbol: "METAx",
    name: "Meta",
    mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    decimals: 8,
    coingeckoId: "meta-xstock",
  },
  {
    symbol: "GOOGLx",
    name: "Alphabet",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    decimals: 8,
    coingeckoId: "alphabet-xstock",
  },
  {
    symbol: "COINx",
    name: "Coinbase",
    mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    decimals: 8,
    coingeckoId: "coinbase-xstock",
  },
  {
    symbol: "CRCLx",
    name: "Circle",
    mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    decimals: 8,
    coingeckoId: "circle-xstock",
  },
  {
    symbol: "MSTRx",
    name: "MicroStrategy",
    mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    decimals: 8,
    coingeckoId: "microstrategy-xstock",
  },
  {
    symbol: "SPYx",
    name: "S&P 500",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
    coingeckoId: "sp500-xstock",
  },
  {
    symbol: "QQQx",
    name: "Nasdaq 100",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    decimals: 8,
    coingeckoId: "nasdaq-xstock",
  },
] as const;

export function xstockByMint(mint: string): XStock | undefined {
  return XSTOCKS.find((x) => x.mint === mint);
}

export function xstockBySymbol(symbol: string): XStock | undefined {
  return XSTOCKS.find((x) => x.symbol === symbol);
}
