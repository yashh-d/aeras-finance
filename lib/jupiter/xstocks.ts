import { tokenIdentityByMint, tokenLogoBySymbol } from "@/lib/tokens/logos";

// Asset class, used to group the Markets catalog. The catalog is small enough
// that one flat table works, but a user shopping for index exposure should not
// have to scan past eight single-name equities to find it.
export type XStockCategory = "stocks" | "indices" | "metals";

export interface XStock {
  symbol: string;
  name: string;
  mint: string;
  // Was the literal `8` while every entry was a Backed xStock. The gold tokens
  // are 6, so it is a number now. Nothing hardcodes 8: every consumer reads
  // this field, which is why widening it was a one-line change.
  decimals: number;
  // Which SPL token program the mint lives under, and it cannot be inferred.
  //
  // Backed issues every xStock under Token-2022, and the whole app assumed that
  // held for anything in this list. It does not: PAXG is Token-2022 and XAUt0
  // is classic SPL, two gold tokens on the same shelf under different programs.
  // The associated token account address is derived FROM the program, so a
  // wrong guess derives an account that does not exist and the balance reads as
  // zero: not an error, just silently missing money. lib/solana/balances.ts
  // already learned this from Ondo's Solana mints and coped by deriving both;
  // carrying the fact here means the send path can stop guessing too.
  //
  // Verified on-chain by reading each mint's owner program, not from a listing.
  tokenProgram: "token-2022" | "token";
  // Coingecko coin id for chart and price data. Verified against
  // https://api.coingecko.com/api/v3/coins/list with platforms.solana = mint.
  coingeckoId: string;
  category: XStockCategory;
  // Public path to the company logo (under /public). Optional: assets without
  // a logo fall back to a symbol monogram in the UI.
  logo?: string;
}

