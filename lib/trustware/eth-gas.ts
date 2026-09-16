"use client";

// Buying ETH for gas, for the venues that settle on Ethereum.
//
// The embedded EVM wallet is born with no ETH, and every Ethereum action costs
// some. The Morpho gold market and the Aave vaults both need the same thing
// before their first transaction: a small Solana USDC -> native ETH leg through
// Trustware, sized from the live gas price. This module is that leg, extracted
// from lib/morpho/gold-fund.ts (where it was written and measured) so the two
// venues size gas the same way and a fix lands in one place.
//
// What each venue supplies is its gas budget in units for one full lifecycle:
// enough to get in AND out, because a wallet with gas for the deposit but not
// the exit is the one state neither venue must create.
//
// Route measurements, live, 2026-08-26: Solana USDC -> native ETH quotes and
// routes via the 0xEeee sentinel only (the zero address 502s on Ethereum, the
// reverse of Monad). 20 USDC delivered 0.007778 ETH.

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { ETHEREUM_CHAIN_ID, ETHEREUM_NATIVE_TOKEN } from "@/lib/ethereum/constants";

import { atomicToUi, toNumberOrNull } from "./amounts";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
  TRUSTWARE_SOLANA_SLIPPAGE,
} from "./constants";
import {
  extractEstimate,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "./types";

export type QuoteFn = (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;

// One priced Trustware leg: the exact request /route will be called with (so
// the executed route matches the priced one) plus what the quote promised.
export interface TrustwareLeg {
  request: TrustwareQuoteRequest;
  sourceAmountAtomic: string;
  toAmountAtomic: string;
  // Guaranteed floor after slippage.
  toAmountMinAtomic: string;
  fromAmountUsd: number | null;
  toAmountUsd: number | null;
  totalFeesUsd: number | null;
}

// ── tolerances ─────────────────────────────────────────────────────────────

// Ethereum gas moves by an order of magnitude within a week, so both thresholds
// are multiples of a cycle at the CURRENT price rather than fixed ETH amounts.
// Top up when the wallet cannot cover a cycle at 1.5x today's price; top up to
// a cycle at 2.5x it. Measured 2026-08-26 at 0.058 gwei, a 700k-unit target is
// about 0.0001 ETH, which rounds to the 1 USDC minimum; at 20 gwei it is about
// $87, which is simply what this costs on mainnet that day.
const GAS_FLOOR_MULTIPLE = 15n; // 1.5x, in tenths
const GAS_TARGET_MULTIPLE = 25n; // 2.5x, in tenths

// What a gas top-up may spend before the plan refuses, as a fraction of the
// position being opened, with a floor.
//
// A fraction rather than a flat cap, because the same dollar figure is absurd
// and negligible at different sizes: $80 of gas on a $500 position is a bad
// trade whatever the gas price, and on a $50,000 position it is a rounding
// error. A flat cap set low enough to protect the first case would refuse the
// second at any ordinary gas price.
const MAX_GAS_FRACTION_BPS = 200n; // 2% of the position
const MIN_GAS_ALLOWANCE_USDC_ATOMIC = 25_000_000n; // $25

// Probe size for pricing USDC -> ETH before solving the real amount.
const GAS_PROBE_USDC_ATOMIC = 20_000_000n; // $20

// ── quoting ────────────────────────────────────────────────────────────────

export function quoteRequest(args: {
  fromChain: string;
  fromToken: string;
  toChain: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress: string;
  fromAmountUSD?: string;
}): TrustwareQuoteRequest {
  const sameChainSolana =
    args.fromChain === TRUSTWARE_SOLANA_CHAIN &&
    args.toChain === TRUSTWARE_SOLANA_CHAIN;
  return {
    ...args,
    // A Solana-to-Solana leg settles in a single Jupiter hop with no bridge, so
    // it takes the tight tolerance. Anything crossing a bridge keeps
    // Trustware's default.
    slippage: sameChainSolana
      ? TRUSTWARE_SOLANA_SLIPPAGE
      : TRUSTWARE_DEFAULT_SLIPPAGE,
    // Trustware rejects a Solana-sourced quote without a USD hint. It never
    // decides what a user gets.
  } as TrustwareQuoteRequest;
}

export async function priceLeg(
  request: TrustwareQuoteRequest,
  fetchQuote: QuoteFn,
): Promise<TrustwareLeg> {
  const res = await fetchQuote(request);
  const estimate = extractEstimate(res);
  if (!estimate?.toAmount) {
    throw new Error("Trustware returned no estimate for this conversion.");
  }
  // Not every route echoes a minimum. Derive the floor from the slippage rather
  // than sizing against the optimistic number.
  const toAmountMinAtomic =
    estimate.toAmountMin ??
    (
      (BigInt(estimate.toAmount) *
        BigInt(
          Math.round((100 - (request.slippage ?? TRUSTWARE_DEFAULT_SLIPPAGE)) * 100),
        )) /
      10_000n
    ).toString();
  return {
    request,
    sourceAmountAtomic: request.fromAmount,
    toAmountAtomic: estimate.toAmount,
    toAmountMinAtomic,
    fromAmountUsd: toNumberOrNull(estimate.fromAmountUsd),
    toAmountUsd: toNumberOrNull(estimate.toAmountUsd),
    totalFeesUsd: toNumberOrNull(estimate.totalFeesUsd),
  };
}

// ── gas ────────────────────────────────────────────────────────────────────

// What the wallet needs in ETH to complete `gasUnits` of transactions, at a
// multiple of the current gas price that leaves room for gas to rise before
// the exit.
export function requiredEthWei(gasPriceWei: string, gasUnits: bigint): bigint {
  return (gasUnits * BigInt(gasPriceWei || "0") * GAS_FLOOR_MULTIPLE) / 10n;
}

// True when the wallet cannot pay for a full cycle.
export function needsEthGas(
  ethBalanceAtomic: string,
  gasPriceWei: string,
  gasUnits: bigint,
): boolean {
  return BigInt(ethBalanceAtomic || "0") < requiredEthWei(gasPriceWei, gasUnits);
}

export type EthGasPlan =
  | { kind: "ok"; leg?: TrustwareLeg; costUsd: number | null }
  | { kind: "blocked"; reason: string };

// Price the ETH top-up, or say why it cannot be bought. Read-only.
export async function planEthGas(args: {
  ethBalanceAtomic: string;
  gasPriceWei: string;
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  evmAddress: string;
  // Gas units for one full lifecycle at this venue (in and out).
  gasUnits: bigint;
  // What the position being opened is worth. The gas allowance scales with it,
  // so a small position is protected from a gas bill that swamps it.
  positionValueUsd: number;
  fetchQuote: QuoteFn;
}): Promise<EthGasPlan> {
  if (!needsEthGas(args.ethBalanceAtomic, args.gasPriceWei, args.gasUnits)) {
    return { kind: "ok", costUsd: null };
  }

  const gasPrice = BigInt(args.gasPriceWei || "0");
  if (gasPrice <= 0n) {
    return {
      kind: "blocked",
      reason: "Could not read the Ethereum gas price. Try again shortly.",
    };
  }
  const targetWei =
    (args.gasUnits * gasPrice * GAS_TARGET_MULTIPLE) / 10n -
    BigInt(args.ethBalanceAtomic || "0");

  if (!args.solanaAddress) {
    return {
      kind: "blocked",
      reason:
        "Your Ethereum wallet has no ETH to pay gas, and no Solana wallet is available to buy some.",
    };
  }

  // Probe at a fixed size, then solve for the amount that delivers the target.
  // Same shape as the Monad gas leg, but the amount is derived rather than
  // constant, because Ethereum gas is not.
  const probeRequest = quoteRequest({
    fromChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: USDC_MINT,
    toChain: String(ETHEREUM_CHAIN_ID),
    toToken: ETHEREUM_NATIVE_TOKEN,
    fromAmount: GAS_PROBE_USDC_ATOMIC.toString(),
    fromAddress: args.solanaAddress,
    toAddress: args.evmAddress,
    fromAmountUSD: String(GAS_PROBE_USDC_ATOMIC / 1_000_000n),
  });
  let probe: TrustwareLeg;
  try {
    probe = await priceLeg(probeRequest, args.fetchQuote);
  } catch (err) {
    return {
      kind: "blocked",
      reason: `Could not price the Ethereum gas top-up. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    };
  }
  const deliveredPerProbe = BigInt(probe.toAmountMinAtomic);
  if (deliveredPerProbe <= 0n) {
    return {
      kind: "blocked",
      reason: "The Ethereum gas top-up did not return a usable rate.",
    };
  }

  // Solve, then round up to whole USDC so the number reads like a price.
  let requiredUsdc =
    (targetWei * GAS_PROBE_USDC_ATOMIC + deliveredPerProbe - 1n) / deliveredPerProbe;
  requiredUsdc = ((requiredUsdc + 999_999n) / 1_000_000n) * 1_000_000n;

  // The allowance scales with the position, floored so a small but sensible
  // position is not blocked by a rounding-error gas bill.
  const fractionAllowance =
    (BigInt(Math.max(0, Math.round(args.positionValueUsd * 1e6))) *
      MAX_GAS_FRACTION_BPS) /
    10_000n;
  const allowance =
    fractionAllowance > MIN_GAS_ALLOWANCE_USDC_ATOMIC
      ? fractionAllowance
      : MIN_GAS_ALLOWANCE_USDC_ATOMIC;

  if (requiredUsdc > allowance) {
    const gwei = Number(gasPrice) / 1e9;
    return {
      kind: "blocked",
      reason: `Ethereum gas is around ${gwei < 1 ? gwei.toFixed(2) : gwei.toFixed(0)} gwei right now, so this position would cost about $${atomicToUi(requiredUsdc.toString(), USDC_DECIMALS)} in gas to open and close. That is too much against a $${args.positionValueUsd.toFixed(0)} position, so nothing was sent. A larger position, or cheaper gas, makes this worth doing.`,
    };
  }
  if (requiredUsdc > BigInt(args.solanaUsdcAtomic || "0")) {
    return {
      kind: "blocked",
      reason: `Your Ethereum wallet needs about $${atomicToUi(requiredUsdc.toString(), USDC_DECIMALS)} of ETH for gas, but your Solana wallet holds only ${atomicToUi(args.solanaUsdcAtomic || "0", USDC_DECIMALS)} USDC.`,
    };
  }

  // Re-quote at the solved size: the probe priced a different amount, so its
  // figures do not describe what would actually run.
  let leg: TrustwareLeg;
  try {
    leg = await priceLeg(
      quoteRequest({
        ...probeRequest,
        fromAmount: requiredUsdc.toString(),
        fromAmountUSD: String(requiredUsdc / 1_000_000n),
      }),
      args.fetchQuote,
    );
  } catch (err) {
    return {
      kind: "blocked",
      reason: `Could not price the Ethereum gas top-up. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    };
  }

  return {
    kind: "ok",
    leg,
    costUsd: Number(requiredUsdc) / 10 ** USDC_DECIMALS,
  };
}
