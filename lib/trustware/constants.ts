// Trustware is a cross-chain "universal deposit layer" (routes any-chain assets to
// a chosen destination token/chain). We use it to convert a tokenized-stock
// representation the user holds on another chain into the canonical Solana xStock
// that Jupiter Lend accepts, delivered to the user's Solana wallet.
//
// The REST key (TRUSTWARE_API_KEY) is server-only per Trustware's docs. All calls
// go through our own API routes, never from the browser.

export const TRUSTWARE_API_BASE_URL = "https://api.trustware.io/api/v1/routes";

// Trustware's identifier for Solana mainnet as a destination chain. Verified
// against GET /chains (chainType "solana").
export const TRUSTWARE_SOLANA_CHAIN = "solana-mainnet-beta";

// Default slippage tolerance (percent) if a caller does not specify one. Matches
// Trustware's own default.
export const TRUSTWARE_DEFAULT_SLIPPAGE = 1;
