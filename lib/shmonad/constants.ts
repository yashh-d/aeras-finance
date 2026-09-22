// shMON: FastLane's liquid staking token on Monad, as the fifth Aeras earn
// venue that settles off Solana. See docs/shmonad-plan.md for the plan and
// docs/shmonad.md for what was verified.
//
// Everything here was read live from Monad mainnet on 2026-09-22 (block
// 106,886,926) and from docs.shmonad.xyz. scripts/shmonad-check.mts re-reads
// all of it; a mismatch there means the chain moved, not that this file is
// authoritative.

import { MONAD_NATIVE_TOKEN } from "@/lib/morpho/constants";

// The shMON contract on Monad mainnet (docs.shmonad.xyz/addresses). An
// ERC-4626 vault whose asset is native MON: `deposit` is payable and
// `msg.value` must equal `assets`. `name()` "ShMonad", `symbol()` "shMON".
export const SHMON_ADDRESS = "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c";
export const SHMON_SYMBOL = "shMON";
export const SHMON_NAME = "shMON";
export const SHMON_DECIMALS = 18;
export const MON_DECIMALS = 18;

// What `asset()` returns: the 0xEeee alias for native MON. This is NOT the
// value Trustware wants as a Monad route destination; that is the zero-address
// sentinel MONAD_NATIVE_TOKEN (both quote on Monad, but the funding shape in
// lib/trustware/server.ts admits the zero address). Keep them apart.
export const SHMON_ASSET_ALIAS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const SHMON_FUNDING_TOKEN = MONAD_NATIVE_TOKEN;

// Fixed-point scales the contract uses: RAY for fee rates (1e27 = 100%),
// WAD for utilization (1e18 = 100%).
export const RAY = 10n ** 27n;
export const WAD = 10n ** 18n;

// Rewards compound into the exchange rate once per epoch. The docs say about
// 5.5 hours and 1,590 epochs a year; this figure is used for copy only, never
// for a countdown. Readiness of a queued unstake is decided by simulating
// completeUnstake (see lib/shmonad/server.ts), because the contract exposes
// two epoch counters (getInternalEpoch and getEpochInfo) that disagree.
export const EPOCH_HOURS_APPROX = 5.5;
export const EPOCHS_PER_YEAR = 1590;
// A queued unstake completes after 4 to 5 epochs: 22 to 27 hours.
export const UNSTAKE_WAIT_COPY = "about a day (4 to 5 epochs)";

// Historical share-price reads for the APY. Server-only usage. The paid Monad
// endpoint (MONAD_RPC_URL, Alchemy) serves about one day of history and the
// public node about a week, measured 2026-09-22, so the history read goes to
// its own endpoint and defaults to the public one.
export const MONAD_HISTORY_RPC_URL =
  process.env.MONAD_HISTORY_RPC_URL ?? "https://rpc.monad.xyz";
// Monad blocks landed every 0.302 seconds when measured (2026-09-22, over
// 2.4M blocks). Used only to guess the block a window back; the real
// timestamps are read afterwards. The public node served eth_call 2.4M blocks
// back (8.4 days) and refused 2.8M, so the week window fits with a margin.
export const MONAD_BLOCK_SECONDS_APPROX = 0.3;
export const APY_WINDOW_SECONDS = 7 * 86_400;
export const APY_FALLBACK_WINDOW_SECONDS = 86_400;

// Instant exits are sent through redeemWithSlippageProtection with a floor
// this far under previewRedeemDetailed's net figure. The fee moves with pool
// utilization between the read and the block that mines the exit.
export const INSTANT_EXIT_TOLERANCE_BPS = 25;

// Native MON an exit or a return leg must find in the wallet before it is
// signed. requestUnstake, redeem and completeUnstake each estimate at about
// 100k gas, 0.01 MON at 102 gwei; twice that is the floor, well under the
// 0.1 MON reserve a funded stake keeps back.
export const EXIT_GAS_MIN_WEI = 20_000_000_000_000_000n; // 0.02 MON

// Stake form limits, in Solana USDC atomic (6 decimals). Below the warn line
// the route's fixed fee (about $0.03) plus its 0.3% passes 2% of the amount
// (measured 2026-09-22: 0.64% of 5 USDC, 0.28% of 25, 0.26% of 100).
export const MIN_STAKE_USDC_ATOMIC = 1_000_000n;
export const STAKE_FEE_WARN_USDC_ATOMIC = 2_000_000n;

// Sizing headroom taken off the Solana balance for Max, the margin
// maxFundableDepositAtomic uses for the Morpho venue.
export const STAKE_MAX_BUFFER_BPS = 300;
