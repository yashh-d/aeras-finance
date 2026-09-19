// Pure arithmetic for the Aave venue. Nothing here touches the network, so it
// is unit-tested in ./math.test.ts.

// Aave's fixed-point unit for rates. `currentLiquidityRate` is an annual rate
// scaled by 1e27, and it is a per-second rate compounded per second, which is
// how Aave's own interface turns it into an APY.
export const RAY = 10n ** 27n;
export const SECONDS_PER_YEAR = 31_536_000;

// Aave oracle prices carry 8 decimals.
export const ORACLE_DECIMALS = 8;

// APR (ray) to APY (decimal, 0.05 = 5%), compounded per second the way Aave's
// UI does it. A float is fine: the result is rendered, never turned into an
// amount.
export function supplyApyFromLiquidityRate(liquidityRateRay: bigint): number {
  const apr = Number(liquidityRateRay) / 1e27;
  if (apr <= 0) return 0;
  return Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
}

// One Umbrella reward stream as an annual rate on the staked value.
//
// emission is per second in the reward token's own units. Both sides are
// priced through the Aave oracle (8 decimals), so the units cancel: a year of
// emission in USD over the staked assets in USD. The emission is already zero
// once a distribution ends, so an expired stream contributes nothing without a
// special case.
export function rewardAprFromEmission(args: {
  emissionPerSecond: bigint;
  rewardDecimals: number;
  rewardPriceE8: bigint;
  // The stake's total assets, in the underlying (USDC) units.
  stakedAtomic: bigint;
  stakedDecimals: number;
  stakedPriceE8: bigint;
}): number {
  const stakedUsd =
    (Number(args.stakedAtomic) / 10 ** args.stakedDecimals) *
    (Number(args.stakedPriceE8) / 10 ** ORACLE_DECIMALS);
  if (stakedUsd <= 0) return 0;
  const yearlyRewardUsd =
    (Number(args.emissionPerSecond) / 10 ** args.rewardDecimals) *
    SECONDS_PER_YEAR *
    (Number(args.rewardPriceE8) / 10 ** ORACLE_DECIMALS);
  return yearlyRewardUsd / stakedUsd;
}

// Umbrella pays the underlying supply APY (the stata token keeps accruing
// inside the stake) plus the safety incentives on top. Shown as a sum, which
// is how Aave's own staking page presents it; the streams are paid in
// different tokens and do not compound into each other.
export function umbrellaTotalApy(supplyApy: number, rewardApr: number): number {
  return supplyApy + rewardApr;
}

// ── cooldown ───────────────────────────────────────────────────────────────

export interface CooldownSnapshot {
  // Shares frozen when the cooldown started. Zero when no cooldown is active.
  amount: bigint;
  // Unix seconds after which redemption opens.
  endOfCooldown: number;
  // Seconds after endOfCooldown during which redemption stays open.
  withdrawalWindow: number;
}

export type CooldownPhase =
  // No cooldown started (or the last one was fully used).
  | { phase: "none" }
  // Started, not yet redeemable.
  | { phase: "cooling"; redeemableAt: number; shares: bigint }
  // Redeemable now, until windowEndsAt.
  | { phase: "window"; windowEndsAt: number; shares: bigint }
  // The window closed without a redemption; a new cooldown is needed.
  | { phase: "expired"; shares: bigint };

// Where a staker is in the exit process at `nowSeconds`. Timestamps are
// compared against the chain's clock, so callers pass the latest block's
// timestamp rather than the wall clock.
export function cooldownPhase(
  snapshot: CooldownSnapshot,
  nowSeconds: number,
): CooldownPhase {
  if (snapshot.amount <= 0n || snapshot.endOfCooldown === 0) {
    return { phase: "none" };
  }
  if (nowSeconds < snapshot.endOfCooldown) {
    return {
      phase: "cooling",
      redeemableAt: snapshot.endOfCooldown,
      shares: snapshot.amount,
    };
  }
  const windowEndsAt = snapshot.endOfCooldown + snapshot.withdrawalWindow;
  if (nowSeconds <= windowEndsAt) {
    return { phase: "window", windowEndsAt, shares: snapshot.amount };
  }
  return { phase: "expired", shares: snapshot.amount };
}

// "20 days", "2 days 3 hours", "45 minutes". For copy, never for logic.
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0 && days < 7) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (days === 0 && hours === 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
}
