// Ondo Perps is an offchain perps exchange that accepts Ondo tokenized equities
// as margin, not just stablecoins. That is the only reason we use it: it lets a
// user short the stock they already hold, collateralised by that same stock.
//
// See docs/ondo-perps.md. Prefer the live API over the prose docs: they disagree
// on deposit networks, the collateral list, max leverage and trading hours.

// Sandbox until a builder code lands. Server-only so the environment cannot be
// flipped from the browser.
export type OndoEnv = "sandbox" | "production";

export const ONDO_ENV: OndoEnv =
  process.env.ONDO_PERPS_ENV === "production" ? "production" : "sandbox";

export const ONDO_IS_PRODUCTION = ONDO_ENV === "production";

// The two environments are not the same exchange with fake money. Measured
// 2026-08-10, they disagree on things the hedge depends on:
//
//   - Collateral contract addresses differ for every equity token. Sandbox SPYon
//     is 0x86C75385..., production is 0xfedc5f4a.... A deposit built against the
//     wrong one is sent to a contract that does not exist on that chain.
//   - Sandbox lists a Solana USDC deposit path. Production does not.
//   - Sandbox has SPY-USD.P and QQQ-USD.P enabled. Production disables them,
//     which is the whole reason SPY and QQQ have to be hedged with index perps.
//
// So a hedge tested end to end in sandbox proves less than it appears to.
// scripts/ondo-hedge-check.mts asserts against production and diffs the two.
export const ONDO_API_HOSTS = {
  production: "api.ondoperps.xyz",
  sandbox: "api.ondoperps-sandbox.xyz",
} as const;

export const ONDO_API_HOST = ONDO_API_HOSTS[ONDO_ENV];

export const ONDO_API_BASE_URL = `https://${ONDO_API_HOST}`;
export const ONDO_WS_URL = `wss://${ONDO_API_HOST}/ws`;

// Issued by the Ondo team after emailing builders@ondoperps.xyz. Attributes
// routed fills to us. Absent until they reply, which is why every read path here
// works without it.
export const ONDO_BUILDER_CODE = process.env.ONDO_BUILDER_CODE ?? "";

// Builders are capped at 10 bps per order by Ondo.
export const ONDO_BUILDER_MAX_FEE_BPS = 10;

// Auth is SIWE on Ethereum mainnet regardless of which chain the deposit lands
// on, so this is not the deposit chain.
export const ONDO_AUTH_CHAIN_ID = "1";

// Every accepted collateral asset is Ethereum-only in production (USDC is also
// on Arbitrum). There is no production Solana deposit path for anything, despite
// provision_address advertising a `solana` enum value and sandbox listing one.
// Verified against live tokenConfig.
export const ONDO_DEPOSIT_NETWORK = "ethereum";

// Discount applied to tokenized-equity collateral before it counts as margin.
// Not returned by any endpoint, so it is a constant here and will go stale
// silently if Ondo changes it. Re-check against docs/ondo-perps.md periodically.
export const ONDO_EQUITY_HAIRCUT = 0.1;

// At this loan-to-value the exchange auto-sells collateral to clear USDC debt.
// Also prose-only, also not returned by any endpoint.
export const ONDO_AUTO_EXCHANGE_LTV = 0.3;
