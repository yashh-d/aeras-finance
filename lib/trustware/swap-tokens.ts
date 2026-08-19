// Curated swap registry: the only tokens the swap surface offers, and the only
// pairs the key-bearing proxy will route.
//
// This is deliberately separate from equivalents.ts. That registry answers "what
// converts into a vault's collateral" and always ends on Solana. This one answers
// "what can a user swap between", and both sides are free: Solana to Ethereum,
// Ethereum to BNB, either direction. EVM is a valid destination here, which is a
// deliberate exception to the rest of the app (see CLAUDE.md, Chain Assumptions).
// A position still never settles off Solana; this is wallet plumbing, not lending.
//
// Everything below was verified against live /quote calls on 2026-08-16, not read
// off a listing. Trustware's GET /routes/tokens lists ~26k rows including decoys
// (a second "USDC" on Ethereum at 18 decimals and $11.75, with no coingeckoId),
// so listing proves nothing. Two facts worth keeping:
//
//   1. Decimals genuinely differ per chain. USDC is 6 on Ethereum and Solana but
//      18 on BNB Chain. Every value here is cross-checked by implying the token's
//      USD price from a live quote in both directions and confirming the two
//      agree. Getting one wrong misprices a swap by 10^12.
//   2. `?chain=` on GET /routes/tokens is ignored. All three chains return the
//      identical 7,451,325-byte body spanning every chain, so any filtering has
//      to happen on each row's own `chainId`.

import { TRUSTWARE_SOLANA_CHAIN } from "./constants";

// Which signer executes the source leg, same meaning as in equivalents.ts.
export type SwapChainKind = "evm" | "solana";

export interface SwapToken {
  // Stable key for the picker and for URL state. "<chain>:<symbol>".
  id: string;
  symbol: string;
  name: string;
  // Trustware chainId: numeric string for EVM, "solana-mainnet-beta" for Solana.
  chain: string;
  chainLabel: string;
  kind: SwapChainKind;
  // Contract address, SPL mint, or the native sentinel below.
  address: string;
  decimals: number;
  native: boolean;
  logo?: string;
}

// Trustware's stand-in for a chain's native gas token. Confirmed to work on both
// sides of a route: ETH -> Solana USDC and Ethereum USDC -> SOL both quote. Note
// it is the same EVM-style sentinel on Solana, where it means native SOL rather
// than an SPL mint, so it can never be passed to an SPL call.
export const NATIVE_TOKEN_SENTINEL =
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const SWAP_CHAINS = {
  ethereum: "1",
  bnb: "56",
  solana: TRUSTWARE_SOLANA_CHAIN,
} as const;

const CHAIN_LABELS: Record<string, string> = {
  "1": "Ethereum",
  "56": "BNB Chain",
  [TRUSTWARE_SOLANA_CHAIN]: "Solana",
};

function evm(
  chain: string,
  symbol: string,
  name: string,
  address: string,
  decimals: number,
  logo?: string,
): SwapToken {
  return {
    id: `${chain}:${symbol}`,
    symbol,
    name,
    chain,
    chainLabel: CHAIN_LABELS[chain] ?? chain,
    kind: "evm",
    // Lowercased so lookups are case-insensitive, matching equivalents.ts.
    address: address.toLowerCase(),
    decimals,
    native: address.toLowerCase() === NATIVE_TOKEN_SENTINEL,
    logo,
  };
}

// Base58 mints are case-sensitive, so the address is kept verbatim. Lowercasing
// would both fail to match and risk collapsing two distinct mints.
function sol(
  symbol: string,
  name: string,
  address: string,
  decimals: number,
  logo?: string,
): SwapToken {
  return {
    id: `${TRUSTWARE_SOLANA_CHAIN}:${symbol}`,
    symbol,
    name,
    chain: TRUSTWARE_SOLANA_CHAIN,
    chainLabel: CHAIN_LABELS[TRUSTWARE_SOLANA_CHAIN],
    kind: "solana",
    address,
    decimals,
    native: address === NATIVE_TOKEN_SENTINEL,
    logo,
  };
}

