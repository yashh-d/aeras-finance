export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const JUPITER_ULTRA_BASE_URL = "https://lite-api.jup.ag/ultra/v1";

// Ultra rejects gasless orders below this USD value (errorCode 3, "Minimum $5 for gasless").
export const ULTRA_MIN_USD = 5;

// Trigger V2 (limit orders) lives on the keyed gateway, not lite-api. Every call
// needs an x-api-key, so these are only ever hit from server route handlers that
// read JUPITER_API_KEY. See app/api/jupiter/trigger/*.
export const JUPITER_API_BASE_URL = "https://api.jup.ag";
export const TRIGGER_V2_BASE = `${JUPITER_API_BASE_URL}/trigger/v2`;

// Trigger V2 minimum order size is $10 USD equivalent (vs Ultra's $5).
export const TRIGGER_MIN_USD = 10;

// Default limit-order lifetime when the user does not pick one.
export const TRIGGER_DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Default max slippage for limit-order execution (1%).
export const TRIGGER_DEFAULT_SLIPPAGE_BPS = 100;

export const SOLSCAN_TX_BASE = "https://solscan.io/tx/";
