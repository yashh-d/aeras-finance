// Aave on Ethereum: the addresses the earn venue in lib/aave touches.
//
// Every address here is taken from BGD Labs' aave-address-book
// (@bgd-labs/aave-address-book 4.44.22, published 2026-02-18), which is the
// registry Aave's own governance tooling reads, and is re-verified on-chain by
// scripts/aave-check.mts: each vault's `asset()`, `aToken()`, `decimals()` and
// the stake token's underlying are read back and compared to this file rather
// than trusted. Run that script before shipping a change to any address below.
//
// The chain itself (id, RPC, explorer, native-token sentinel) is in
// lib/ethereum/constants.ts, shared with the Morpho gold market.

export {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_EXPLORER_TX_BASE,
  ETHEREUM_NATIVE_TOKEN,
  ETHEREUM_RPC_URL,
  ETHEREUM_USDC,
} from "@/lib/ethereum/constants";

// ── Aave V3 Core market ────────────────────────────────────────────────────

// The Pool. Only read here, for `getReserveData`, which carries the reserve's
// current liquidity rate. Deposits never call it directly: they go through the
// stata token, which supplies to the Pool on the user's behalf.
export const AAVE_V3_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";

// Aave's price oracle for the Core market. Prices are USD with 8 decimals
// (BASE_CURRENCY_UNIT is 1e8). Used only to turn a reward emission into a
// rate; nothing that becomes an amount is priced through it.
export const AAVE_ORACLE = "0x54586bE62E3c3580375aE3723C145253060Ca0C2";

// ── Umbrella ───────────────────────────────────────────────────────────────

// Umbrella is Aave's safety module: staked assets backstop the protocol's bad
// debt in exchange for extra rewards. The stake tokens are ERC-4626 vaults
// over the stata tokens.
export const UMBRELLA = "0xD400fc38ED4732893174325693a63C30ee3881a8";

// Pays the safety incentives. Read for emissions and pending rewards; called
// to claim.
export const UMBRELLA_REWARDS_CONTROLLER =
  "0x4655Ce3D625a63d30bA704087E52B4C31E38188B";

// BGD's batch helper. One transaction takes plain USDC, wraps it into the
// stata token and stakes it; one transaction unstakes and unwraps back to
// USDC. Without it a deposit is three transactions (approve, stata deposit,
// stake) and a full exit is two. Its `deposit` and `redeem` need an ERC-20
// allowance from the user to the helper on the token going in (USDC on the
// way in, the stake token on the way out).
export const UMBRELLA_BATCH_HELPER =
  "0xCe6Ced23118EDEb23054E06118a702797b13fc2F";

// ── tokens ─────────────────────────────────────────────────────────────────

// Tether USD on Ethereum. The same non-compliant ERC-20 lib/morpho/gold-market.ts
// documents: `approve` returns no bool and reverts when moving a non-zero
// allowance to a different non-zero value, so lib/aave/deposit.ts resets an
// allowance to zero before raising it.
export const ETHEREUM_USDT = {
  symbol: "USDT" as const,
  name: "Tether USD",
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  decimals: 6,
} as const;
