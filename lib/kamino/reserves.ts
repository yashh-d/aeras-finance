import { USDC_MINT } from "@/lib/jupiter/constants";

// Kamino's isolated "xStocks Market". The main Kamino lending market carries no
// xStock reserves; this dedicated market is where TSLAx/SPYx/etc. can be posted
// as collateral to borrow USDC. Verified against the live Kamino API on
// 2026-07-29 (https://api.kamino.finance/kamino-market/{market}/reserves/metrics).
export const KAMINO_XSTOCKS_MARKET =
  "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";

// Address lookup table Kamino publishes for this market. KTX already returns a
// compiled transaction, so we do not need this for tx-building, but it is worth
// recording alongside the market for any future SDK-side assembly.
export const KAMINO_XSTOCKS_MARKET_LUT =
  "8ofreL6hKfEet1DnhHVGvCTnSdz4pg85PpbuCUHnEcKm";

const XSTOCK_DECIMALS = 8; // xStocks are 8-decimal Token-2022 mints.
const USDC_DECIMALS = 6;

// The single borrow asset for v1: USDC. Users post an xStock as collateral and
// draw USDC against it.
export const KAMINO_USDC_BORROW = {
  symbol: "USDC" as const,
  mint: USDC_MINT,
  reserve: "97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E",
  decimals: USDC_DECIMALS,
};

export interface KaminoCollateralReserve {
  symbol: string;
  collateralMint: string;
  // Kamino reserve account for this collateral in the xStocks Market.
  reserve: string;
  decimals: number;
  // Max borrow LTV (collateral factor) as a decimal (0.55 = 55%). Snapshotted
  // from the live reserve metrics on 2026-07-29 for display fallback. The UI
  // should refresh this from /reserves/metrics rather than trust it for math.
  maxLtvSnapshot: number;
  // Liquidation threshold as a whole percent (65 = 65%). Read directly from the
  // on-chain Reserve config (loanToValuePct is immediately followed by
  // liquidationThresholdPct) on 2026-07-29. Used to draw the safety-floor line
  // before a position exists; a live position uses the obligation's own value.
  liquidationThreshold: number;
}

// Every xStock reserve in the market that can be used as collateral, verified to
// exist on mainnet. cbBTC / USDC / USDG also live in this market but are not
// xStocks; USDG additionally has maxLtv 0 (not usable as collateral).
export const KAMINO_XSTOCK_COLLATERALS: readonly KaminoCollateralReserve[] = [
  {
    symbol: "TSLAx",
    collateralMint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    reserve: "5iTiczqgUegqA3PpoNpotizMbY9n1sRWr3oL6igKvWuf",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.55,
    liquidationThreshold: 65,
  },
  {
    symbol: "SPYx",
    collateralMint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    reserve: "UvXjBuC7YZYaGB9Rn1PpBD1GySmjzunXgE8Zev9ua8d",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.73,
    liquidationThreshold: 75,
  },
  {
    symbol: "QQQx",
    collateralMint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    reserve: "2jerdAXR8r2B6z3P7P6VgSiePQX7wqcpbEqdDbm8mgeB",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.7,
    liquidationThreshold: 72,
  },
  {
    symbol: "NVDAx",
    collateralMint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    reserve: "7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.55,
    liquidationThreshold: 65,
  },
  {
    symbol: "GOOGLx",
    collateralMint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    reserve: "4wg6rEkGgHaEuxMduP46C1xFZ24Lnp5YgdNkZAHxFzsN",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.6,
    liquidationThreshold: 70,
  },
  {
    symbol: "AAPLx",
    collateralMint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    reserve: "CKJbqakbPGyhziowm19LPYz636UszuezfkitmpRtcLSH",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.4,
    liquidationThreshold: 50,
  },
  {
    symbol: "METAx",
    collateralMint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    reserve: "AJPrye7NZGex2rUZhRwiAPJYxai1Ptb7DNWR3yYjtk3G",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.35,
    liquidationThreshold: 45,
  },
  {
    symbol: "MSTRx",
    collateralMint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    reserve: "Cwy2WJoswCMyfPtWTrmiaDLXC3phz3qwr1TaT4kaSAyD",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.3,
    liquidationThreshold: 40,
  },
  {
    symbol: "HOODx",
    collateralMint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    reserve: "4UBJu5Xp1aziV9frBQBhc1RnKrgXHAWHYejQytkYr8gq",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.3,
    liquidationThreshold: 40,
  },
  {
    symbol: "CRCLx",
    collateralMint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    reserve: "57qagnQFuWw1seEqi6Z5JBvkm5xH5svdmq9dtqxG1rYy",
    decimals: XSTOCK_DECIMALS,
    maxLtvSnapshot: 0.3,
    liquidationThreshold: 40,
  },
] as const;

export function kaminoCollateralByMint(
  collateralMint: string,
): KaminoCollateralReserve | undefined {
  return KAMINO_XSTOCK_COLLATERALS.find(
    (r) => r.collateralMint === collateralMint,
  );
}

export function kaminoCollateralBySymbol(
  symbol: string,
): KaminoCollateralReserve | undefined {
  return KAMINO_XSTOCK_COLLATERALS.find((r) => r.symbol === symbol);
}

// Reserve addresses the KTX proxy is allowed to build transactions for. Guards
// against a caller passing an arbitrary reserve, mirroring the "no arbitrary
// mints" rule for Jupiter.
export const KAMINO_ALLOWED_RESERVES: ReadonlySet<string> = new Set<string>([
  KAMINO_USDC_BORROW.reserve,
  ...KAMINO_XSTOCK_COLLATERALS.map((r) => r.reserve),
]);
