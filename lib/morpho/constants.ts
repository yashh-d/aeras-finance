// Morpho on Monad — the first Aeras earn venue that settles off Solana.
//
// Users deposit USDC into a Morpho Vaults V2 (ERC-4626) vault on Monad mainnet
// and earn the vault's yield. Everything here is Monad-EVM specific; the Solana
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
// Verified as the `asset()` of the curated Morpho vaults (2026-08-25).
export const MONAD_USDC = {
  symbol: "USDC" as const,
  address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  decimals: 6,
};

// Trustware's sentinel for native MON as a route destination (the zero
// address; the 0xEeeE... alias also quotes). Used by the gas top-up leg of a
// funded deposit: the embedded wallet is born with USDC but no MON, and every
// Monad transaction needs MON for gas. Verified live 2026-08-25: 0.5 USDC
// delivered ~17 MON (MON ~ $0.03).
export const MONAD_NATIVE_TOKEN =
  "0x0000000000000000000000000000000000000000";

// Morpho's public indexer. One GraphQL endpoint serves every chain; we filter by
// chainId 143. Used server-side for net APY and TVL (rewards included). Our
// vaults are Vaults V2, served by the `vaultV2s` query; the `vaults` query is
// V1-only.
export const MORPHO_BLUE_API_URL = "https://blue-api.morpho.org/graphql";
