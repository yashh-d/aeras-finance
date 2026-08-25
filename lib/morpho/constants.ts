// Morpho on Monad — the first Aeras earn venue that settles off Solana.
//
// Users deposit USDC into a MetaMorpho (ERC-4626) vault on Monad mainnet and
// earn the vault's yield. Everything here is Monad-EVM specific; the Solana
// earn venues (Jupiter Lend, Kamino kvaults) are unaffected.
//
// See CLAUDE.md "Chain Assumptions" — this is the deliberate exception where a
// *position* lives on an EVM chain, funded from Solana (or any chain) through
// the Trustware layer.

// Monad mainnet. Launched 2025-11-24. chainId 143 (0x8f).
export const MONAD_CHAIN_ID = 143;

// Read-only JSON-RPC for balance / share-price reads. Server-only, so no
// NEXT_PUBLIC_ prefix; falls back to Monad's public endpoint when unset. A paid
// endpoint (Alchemy/QuickNode) can be dropped in via env without code changes.
export const MONAD_RPC_URL =
  process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";

// Block explorer for surfacing a settled transaction.
export const MONAD_EXPLORER_TX_BASE = "https://monadexplorer.com/tx/";

// Canonical USDC on Monad. 6 decimals, matching every other USDC we handle.
// Verified as the `asset()` of the Morpho vaults below (2026-08-24).
export const MONAD_USDC = {
  symbol: "USDC" as const,
  address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  decimals: 6,
};

// Morpho's public indexer. One GraphQL endpoint serves every chain; we filter by
// chainId 143. Used server-side for net APY and TVL (rewards included).
export const MORPHO_BLUE_API_URL = "https://blue-api.morpho.org/graphql";
