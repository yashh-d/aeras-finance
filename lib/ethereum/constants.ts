// Ethereum mainnet, as the chain two venues settle on: the Morpho Blue gold
// borrow market (lib/morpho/gold-*.ts) and the Aave earn vaults (lib/aave).
//
// These used to live in lib/morpho/gold-market.ts, which still re-exports them
// so nothing there had to move. They sit here because they are about the
// chain, not about Morpho, and a second venue on the same chain should not
// import its chain id from the first venue's registry.

// Already declared in lib/privy/provider.tsx `supportedChains` (as viem's
// `mainnet`, and the default chain), so the embedded wallet can sign here with
// no provider change.
export const ETHEREUM_CHAIN_ID = 1;

// Read-only JSON-RPC for market state, position reads and gas pricing.
// Server-only, so no NEXT_PUBLIC_ prefix. CLAUDE.md says there is no EVM RPC of
// our own, and that held while Trustware covered every EVM read we needed: its
// /sdk/rpc/evm surface proxies ERC-20 allowances only. Reading a Morpho Blue
// market or an Aave reserve needs a general eth_call, which that proxy does not
// serve, so this is the second read-only endpoint after MONAD_RPC_URL and
// follows the same shape: public fallback, paid endpoint droppable via env with
// no code change.
export const ETHEREUM_PUBLIC_RPC_URL = "https://ethereum-rpc.publicnode.com";
export const ETHEREUM_RPC_URL =
  process.env.ETHEREUM_RPC_URL ?? ETHEREUM_PUBLIC_RPC_URL;

export const ETHEREUM_EXPLORER_TX_BASE = "https://etherscan.io/tx/";

// Trustware's sentinel for native ETH as a route destination.
//
// **This is the 0xEeee... alias, not the zero address**, which is the reverse
// of Monad. MONAD_NATIVE_TOKEN is the zero address and the alias also quotes
// there; on Ethereum the zero address returns a 502 from the route solver and
// only the alias quotes. Measured 2026-08-26: 20 USDC from Solana delivered
// 0.007778 ETH via the alias, and the identical request with the zero address
// failed twice. Do not "tidy" these two constants into one.
export const ETHEREUM_NATIVE_TOKEN =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Circle's USDC on Ethereum, 6 decimals. Checksummed here; the lowercased form
// in lib/trustware/stables.ts and swap-tokens.ts is the same contract.
export const ETHEREUM_USDC = {
  symbol: "USDC" as const,
  name: "USD Coin",
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  decimals: 6,
} as const;
