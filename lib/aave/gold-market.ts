// Aave V4 on Ethereum: borrow USDC against tokenized gold in the Gold spoke.
//
// This is the second gold-collateral venue beside the Morpho Blue market in
// lib/morpho/gold-market.ts, and the two share more than they differ: the same
// collateral token on the same chain, the same embedded wallet, the same
// Trustware funding path. What differs is the protocol, and the differences
// are the whole reason to list both. Read docs/aave-gold.md before touching
// this; the short version:
//
//   1. **It is a Spoke, not Aave V3 and not a Morpho market.** V4 is hub and
//      spoke: the Core hub holds liquidity and runs one rate per asset, and a
//      spoke is a market that draws on it under its own risk parameters. Users
//      only ever call the Spoke. Reserves are numbered per spoke, so "reserve
//      0" means XAUt inside this spoke only.
//
//   2. **Collateral earns nothing here either.** The XAUt reserve is not
//      borrowable and the hub's rate for it is zero. Supplied gold buys
//      borrowing power and nothing else, exactly as on Morpho.
//
//   3. **The approval spender is the Spoke, not the hub.** The Spoke pulls the
//      tokens itself, and a hub approval fails after the user has signed.
//
//   4. **Nothing risk-related is a constant.** The Spoke is an upgradeable
//      proxy and the collateral factor, caps and bonus are governance data
//      that can change under a position. Everything below that is not an
//      address or an id is read live, and scripts/aave-gold-check.mts pins
//      the implementation and revision so an upgrade is visible.

import {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_EXPLORER_TX_BASE,
  ETHEREUM_NATIVE_TOKEN,
  ETHEREUM_RPC_URL,
  XAUT,
} from "@/lib/morpho/gold-market";

export {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_EXPLORER_TX_BASE,
  ETHEREUM_NATIVE_TOKEN,
  ETHEREUM_RPC_URL,
  XAUT,
};

// ── fixed-point units ──────────────────────────────────────────────────────

export const WAD = 10n ** 18n;
export const RAY = 10n ** 27n;
export const BPS = 10_000n;

// Prices from the Spoke's oracle carry this many decimals, and the Spoke's
// "Value" unit is a price times an 18-decimal amount, so one USD of Value is
// 10^(8 + 18). Getting this wrong misreads a position by twenty-six orders of
// magnitude; scripts/aave-gold-check.mts asserts it against Aave's indexer.
export const ORACLE_DECIMALS = 8;
export const VALUE_PER_USD = 10n ** BigInt(ORACLE_DECIMALS + 18);

// The hard-coded liquidation dust rule, in USD: a liquidation may not leave
// less than this much collateral or debt behind, so a position under it is
// liquidated in full rather than trimmed back to the target health factor.
export const DUST_LIQUIDATION_USD = 1_000;

// ── tokens ─────────────────────────────────────────────────────────────────

// USD Coin on Ethereum, the debt asset. Compliant ERC-20 with EIP-2612 permit,
// which is one of the reasons it is the first debt asset and USDT is not
// (docs/aave-gold.md, "The gasless path").
export const USDC = {
  symbol: "USDC" as const,
  name: "USD Coin",
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  decimals: 6,
} as const;

// ── the spoke ──────────────────────────────────────────────────────────────

// The Gold spoke and the Core hub it draws on. Both are transparent proxies;
// the implementation addresses are pinned here for the check script only and
// are never called directly.
export const AAVE_GOLD_SPOKE = "0x65407b940966954b23dfA3caA5C0702bB42984DC";
export const AAVE_GOLD_SPOKE_IMPL = "0x70ed94a65df287dc54184963d7a9edc83dd34223";
export const AAVE_GOLD_SPOKE_REVISION = 1n;
export const AAVE_CORE_HUB = "0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9";
export const AAVE_CORE_HUB_IMPL = "0xfe89fd96f270ac3c0f11921af0390dbb1340f704";

// The spoke's oracle (immutable on the spoke) and the Chainlink XAU/USD feed
// it prices XAUt from. Both verified live 2026-09-09.
export const AAVE_GOLD_ORACLE = "0x0083421fd178749af2201ddA5A7C3feB5790B80c";
export const CHAINLINK_XAU_USD = "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6";

// Aave's own signature gateway on Ethereum, active on this spoke. Not used by
// the direct path this module implements; recorded because it is the phase-2
// gasless route (docs/aave-gold.md) and the check script confirms it stays
// active.
export const AAVE_SIGNATURE_GATEWAY = "0xfbC184337Dc6595D8bf62968Bda46e7De7AF9c3d";

// Aave V4's indexer, used only by the check script to cross-check on-chain
// reads. Its ids are base64 of `1::<spoke>` and `1::<spoke>::<reserveId>`.
export const AAVE_V4_GRAPHQL = "https://api.v4.aave.com/graphql";

export interface AaveReserveRef {
  // Reserve id inside the spoke. Spoke-local; means nothing on another spoke.
  reserveId: bigint;
  // The asset's id on the hub. Hub-level and stable for the asset's lifetime.
  assetId: bigint;
}

export interface AaveGoldMarket {
  // Stable key for routes, caches and position rows.
  id: string;
  // Display name.
  name: string;
  chainId: number;
  spoke: string;
  hub: string;
  collateralToken: typeof XAUT;
  collateral: AaveReserveRef;
  debtToken: typeof USDC;
  debt: AaveReserveRef;
}

// The one market offered: XAUt collateral, USDC debt, both in the Gold spoke.
//
// USDC over USDT, measured 2026-09-09: 3.83% against 4.23%, it is what the rest
// of the app speaks, and it supports permit. USDT has five times the spoke
// headroom ($1.23M against $230k) and is the second debt asset when USDC's cap
// binds. Both return legs to Solana USDC quoted at about 0.27%.
export const XAUT_USDC_MARKET: AaveGoldMarket = {
  id: "aave-gold-xaut-usdc",
  name: "XAUt / USDC",
  chainId: ETHEREUM_CHAIN_ID,
  spoke: AAVE_GOLD_SPOKE,
  hub: AAVE_CORE_HUB,
  collateralToken: XAUT,
  collateral: { reserveId: 0n, assetId: 14n },
  debtToken: USDC,
  debt: { reserveId: 1n, assetId: 5n },
};

export const AAVE_GOLD_MARKETS: readonly AaveGoldMarket[] = [XAUT_USDC_MARKET];

export function aaveGoldMarketById(id: string): AaveGoldMarket | undefined {
  return AAVE_GOLD_MARKETS.find((m) => m.id === id);
}
