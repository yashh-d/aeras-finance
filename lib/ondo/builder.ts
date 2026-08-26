import {
  ONDO_BUILDER_CODE,
  ONDO_BUILDER_FEE_BPS,
  ONDO_BUILDER_MAX_FEE_BPS,
} from "./constants";
import type { OndoBuilderCode } from "./types";

// The builder code block that rides on every order.
//
// This is the whole revenue side of the integration, and every way it can go
// wrong is silent:
//
//   1. An unknown or empty code is accepted with a 200. Ondo does not validate
//      that the code exists at order time, so a typo or an unset env var costs
//      every fill from then on with no error anywhere.
//   2. A missing feeRateBpsFractional is a free fill, not a default rate. Ondo
//      holds no per-builder rate centrally, which the integration guide states
//      twice. Attribution without a rate earns nothing.
//   3. A rate above Ondo's 10 bps cap is not rejected when the order is placed.
//      Measured 2026-08-25: 25 bps passed request validation and reached the
//      margin check. Where it is enforced instead, if it is, is not documented.
//
//   4. feeRateBps, the integer form, is deprecated, and `deprecated_field` is a
//      live error code on POST /v1/perps/orders. Only the fractional field is
//      ever sent from here.
//
// So the guard is ours to write. It refuses to build a block it cannot stand
// behind rather than letting an order go out unattributed.
//
// Since guide v1.0.5 there is no other place to put this. The code used to be
// passed at get_challenge and baked into the JWT, which applied it to every
// subsequent order automatically. That flow is gone: LoginGetChallengeRequest
// in the live OpenAPI spec now carries only walletAddress and chainId. Every
// order and every position-level stop order has to name the code itself, and a
// stop order does not inherit it from the order that opened the position.

export class OndoBuilderCodeError extends Error {}

// Whether we are configured to earn anything at all. Reads as a plain boolean
// at a call site that wants to explain the state rather than fail on it.
export function builderCommissionEnabled(): boolean {
  return ONDO_BUILDER_CODE.trim().length > 0 && ONDO_BUILDER_FEE_BPS > 0;
}

// Attribution without a rate is deliberate and supported: it identifies Aeras
// as the routing venue on every fill while charging the user nothing, which is
// the default this ships with. Returns undefined only when there is no code at
// all, in which case the order still goes through, just anonymously.
export function builderCodeBlock(): OndoBuilderCode | undefined {
  const code = ONDO_BUILDER_CODE.trim();
  if (code.length === 0) return undefined;

  assertBuilderCode(code);

  if (ONDO_BUILDER_FEE_BPS <= 0) {
    return { code };
  }

  assertFeeRateBps(ONDO_BUILDER_FEE_BPS);
  return { code, feeRateBpsFractional: ONDO_BUILDER_FEE_BPS };
}

// Ondo does not document a character set for builder codes. This mirrors the
// one constraint they do document, on clientOrderId, and exists to catch a code
// mangled by shell quoting or a stray newline in an env file rather than to
// second-guess Ondo's format.
const BUILDER_CODE = /^[A-Za-z0-9_-]{1,64}$/;

export function assertBuilderCode(code: string): void {
  if (!BUILDER_CODE.test(code)) {
    throw new OndoBuilderCodeError(
      `Builder code ${JSON.stringify(code)} is not alphanumeric with underscores and dashes`,
    );
  }
}

export function assertFeeRateBps(bps: number): void {
  if (!Number.isFinite(bps) || bps < 0) {
    throw new OndoBuilderCodeError(`Builder fee rate must be a non-negative number, got ${bps}`);
  }
  if (bps > ONDO_BUILDER_MAX_FEE_BPS) {
    throw new OndoBuilderCodeError(
      `Builder fee rate ${bps} bps is above Ondo's ${ONDO_BUILDER_MAX_FEE_BPS} bps cap`,
    );
  }
}

// What the configured rate costs the user on a given order, so the number can
// be shown next to Ondo's own taker fee instead of arriving as a surprise on
// the fill. Both are charged against the USDC balance, which on a
// self-collateralized hedge means both accrue as debt.
export function builderFeeUsd(notionalUsd: number): number {
  if (!(notionalUsd > 0) || ONDO_BUILDER_FEE_BPS <= 0) return 0;
  return (notionalUsd * ONDO_BUILDER_FEE_BPS) / 10_000;
}
