// The curated pools: twelve Uniswap v3 and v4 pools across four chains, and
// the tokens they hold. See docs/uniswap-lp-plan.md D2 for what is in, what
// is out, and why.
//
// Every figure here was read from the chain on 2026-09-22 (`fee()` and
// `tickSpacing()` on the v3 pools, `PositionManager.poolKeys` on the v4
// pools) and scripts/uniswap-check.mts re-reads all of it: a mismatch there
// means the chain moved, not that this file is authoritative. Two things the
// explorer got wrong that the chain settled: the SPY/USDG and META/USDG v4
// pools charge 3000 pips (0.30%), not the 0.3499% app.uniswap.org shows, and
// the two MON pairs against WETH and WBTC use tick spacing 1.
//
// Excluded, and recorded so nobody re-adds them by accident:
//   Robinhood AI/NVDA (v4, 0.7%, hook 0x4e34...), ETH/STANDARD (v4, 1%, hook
//   0xF1eE...), WETH/STATICS (v4, 1.5%, hook 0x4e34...): third-party hooks the
//   LP API calls the caller's responsibility, and the non-stable side is a
//   memecoin, not stock exposure.
//   Monad WBTC/USDC (v4, $45k TVL) and AUSD/XAUt0 (v4, $23k TVL): dust.

import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/base/constants";
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC } from "@/lib/ethereum/constants";
import { MONAD_CHAIN_ID, MONAD_NATIVE_TOKEN, MONAD_USDC } from "@/lib/morpho/constants";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NATIVE_TOKEN,
  ROBINHOOD_USDG,
  ROBINHOOD_WETH,
} from "@/lib/robinhood/constants";

import type { UniswapChainId, UniswapProtocol } from "./constants";

export type { UniswapChainId, UniswapProtocol };

// How the funding planner obtains a token on its chain from Solana USDC.
//   bridge  a Trustware leg from Solana USDC delivers it directly.
//   swap    no bridge delivers it; the chain's dollar token is delivered and
//           part of it is swapped on-chain through Trustware's same-chain
//           route (the tokenized stocks, which every provider declines
//           cross-chain; verified 2026-09-21).
//   none    nothing the app signs can obtain it (GLD on Robinhood Chain:
//           every provider declines it cross-chain from Solana and same-chain
//           from USDG or WETH, verified 2026-09-22; only a Monad USDC source
//           quotes, through a provider the app does not run). The pool is
//           listed for its figures, its positions and the way home, and a
//           deposit into it is refused with the reason. Re-test with
//           scripts/uniswap-check.mts before flipping it.
export type TokenSource = "bridge" | "swap" | "none";

export interface PoolToken {
  symbol: string;
  name: string;
  // Checksummed as the chain reports it. Compare lowercased.
  address: string;
  decimals: number;
  // True for the chain's native asset held as currency0 of a v4 pool (MON on
  // Monad). The address is then the zero address, which is also what
  // Trustware wants for it as a route destination on that chain.
  native?: boolean;
  // True for the dollar token of a chain: prices as $1, sizes deposits.
  stable?: boolean;
  source: TokenSource;
  logo?: string;
}

export type PoolGroup = "stocks" | "monad" | "ethereum" | "base";

export interface UniswapPool {
  // v3: the pool contract address. v4: the 32-byte pool id. Both as the chain
  // spells them; lookups lowercase.
  id: string;
  chainId: UniswapChainId;
  protocol: UniswapProtocol;
  // LP fee in pips (hundredths of a basis point): 500 is 0.05%.
  fee: number;
  tickSpacing: number;
  // Zero for every listed pool; a v4 key needs it to recompute the id.
  hooks: string;
  token0: PoolToken;
  token1: PoolToken;
  // Which side is the dollar token, or null for a pool with none (MON/WETH,
  // MON/WBTC). The card prices the other side off the pool when this is set.
  quoteSide: 0 | 1 | null;
  group: PoolGroup;
  label: string;
  explorerUrl: string;
  // Overrides BAND_BPS for this pool. Unset everywhere today (D3).
  bandBps?: number;
}