// The curated catalog: everything the app will sell. Do not let users supply
// arbitrary mints.
//
// This list spans TWO issuer classes now, and the difference matters when
// adding to it. The name is kept because it is load-bearing across the repo,
// but "xStock" is no longer true of every row.
//
// **Backed Finance xStocks** (every row except the two gold tokens). Verified
// against Jupiter's token API on 2026-05-19: all carry the `verified` and
// `xstocks` tags and use the Token-2022 program
// (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb), which is what discriminates
// the real issuance from the many pump.fun impostor mints sharing these
// symbols. All are 8 decimals.
//
// **Gold** (PAXG, XAUt0), added 2026-08-27. These are not tokenized equities
// and not Backed issuance, so the `xstocks` tag test does not apply. Each was
// verified separately, and every assumption the equity rows share turned out to
// be false for at least one of them:
//
//   - Jupiter `verified` + `rwa` tags, no launchpad, real holder counts. This
//     is the impostor test that does still apply.
//   - Both are 6 decimals, not 8.
//   - PAXG is Token-2022; XAUt0 is classic SPL. They disagree with each other,
//     which is why `tokenProgram` is now carried per entry rather than assumed.
//   - Liquidity measured on Jupiter Ultra 2026-08-27: both quote under 0.003%
//     price impact at $25,000, which is better than several equity rows and far
//     better than SLVx and TBLLx, excluded below for having almost none.
export const XSTOCKS: readonly XStock[] = [
  {
    symbol: "AAPLx",
    name: "Apple",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "apple-xstock",
    category: "stocks",
    logo: "/logos/apple.png",
  },
  {
    symbol: "TSLAx",
    name: "Tesla",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "tesla-xstock",
    category: "stocks",
    logo: "/logos/tesla.png",
  },
  {
    symbol: "NVDAx",
    name: "NVIDIA",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "nvidia-xstock",
    category: "stocks",
    logo: "/logos/nvidia-eye.png",
  },
  {
    symbol: "MSFTx",
    name: "Microsoft",
    mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "microsoft-xstock",
    category: "stocks",
    logo: "/logos/microsoft.png",
  },
  {
    symbol: "AMZNx",
    name: "Amazon",
    mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "amazon-xstock",
    category: "stocks",
    logo: "/logos/amazon.png",
  },
  {
    symbol: "METAx",
    name: "Meta",
    mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "meta-xstock",
    category: "stocks",
    logo: "/logos/meta.png",
  },
  {
    symbol: "GOOGLx",
    name: "Alphabet",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "alphabet-xstock",
    category: "stocks",
    logo: "/logos/google.png",
  },
  {
    symbol: "COINx",
    name: "Coinbase",
    mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "coinbase-xstock",
    category: "stocks",
    logo: "/logos/coinbase.png",
  },
  {
    symbol: "CRCLx",
    name: "Circle",
    mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "circle-xstock",
    category: "stocks",
    logo: "/logos/circle.png",
  },
  {
    symbol: "MSTRx",
    name: "MicroStrategy",
    mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "microstrategy-xstock",
    category: "stocks",
    logo: "/logos/strategy.png",
  },
  {
    symbol: "SPYx",
    name: "S&P 500",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "sp500-xstock",
    category: "indices",
    logo: "/logos/spy.png",
  },
  {
    symbol: "QQQx",
    name: "Nasdaq 100",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "nasdaq-xstock",
    category: "indices",
    logo: "/logos/qqq.png",
  },
  {
    symbol: "SPCXx",
    name: "SpaceX",
    mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
    decimals: 8,
    tokenProgram: "token-2022",
    // Plural, unlike every other entry here. Verified by looking the mint up on
    // CoinGecko's Solana contract endpoint rather than following the pattern:
    // "spacex-xstock" is a 404, so the obvious guess would have left the chart
    // and price silently empty.
    coingeckoId: "spacex-xstocks",
    category: "stocks",
    logo: "/logos/spacex.png",
  },
  // Added below the originals rather than interleaved: registry order is what
  // Home shows first, and these are thinner markets than the names above them.
  // All four cleared the same bar as the rest, a live Jupiter route with real
  // depth, checked against lite-api.jup.ag/tokens/v2/search. Three reuse the
  // mark the perps market list already ships; McDonald's has none on disk yet
  // and renders as a symbol monogram until one is added.
  {
    symbol: "HOODx",
    name: "Robinhood",
    mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "robinhood-xstock",
    category: "stocks",
    logo: "/logos/markets/HOOD.png",
  },
  {
    symbol: "PLTRx",
    name: "Palantir",
    mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "palantir-xstock",
    category: "stocks",
    logo: "/logos/markets/PLTR.png",
  },
  {
    symbol: "MCDx",
    name: "McDonald's",
    mint: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2",
    decimals: 8,
    tokenProgram: "token-2022",
    // Coingecko slugifies the apostrophe to a separate segment, so this is
    // "mcdonald-s-xstock" and not "mcdonalds-xstock".
    coingeckoId: "mcdonald-s-xstock",
    category: "stocks",
  },
  {
    symbol: "AVGOx",
    name: "Broadcom",
    mint: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "broadcom-xstock",
    category: "stocks",
    logo: "/logos/markets/AVGO.png",
  },
  // Backed also issues SLVx (silver) and TBLLx (T-bills), but both quote under
  // $10 of Jupiter liquidity, so a buy would move the price against the user.
  // Gold is the only non-equity xStock with a route worth listing.
  {
    // Was plain "Gold" while it was the only metal. With bullion beside it that
    // is ambiguous in the wrong direction: this is a claim on ETF shares at
    // ~$425, the other two are troy ounces at ~$4,620, and a row called "Gold"
    // next to "Gold (Tether)" invites reading the price difference as a bargain.
    symbol: "GLDx",
    name: "Gold ETF (SPDR)",
    mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    decimals: 8,
    tokenProgram: "token-2022",
    coingeckoId: "gold-xstock",
    category: "metals",
    logo: "/logos/gld.png",
  },

  // ── Gold bullion ─────────────────────────────────────────────────────────
  //
  // Not Backed issuance and not equities. GLDx above tracks the SPDR Gold
  // Shares ETF, so one unit is about 0.09 oz and trades near $425; these two
  // are claims on allocated bullion, so one unit is one troy ounce and trades
  // near $4,620. Same metal, an order of magnitude apart per token, which is
  // why `name` says so rather than leaving three rows called "Gold".
  {
    symbol: "PAXG",
    name: "Gold (Paxos)",
    mint: "5GgRAEmv8ZxF2PR5hY72Qs5x1bnQ6UK2RbTPoqJ3wSwW",
    decimals: 6,
    tokenProgram: "token-2022",
    // The one entry whose id is NOT resolved through
    // /coins/solana/contract/<mint>: that endpoint answers "coin not found"
    // for this mint, because CoinGecko indexes PAX Gold as a single asset and
    // has not listed its Solana representation as a platform.
    //
    // `pax-gold` is still the correct series rather than a near-enough one.
    // PAXG is Paxos issuance redeemable for the same allocated bullion on
    // every chain it exists on, and Jupiter prices this mint within 0.2% of
    // the Ethereum token. The platform check exists to catch a WRONG coin (the
    // SPCXx case above, where the obvious guess was a 404 and would have left
    // the chart silently empty), and identity is the thing it is really
    // testing. Verified by hand instead: `pax-gold` returns a live series that
    // tracks spot gold.
    coingeckoId: "pax-gold",
    category: "metals",
    logo: "/logos/paxg.png",
  },
  {
    symbol: "XAUt0",
    name: "Gold (Tether)",
    mint: "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P",
    decimals: 6,
    // Classic SPL, unlike every other row in this file. See `tokenProgram`.
    tokenProgram: "token",
    // Resolved the normal way: /coins/solana/contract/<mint> returns
    // `tether-gold-tokens` with platforms.solana matching this mint exactly.
    // Note it is NOT `tether-gold`, which is the Ethereum XAUt.
    coingeckoId: "tether-gold-tokens",
    category: "metals",
    // Tether Gold's own mark, shared with the Ethereum XAUt that the Morpho
    // gold market takes as collateral. Same issuer and same bullion claim, so
    // the file is named for the brand rather than for either mint.
    logo: "/logos/xaut.png",
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
