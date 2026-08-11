// Trustware is a cross-chain "universal deposit layer" (routes any-chain assets to
// a chosen destination token/chain). We use it to convert a tokenized-stock
// representation the user holds on another chain into the canonical Solana xStock
// that Jupiter Lend accepts, delivered to the user's Solana wallet.
//
// The REST key (TRUSTWARE_API_KEY) is server-only per Trustware's docs. All calls
// go through our own API routes, never from the browser.

export const TRUSTWARE_API_ROOT = "https://api.trustware.io/api/v1";

export const TRUSTWARE_API_BASE_URL = `${TRUSTWARE_API_ROOT}/routes`;

// Balance scanning lives under /data, not /routes. GET /data/balances/:address
// returns holdings across every chain compatible with the address format, which
// is how we discover convertible equivalents without running our own EVM RPC.
export const TRUSTWARE_DATA_BASE_URL = `${TRUSTWARE_API_ROOT}/data`;

// Receipt submission and status polling hang off the intent, not off /routes.
export const TRUSTWARE_INTENT_BASE_URL = `${TRUSTWARE_API_ROOT}/route-intent`;

// Trustware proxies ERC-20 allowance reads, so checking an approval needs no EVM
// RPC of our own.
export const TRUSTWARE_EVM_RPC_BASE_URL = `${TRUSTWARE_API_ROOT}/sdk/rpc/evm`;

// Trustware's identifier for Solana mainnet as a destination chain. Verified
// against GET /chains (chainType "solana").
export const TRUSTWARE_SOLANA_CHAIN = "solana-mainnet-beta";

// Default slippage tolerance (percent) if a caller does not specify one. Matches
// Trustware's own default.
export const TRUSTWARE_DEFAULT_SLIPPAGE = 1;

// Slippage for a Solana-to-Solana route. These settle in a single Jupiter hop
// with no bridge, and the Ondo/xStock pairs quote 0 price impact at retail size.
// The planner solves for the source amount that guarantees the delivered
// minimum, so a loose tolerance does not buy a better rate, it just spends more
// of the source token to promise the same floor.
//
// Measured against live quotes on 2026-08-06, converting into 0.0234 TSLAx:
//   1.0%  sends 0.023968 TSLAon, minimum out 0.02375098
//   0.3%  sends 0.023800 TSLAon, minimum out 0.02375098
//   0.1%  sends 0.023752 TSLAon, minimum out 0.02375099
// Identical floor, 0.9% less spent. 0.3% keeps a margin for real movement
// between pricing and settlement; 0.1% leaves almost none.
export const TRUSTWARE_SOLANA_SLIPPAGE = 0.3;