export interface UniswapChain {
  chainId: UniswapChainId;
  label: string;
  group: PoolGroup;
  // The chain's dollar token: what a deposit is delivered as before any
  // on-chain swap, and what a Move to Solana leg sells.
  dollar: PoolToken;
  // The gas token, for balance reads and the funding planner's floor.
  nativeSymbol: string;
  explorerTxBase: string;
  // The slug app.uniswap.org uses for the chain in pool URLs.
  uniswapSlug: string;
  logo: string;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── tokens ────────────────────────────────────────────────────────────────

const USDG: PoolToken = { ...ROBINHOOD_USDG, stable: true, source: "bridge", logo: "/logos/usdg.png" };
const RH_NVDA: PoolToken = { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18, source: "swap", logo: "/logos/nvidia-eye.png" };
const RH_SPY: PoolToken = { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", decimals: 18, source: "swap", logo: "/logos/spy.png" };
const RH_META: PoolToken = { symbol: "META", name: "Meta Platforms", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", decimals: 18, source: "swap", logo: "/logos/meta.png" };
const RH_SPCX: PoolToken = { symbol: "SPCX", name: "SpaceX", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", decimals: 18, source: "swap", logo: "/logos/spacex.png" };
const RH_GLD: PoolToken = { symbol: "GLD", name: "SPDR Gold Shares", address: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", decimals: 18, source: "none", logo: "/logos/gld.png" };
// Not in a listed pool; here because the wallet can hold it (the gas leg
// fallback) and the planner must be able to name it.
export const RH_WETH: PoolToken = { ...ROBINHOOD_WETH, source: "bridge", logo: "/logos/eth.png" };

const MONAD_USDC_TOKEN: PoolToken = { ...MONAD_USDC, name: "USD Coin", stable: true, source: "bridge", logo: "/logos/usdc.png" };
const MON: PoolToken = { symbol: "MON", name: "Monad", address: MONAD_NATIVE_TOKEN, decimals: 18, native: true, source: "bridge", logo: "/logos/monad.png" };
const MONAD_WETH: PoolToken = { symbol: "WETH", name: "Wrapped Ether", address: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", decimals: 18, source: "bridge", logo: "/logos/eth.png" };
const MONAD_WBTC: PoolToken = { symbol: "WBTC", name: "Wrapped BTC", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8, source: "bridge", logo: "/logos/wbtc.png" };
const MONAD_CBBTC: PoolToken = { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b", decimals: 8, source: "bridge", logo: "/logos/cbbtc.png" };

const ETH_USDC: PoolToken = { ...ETHEREUM_USDC, stable: true, source: "bridge", logo: "/logos/usdc.png" };
const ETH_WETH: PoolToken = { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, source: "bridge", logo: "/logos/eth.png" };

const BASE_USDC_TOKEN: PoolToken = { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: BASE_USDC.decimals, stable: true, source: "bridge", logo: "/logos/usdc.png" };
const BASE_WETH: PoolToken = { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, source: "bridge", logo: "/logos/eth.png" };

// ── chains ────────────────────────────────────────────────────────────────

export const UNISWAP_CHAINS: Readonly<Record<UniswapChainId, UniswapChain>> = {
  [ROBINHOOD_CHAIN_ID]: {
    chainId: ROBINHOOD_CHAIN_ID,
    label: "Robinhood Chain",
    group: "stocks",
    dollar: USDG,
    nativeSymbol: "ETH",
    explorerTxBase: "https://robin.etherscan.io/tx/",
    uniswapSlug: "robinhood",
    logo: "/logos/robinhood.svg",
  },
  [MONAD_CHAIN_ID]: {
    chainId: MONAD_CHAIN_ID,
    label: "Monad",
    group: "monad",
    dollar: MONAD_USDC_TOKEN,
    nativeSymbol: "MON",
    explorerTxBase: "https://monadexplorer.com/tx/",
    uniswapSlug: "monad",
    logo: "/logos/monad.png",
  },
  [ETHEREUM_CHAIN_ID]: {
    chainId: ETHEREUM_CHAIN_ID,
    label: "Ethereum",
    group: "ethereum",
    dollar: ETH_USDC,
    nativeSymbol: "ETH",
    explorerTxBase: "https://etherscan.io/tx/",
    uniswapSlug: "ethereum",
    logo: "/logos/eth.png",
  },
  [BASE_CHAIN_ID]: {
    chainId: BASE_CHAIN_ID,
    label: "Base",
    group: "base",
    dollar: BASE_USDC_TOKEN,
    nativeSymbol: "ETH",
    explorerTxBase: "https://basescan.org/tx/",
    uniswapSlug: "base",
    logo: "/logos/base.svg",
  },
};

// The native token's address as Trustware names it on each chain, for the gas
// leg. Monad and Robinhood take the zero address (Robinhood unverified, see
// lib/robinhood/constants.ts); Ethereum and Base take the 0xEeee alias.
export const NATIVE_FUNDING_TOKEN: Readonly<Record<UniswapChainId, string>> = {
  [ROBINHOOD_CHAIN_ID]: ROBINHOOD_NATIVE_TOKEN,
  [MONAD_CHAIN_ID]: MONAD_NATIVE_TOKEN,
  [ETHEREUM_CHAIN_ID]: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  [BASE_CHAIN_ID]: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
};

// ── pools ─────────────────────────────────────────────────────────────────

function pool(
  p: Omit<UniswapPool, "label" | "explorerUrl" | "hooks"> & { hooks?: string },
): UniswapPool {
  const chain = UNISWAP_CHAINS[p.chainId];
  return {
    ...p,
    hooks: p.hooks ?? ZERO_ADDRESS,
    label: `${p.token0.symbol} / ${p.token1.symbol}`,
    explorerUrl: `https://app.uniswap.org/explore/pools/${chain.uniswapSlug}/${p.id}`,
  };
}

export const UNISWAP_POOLS: readonly UniswapPool[] = [
  // Robinhood Chain: the tokenized stocks and gold, every one against USDG.
  pool({ id: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", chainId: ROBINHOOD_CHAIN_ID, protocol: "V3", fee: 500, tickSpacing: 10, token0: USDG, token1: RH_NVDA, quoteSide: 0, group: "stocks" }),
  pool({ id: "0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd", chainId: ROBINHOOD_CHAIN_ID, protocol: "V4", fee: 3000, tickSpacing: 60, token0: RH_SPY, token1: USDG, quoteSide: 1, group: "stocks" }),
  pool({ id: "0x5875d407a42965b0e768c8925cea290e06fa50603ef34fc99eb92a1050e6ae36", chainId: ROBINHOOD_CHAIN_ID, protocol: "V4", fee: 3000, tickSpacing: 60, token0: USDG, token1: RH_META, quoteSide: 0, group: "stocks" }),
  pool({ id: "0xc61284332117c3FB23A2A56cceFFD07F7aF60029", chainId: ROBINHOOD_CHAIN_ID, protocol: "V3", fee: 500, tickSpacing: 10, token0: RH_SPCX, token1: USDG, quoteSide: 1, group: "stocks" }),
  pool({ id: "0x7A6A053eCCf1446A2633E05aA6D40D09381997ec", chainId: ROBINHOOD_CHAIN_ID, protocol: "V3", fee: 3000, tickSpacing: 60, token0: USDG, token1: RH_GLD, quoteSide: 0, group: "stocks" }),

  // Monad: the five pools with real depth. MON is currency0 (the zero
  // address) in three of them, so those positions hold native MON.
  pool({ id: "0xad408916c1c310da9c258d4c128a7bf50fd9edc42a218cc970da39cfc8a05d93", chainId: MONAD_CHAIN_ID, protocol: "V4", fee: 500, tickSpacing: 10, token0: MONAD_USDC_TOKEN, token1: MONAD_WETH, quoteSide: 0, group: "monad" }),
  pool({ id: "0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954", chainId: MONAD_CHAIN_ID, protocol: "V4", fee: 500, tickSpacing: 10, token0: MON, token1: MONAD_USDC_TOKEN, quoteSide: 1, group: "monad" }),
  pool({ id: "0x3783b51e33900eb366a9e8473c76cda441e7170d2e5d96927f30c16a7add93aa", chainId: MONAD_CHAIN_ID, protocol: "V4", fee: 500, tickSpacing: 1, token0: MON, token1: MONAD_WETH, quoteSide: null, group: "monad" }),
  pool({ id: "0x1c93dd2f2f47439330150bf728c3beeaad71de45420a49183214898b044b65d1", chainId: MONAD_CHAIN_ID, protocol: "V4", fee: 500, tickSpacing: 1, token0: MON, token1: MONAD_WBTC, quoteSide: null, group: "monad" }),
  pool({ id: "0x7fc6232a9ec6cc4e9434640dcde5ee08ccae3b07de3247bf788fc9e2051b449e", chainId: MONAD_CHAIN_ID, protocol: "V4", fee: 500, tickSpacing: 10, token0: MONAD_USDC_TOKEN, token1: MONAD_CBBTC, quoteSide: 0, group: "monad" }),

  // Ethereum and Base: one USDC/WETH pool each.
  pool({ id: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", chainId: ETHEREUM_CHAIN_ID, protocol: "V3", fee: 500, tickSpacing: 10, token0: ETH_USDC, token1: ETH_WETH, quoteSide: 0, group: "ethereum" }),
  pool({ id: "0x6c561B446416E1A00E8E93E221854d6eA4171372", chainId: BASE_CHAIN_ID, protocol: "V3", fee: 3000, tickSpacing: 60, token0: BASE_WETH, token1: BASE_USDC_TOKEN, quoteSide: 1, group: "base" }),
];

// ── lookups ───────────────────────────────────────────────────────────────

const BY_ID = new Map(UNISWAP_POOLS.map((p) => [`${p.chainId}:${p.id.toLowerCase()}`, p]));

export function uniswapPoolById(chainId: number, id: string): UniswapPool | undefined {
  return BY_ID.get(`${chainId}:${id.toLowerCase()}`);
}

export function uniswapPoolsForChain(chainId: number): UniswapPool[] {
  return UNISWAP_POOLS.filter((p) => p.chainId === chainId);
}

export function isUniswapChainId(chainId: number): chainId is UniswapChainId {
  return chainId in UNISWAP_CHAINS;
}

// Every distinct token the registry names on a chain, the dollar token
// included, keyed by lowercased address. What the Trustware `lp` shape and
// the wallet balance read both iterate.
export function uniswapTokensForChain(chainId: UniswapChainId): PoolToken[] {
  const out = new Map<string, PoolToken>();
  const chain = UNISWAP_CHAINS[chainId];
  out.set(chain.dollar.address.toLowerCase(), chain.dollar);
  for (const p of UNISWAP_POOLS) {
    if (p.chainId !== chainId) continue;
    out.set(p.token0.address.toLowerCase(), p.token0);
    out.set(p.token1.address.toLowerCase(), p.token1);
  }
  if (chainId === ROBINHOOD_CHAIN_ID) out.set(RH_WETH.address.toLowerCase(), RH_WETH);
  return [...out.values()];
}

export function uniswapTokenByAddress(chainId: UniswapChainId, address: string): PoolToken | undefined {
  const key = address.toLowerCase();
  return uniswapTokensForChain(chainId).find((t) => t.address.toLowerCase() === key);
}

// The pool's non-dollar side, or null for a pool with two.
export function baseToken(pool: UniswapPool): PoolToken | null {
  if (pool.quoteSide === 0) return pool.token1;
  if (pool.quoteSide === 1) return pool.token0;
  return null;
}

// False when a token of the pair cannot be obtained on its chain (see
// TokenSource "none"); the card then offers no deposit form for the pool.
export function isDepositable(pool: UniswapPool): boolean {
  return pool.token0.source !== "none" && pool.token1.source !== "none";
}

export function quoteToken(pool: UniswapPool): PoolToken | null {
  if (pool.quoteSide === 0) return pool.token0;
  if (pool.quoteSide === 1) return pool.token1;
  return null;
}

export const POOL_GROUP_LABELS: Readonly<Record<PoolGroup, string>> = {
  stocks: "Stocks and gold · Robinhood Chain",
  monad: "Monad",
  ethereum: "Ethereum",
  base: "Base",
};