// Wrapped duplicates are intentionally left out. WSOL and WETH both quote fine,
// but the native sentinel already covers each of them and showing "SOL" next to
// "WSOL" in a picker is a way for a user to pick the wrong one.
//
// BTC on Solana had two candidates and the choice was made on measured
// liquidity, not on the registry. Quoting both against Ethereum USDC:
//
//   size     3NZ9JM.. (wormhole)     5XZw2L.. (wrapped-bitcoin)
//   $25      ok                      ok
//   $2,500   ok, 0.5% total cost     ok, but delivers $1,955 of $2,500
//   $25,000  ok, 0.25% total cost    fails, "low liquidity"
//
// The second mint quotes a 22% loss at $2,500 without erroring, which is the
// worst possible failure mode, so only the Wormhole mint is listed.
export const SWAP_TOKENS: readonly SwapToken[] = [
  // Solana
  sol("USDC", "USD Coin", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6, "/logos/usdc.png"),
  sol("USDT", "Tether USD", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6),
  sol("SOL", "Solana", NATIVE_TOKEN_SENTINEL, 9, "/logos/solana.png"),
  sol("ETH", "Ether (Wormhole)", "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", 8, "/logos/eth.png"),
  sol("WBTC", "Wrapped Bitcoin (Wormhole)", "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", 8),

  // Ethereum
  evm("1", "USDC", "USD Coin", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6, "/logos/usdc.png"),
  evm("1", "USDT", "Tether USD", "0xdac17f958d2ee523a2206206994597c13d831ec7", 6),
  evm("1", "ETH", "Ether", NATIVE_TOKEN_SENTINEL, 18, "/logos/eth.png"),
  evm("1", "WBTC", "Wrapped Bitcoin", "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", 8),

  // BNB Chain. USDC and USDT are 18 decimals here, not 6.
  evm("56", "USDC", "USD Coin", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", 18, "/logos/usdc.png"),
  evm("56", "USDT", "Tether USD", "0x55d398326f99059ff775485246999027b3197955", 18),
  evm("56", "BNB", "BNB", NATIVE_TOKEN_SENTINEL, 18, "/logos/bnb.png"),
  evm("56", "ETH", "Ether", "0x2170ed0880ac9a755fd29b2688956bd959f933f8", 18, "/logos/eth.png"),
  evm("56", "BTCB", "Bitcoin BEP20", "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", 18),
] as const;

// The native sentinel is shared across all three chains, so a lookup keyed on
// address alone would collide. Chain is always part of the key.
function keyOf(chain: string, address: string): string {
  const isEvmChain = chain !== TRUSTWARE_SOLANA_CHAIN;
  return `${chain}:${isEvmChain ? address.toLowerCase() : address}`;
}

const BY_KEY = new Map(SWAP_TOKENS.map((t) => [keyOf(t.chain, t.address), t]));
const BY_ID = new Map(SWAP_TOKENS.map((t) => [t.id, t]));

export function findSwapToken(
  chain: string,
  address: string,
): SwapToken | undefined {
  return BY_KEY.get(keyOf(chain, address));
}

export function swapTokenById(id: string): SwapToken | undefined {
  return BY_ID.get(id);
}

// The allowlist predicate. Both sides of a swap must pass this before the proxy
// will route it.
export function isSwapToken(chain: string, address: string): boolean {
  return BY_KEY.has(keyOf(chain, address));
}

export function swapTokensForChain(chain: string): SwapToken[] {
  return SWAP_TOKENS.filter((t) => t.chain === chain);
}

// Which execution path a pair takes. The Trustware widget signs through an
// EIP-1193 provider only, so it can serve a pair where both legs are EVM. Any
// pair touching Solana needs a Solana signature and goes through our own REST
// panel instead.
export function isEvmOnlyPair(from: SwapToken, to: SwapToken): boolean {
  return from.kind === "evm" && to.kind === "evm";
}

// Same chain and same token is not a swap. Guarded here so both the UI and the
// proxy reject it identically.
export function isSamePair(from: SwapToken, to: SwapToken): boolean {
  return from.chain === to.chain && from.address === to.address;
}

// Jupiter speaks SPL mints and has no concept of Trustware's native sentinel.
// Native SOL is WSOL there, which Jupiter wraps and unwraps automatically. This
// lives with the registry rather than with the quote code so the Jupiter proxy's
// allowlist can resolve mints without importing the whole pricing path.
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function solanaMintFor(token: SwapToken): string {
  if (token.kind !== "solana") {
    throw new Error(`${token.symbol} is not a Solana token`);
  }
  return token.address === NATIVE_TOKEN_SENTINEL ? WSOL_MINT : token.address;
}
