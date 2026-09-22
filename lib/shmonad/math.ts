// Pure arithmetic for the shMON venue. No I/O, no React, so every function is
// unit-tested in math.test.ts against figures read from the contract on
// 2026-09-22 and recorded in docs/shmonad-plan.md. Nothing else in the repo
// should derive a shMON rate, fee or capacity: the card, the positions rows
// and the Buy + Earn option have to agree to the decimal.
//
// Units: shares and MON are 18-decimal bigints on the way in and out; rates
// are decimals (0.05 is 5%) once they are numbers. Format at the edge.

import { RAY, WAD } from "./constants";

const SECONDS_PER_YEAR = 31_536_000;

// MON per shMON, from convertToAssets(1e18). A float, for display and for the
// dollar value of a position; never for sizing a transaction.
export function rateMonPerShare(assetsOfOneShare: bigint): number {
  return Number(assetsOfOneShare) / 1e18;
}

// A RAY fee rate as a decimal: 9.1857e24 -> 0.0091857.
export function feeRateFromRay(feeRateRay: bigint): number {
  return Number(feeRateRay) / 1e27;
}

// The instant-exit fee curve, as AtomicUnstakePool computes it: an affine
// function of pool utilization in RAY, y = c + m * u, capped at c + m so a
// utilization above 100% cannot push the fee past the maximum.
export function feeRateAtUtilization(
  slopeRateRay: bigint,
  yInterceptRay: bigint,
  utilizationWad: bigint,
): bigint {
  const uncapped = yInterceptRay + (slopeRateRay * utilizationWad) / WAD;
  const cap = yInterceptRay + slopeRateRay;
  return uncapped > cap ? cap : uncapped;
}

export interface GrowthRates {
  // Fractional growth of the share price over the window.
  growth: number;
  // Simple annualisation, the docs' APR formula.
  apr: number;
  // Compounded at the window's own cadence, the docs' APY formula.
  apy: number;
}

// Annualise the share price's growth between two reads. Null when the inputs
// cannot produce a rate (a zero or negative window, a zero start price), so a
// caller renders a dash rather than a number.
export function apyFromGrowth(
  priceStart: bigint,
  priceEnd: bigint,
  windowSeconds: number,
): GrowthRates | null {
  if (priceStart <= 0n || !(windowSeconds > 0)) return null;
  const growth = Number(priceEnd - priceStart) / Number(priceStart);
  const periods = SECONDS_PER_YEAR / windowSeconds;
  const apr = growth * periods;
  const apy = Math.pow(1 + growth, periods) - 1;
  if (!Number.isFinite(apr) || !Number.isFinite(apy)) return null;
  return { growth, apr, apy };
}

// shares -> MON at a rate expressed as convertToAssets(1e18). Rounds down,
// which is the direction that never overstates what an exit pays.
export function sharesToMon(shares: bigint, assetsOfOneShare: bigint): bigint {
  return (shares * assetsOfOneShare) / WAD;
}

// MON -> shares at a rate expressed as previewDeposit(1e18). Rounds down.
export function monToShares(mon: bigint, sharesOfOneMon: bigint): bigint {
  return (mon * sharesOfOneMon) / WAD;
}

// The most shares an instant exit can burn right now: the position, capped by
// what the atomic pool can pay at the gross rate. The pool pays net of fee,
// so pricing the cap at the gross rate is conservative.
export function instantCapacityShares(
  sharesOwned: bigint,
  poolAvailableMon: bigint,
  assetsOfOneShare: bigint,
): bigint {
  if (sharesOwned <= 0n || assetsOfOneShare <= 0n) return 0n;
  const payable = (poolAvailableMon * WAD) / assetsOfOneShare;
  return payable < sharesOwned ? payable : sharesOwned;
}

// A floor this many basis points under a previewed net figure, for
// redeemWithSlippageProtection.
export function withTolerance(amount: bigint, bps: number): bigint {
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

// MON the wallet can stake after keeping a gas reserve back. Zero when the
// wallet is at or under the reserve.
export function stakeableAfterReserve(walletMon: bigint, reserve: bigint): bigint {
  return walletMon > reserve ? walletMon - reserve : 0n;
}

export type UnstakePhase =
  // No request outstanding.
  | { phase: "none" }
  // Requested, not yet completable. The rate locked at the request.
  | { phase: "pending"; amountMon: bigint; completionEpoch: bigint }
  // completeUnstake would succeed now.
  | { phase: "ready"; amountMon: bigint; completionEpoch: bigint };

// Where an account is in the queued exit. `ready` comes from simulating
// completeUnstake (lib/shmonad/server.ts), never from comparing epochs: the
// contract exposes two epoch counters and it is not documented which one
// completionEpoch is expressed in.
export function unstakePhase(
  request: { amountMon: bigint; completionEpoch: bigint },
  ready: boolean,
): UnstakePhase {
  if (request.amountMon <= 0n) return { phase: "none" };
  const base = {
    amountMon: request.amountMon,
    completionEpoch: request.completionEpoch,
  };
  return ready ? { phase: "ready", ...base } : { phase: "pending", ...base };
}

// Percent of RAY, for copy: 9.1857e24 -> "0.92".
export function feePercentString(feeRateRay: bigint, digits = 2): string {
  return (feeRateFromRay(feeRateRay) * 100).toFixed(digits);
}

export { RAY, WAD };
