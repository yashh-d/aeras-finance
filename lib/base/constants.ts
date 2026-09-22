// Base mainnet, the chain the Bitwise Mag7X portfolio settles on.
//
// Pure constants with no imports, so the server-only Trustware validator and
// the client funding modules can both read them without either pulling the
// other's dependencies in. lib/trustware/base.ts re-exports the two the wallet
// panel already used, so nothing that imported them from there has to move.

export const BASE_CHAIN_ID = 8453;

// Circle's canonical USDC on Base, 6 decimals. The same address the Lighter
// margin route already delivers to in lib/trustware/server.ts, which is where
// this was taken from rather than from a doc. Lowercased, because every
// contract comparison in lib/trustware is lowercased.
export const BASE_USDC = {
  symbol: "USDC" as const,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  decimals: 6,
};

// CAIP-19 id for the same contract, the form Glider's API speaks.
export const BASE_USDC_ASSET_ID = `eip155:${BASE_CHAIN_ID}/erc20:${BASE_USDC.address}`;

// How Trustware names native ETH on Base in a quote. Ethereum quotes only
// through the 0xEeee alias and Monad only through the zero address
// (lib/ethereum/constants.ts explains the measurement). Base quotes through
// BOTH, measured 2026-09-22 by scripts/glider-check.mts: 2 USDC from Solana
// delivered 0.000722 ETH by either spelling, via LI.FI. The alias is used;
// the server accepts both so the constant can be flipped without widening
// anything.
export const BASE_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const BASE_NATIVE_TOKEN_ALIASES: readonly string[] = [
  BASE_NATIVE_TOKEN.toLowerCase(),
  "0x0000000000000000000000000000000000000000",
];

// Read-only JSON-RPC, for the Uniswap WETH/USDC pool on Base (lib/uniswap).
// Server-only, so no NEXT_PUBLIC_ prefix; the public node is the fallback the
// way it is for Ethereum and Monad, and a paid endpoint drops in through env.
export const BASE_PUBLIC_RPC_URL = "https://mainnet.base.org";
export const BASE_RPC_URL = process.env.BASE_RPC_URL ?? BASE_PUBLIC_RPC_URL;

export const BASE_EXPLORER_TX_BASE = "https://basescan.org/tx/";
export const BASE_EXPLORER_ADDRESS_BASE = "https://basescan.org/address/";
