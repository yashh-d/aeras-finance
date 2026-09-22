// Robinhood Chain, the chain the tokenized-stock liquidity pools live on.
//
// Chain id 4663, an Arbitrum Orbit L2 with ETH as the gas token, mainnet since
// 2026-07-01, blocks every ~100ms. viem 2.55.8 ships it as `robinhood`, and
// lib/privy/provider.tsx declares it in `supportedChains` so the embedded EVM
// wallet can sign here. Pure constants with no imports, so the server-only
// Trustware validator and the client funding modules can both read them.
// See docs/uniswap-lp-plan.md.

export const ROBINHOOD_CHAIN_ID = 4663;

// Read-only JSON-RPC. Server-only, so no NEXT_PUBLIC_ prefix; the public node
// is rate-limited, and Alchemy serves the chain, so a paid endpoint drops in
// through env with no code change, the way MONAD_RPC_URL does.
export const ROBINHOOD_PUBLIC_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_RPC_URL =
  process.env.ROBINHOOD_RPC_URL ?? ROBINHOOD_PUBLIC_RPC_URL;

export const ROBINHOOD_EXPLORER_TX_BASE = "https://robin.etherscan.io/tx/";
export const ROBINHOOD_EXPLORER_ADDRESS_BASE = "https://robin.etherscan.io/address/";

// Paxos Global Dollar, 6 decimals: the quote asset of every stock pool on the
// chain. NOT USDC. The USDC on 4663 is a bridged USDC.e that no listed pool
// uses, and Trustware's quote for Solana USDC -> USDG is what funds a deposit
// (verified 2026-09-21: 25 USDC delivered 24.88 USDG via LI.FI).
export const ROBINHOOD_USDG = {
  symbol: "USDG" as const,
  name: "Global Dollar",
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
} as const;

export const ROBINHOOD_WETH = {
  symbol: "WETH" as const,
  name: "Wrapped Ether",
  address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  decimals: 18,
} as const;

// How Trustware names native ETH on this chain as a route destination. The
// Solana USDC -> native ETH quote answered 502 on both spellings on
// 2026-09-21 (a gateway error, not a route verdict), so which one quotes is
// unknown until scripts/uniswap-check.mts says. The zero address is the
// spelling Monad takes; the alias is Ethereum's. The server-side shape accepts
// both so the constant can be flipped without widening anything.
export const ROBINHOOD_NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
export const ROBINHOOD_NATIVE_TOKEN_ALIASES: readonly string[] = [
  ROBINHOOD_NATIVE_TOKEN.toLowerCase(),
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
];

// Gas. An Orbit chain's gas is cents: the floor is a comfortable multiple of a
// full position lifecycle (approvals, a swap, a mint, a decrease, a claim and
// two return legs) at the gas price the check script prints, and the top-up
// is a fixed USDC amount the way Monad's is, because the chain is cheap
// enough that sizing from the live price buys nothing. Re-measure with
// scripts/uniswap-check.mts section 6 if the chain's gas moves.
export const ROBINHOOD_GAS_FLOOR_WEI = 200_000_000_000_000n; // 0.0002 ETH
export const ROBINHOOD_GAS_TOPUP_USDC_ATOMIC = 1_500_000n; // 1.5 USDC
// If the top-up quotes to less than this, ETH has repriced dramatically and
// the fixed amount no longer makes sense; stop rather than deliver dust.
export const ROBINHOOD_GAS_MIN_DELIVERED_WEI = 150_000_000_000_000n; // 0.00015 ETH
