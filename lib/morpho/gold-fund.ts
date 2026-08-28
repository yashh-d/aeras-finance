"use client";

// Turn gold a user already holds into XAUt on Ethereum, so it can be posted as
// collateral in the Morpho Blue gold market.
//
// The shape mirrors lib/morpho/fund.ts (plan first, price every leg, broadcast,
// track, confirm arrival) but three things differ enough to be worth stating up
// front, because each one is a trap the Monad path does not have:
//
//   1. **The conversion is a sale, not a bridge.** GLDx, GLDon and XAUt are
//      different tokens denominated in different amounts of gold. Nothing here
//      is 1:1 with anything else, so the plan bounds value loss instead of
//      solving for a delivered amount. See lib/morpho/gold-sources.ts.
//
//   2. **Value is checked against the market's own oracle, never a registry.**
//      Trustware's token registry prices Ethereum GLDx at $7,160 against a real
//      sale price near $425. Registry prices are decoration. The delivered side
//      is valued at the Morpho oracle we already read on-chain (measured within
//      0.42% of a live market quote), and the source side at what it actually
//      sells for. Same conclusion lib/ondo/fund.ts reached by a different road.
//
//   3. **Gas is real money and is sized live.** Every Morpho action is an
//      Ethereum mainnet transaction, and the embedded wallet is born with no
//      ETH. Unlike Monad's fixed 0.5 USDC top-up, this one is computed from the
//      current gas price and refuses above a dollar cap, because the honest
//      answer when gas spikes is "not today", not a silent $200 spend.
//
// Route measurements, live, 2026-08-26:
//   Solana USDC -> XAUt (Ethereum)         works, ~0.4% all-in
//   Solana USDC -> native ETH (Ethereum)   works, via the 0xEeee sentinel ONLY
//   GLDx / GLDon / XAUt0 (Solana) -> USDC  works, 0.3%
//   GLDx / GLDon / XAUt0 (Solana) -> XAUt  502 (the solver cannot compose two
//                                          legs it runs individually; reported
//                                          upstream)
//   GLDx / GLDon (Ethereum, BNB) -> any    502 in every direction, which reads
//                                          as no DEX liquidity for those
//                                          wrappers off Solana
//
// So the two-hop path is what runs today and the direct path is preferred the
// moment it starts quoting. planGoldFunding tries direct first every time; no
// code change is needed when the upstream fix lands.

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { awaitTokenBalance } from "@/lib/solana/await-balance";
import { atomicToUi, toNumberOrNull } from "@/lib/trustware/amounts";
import {
  fetchTrustwareQuoteViaProxy,
  fetchTrustwareRouteViaProxy,
} from "@/lib/trustware/client";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
  TRUSTWARE_SOLANA_SLIPPAGE,
} from "@/lib/trustware/constants";
import {
  executeEvmRoute,
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type EvmSigner,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "@/lib/trustware/types";

import {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_NATIVE_TOKEN,
  XAUT,
} from "./gold-market";
import type { GoldCollateralSource } from "./gold-sources";

export type { EvmSigner, SolanaSigner } from "@/lib/trustware/execute";

// ── tolerances ─────────────────────────────────────────────────────────────

// How much value a conversion may destroy before the plan refuses.
//
// Tighter than lib/ondo/fund.ts's 10%, and deliberately so: that bound covers
// illiquid single-name equity wrappers where SNDKon really does route at half
// its mark. Gold is the most liquid thing in this app. Measured costs are 0.3%
// to 0.4% per hop, so a two-hop conversion should land near 0.8%; 3% is roughly
// four times the expected cost, which leaves room for a volatile hour without
// leaving room for a bad route.
const MAX_GOLD_FUNDING_LOSS_BPS = 300;

// Gas units for one full borrow lifecycle on Ethereum, measured against typical
// Morpho Blue costs: ERC-20 approve (~50k), supplyCollateral (~130k), borrow
// (~160k), the USDT approve pair a repayment needs (~2x50k, see gold-borrow.ts),
// repay (~120k) and withdrawCollateral (~120k).
//
// Sized for a whole cycle rather than only the entry, because a borrower with
// gas for the deposit but not the repayment is in the one state this venue must
// not create: unable to act as their position approaches liquidation.
const GAS_UNITS_FULL_CYCLE = 700_000n;

// Ethereum gas moves by an order of magnitude within a week, so both thresholds
// are multiples of a cycle at the CURRENT price rather than fixed ETH amounts.
// Top up when the wallet cannot cover a cycle at double today's price; top up to
// a cycle at two and a half times it. Measured 2026-08-26 at 0.058 gwei, that
// target is about 0.0001 ETH, which rounds to the 1 USDC minimum; at 20 gwei it
// is about $87, which is simply what this costs on mainnet that day.
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

// How long to wait for delivered funds to become readable after Trustware
// reports success. The destination transaction has already mined by then; this
// only covers RPC read lag.
const ARRIVAL_TIMEOUT_MS = 90_000;
const ARRIVAL_POLL_MS = 3_000;

// ── plan types ─────────────────────────────────────────────────────────────

export interface GoldRouteLeg {
  // The exact request /route will be called with, so the executed route matches
  // the priced one.
  request: TrustwareQuoteRequest;
  sourceAmountAtomic: string;
  toAmountAtomic: string;
  // Guaranteed floor after slippage.
  toAmountMinAtomic: string;
  fromAmountUsd: number | null;
  toAmountUsd: number | null;
  totalFeesUsd: number | null;
}

export type GoldCollateralRoute =
  // One hop, source straight to XAUt on Ethereum. Preferred whenever it quotes.
  | { mode: "direct"; leg: GoldRouteLeg }
  // Two hops: sell the source for Solana USDC, then buy XAUt with the proceeds.
  // The second leg is priced against the first leg's GUARANTEED MINIMUM, so the
  // plan never promises more than the worst case delivers, and it is re-routed
  // at execution time against the USDC that actually arrived.
  | { mode: "via-usdc"; sell: GoldRouteLeg; buy: GoldRouteLeg };

export interface GoldFundingReady {
  kind: "ready";
  route: GoldCollateralRoute;
  // Present when the wallet cannot pay Ethereum gas for a full borrow cycle.
  gas?: GoldRouteLeg;
  // XAUt expected and guaranteed, 6-decimal atomic.
  expectedXautAtomic: string;
  minXautAtomic: string;
  // Both sides valued the honest way: the source at what it sells for, the
  // delivered XAUt at the Morpho oracle. Never at a registry price.
  sourceValueUsd: number;
  deliveredValueUsd: number;
  lossBps: number;
  // What the gas top-up costs, USD. Null when no top-up is needed.
  gasCostUsd: number | null;
}

export type GoldFundingPlan =
  | GoldFundingReady
  | { kind: "blocked"; reason: string };

type QuoteFn = (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;

// ── quoting ────────────────────────────────────────────────────────────────

function quoteRequest(args: {
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
    // Trustware rejects a Solana-sourced quote without a USD hint. This is the
    // only thing approxUnitUsd is used for; it never decides what a user gets.
  } as TrustwareQuoteRequest;
}

async function priceLeg(
  request: TrustwareQuoteRequest,
  fetchQuote: QuoteFn,
): Promise<GoldRouteLeg> {
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

// XAUt atomic units valued at the market's own oracle. This is the only
// valuation in this module that is trusted, because it is the same number the
// liquidation check uses.
function xautToUsd(xautAtomic: bigint, oracleUnitPrice: number): number {
  return (Number(xautAtomic) / 10 ** XAUT.decimals) * oracleUnitPrice;
}

// ── planning ───────────────────────────────────────────────────────────────

// Price everything a collateral deposit needs. Read-only: signs nothing, moves
// nothing, and every failure comes back as a readable reason rather than a
// throw, so the form can render it.
export async function planGoldFunding(args: {
  source: GoldCollateralSource;
  // How much of the source to convert, in the source's atomic units.
  sourceAmountAtomic: bigint;
  solanaAddress: string | undefined;
  evmAddress: string;
  // The user's Solana USDC, which pays for the gas top-up.
  solanaUsdcAtomic: string;
  // Ethereum wallet state, from /api/morpho/gold-position.
  ethBalanceAtomic: string;
  gasPriceWei: string;
  // One XAUt in USDT at the Morpho oracle, from /api/morpho/gold-market.
  oracleUnitPrice: number;
  fetchQuote?: QuoteFn;
}): Promise<GoldFundingPlan> {
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;
  const { source } = args;

  if (args.sourceAmountAtomic <= 0n) {
    return { kind: "blocked", reason: "Enter an amount above zero." };
  }
  if (source.kind === "solana" && !args.solanaAddress) {
    return {
      kind: "blocked",
      reason: "No Solana wallet is available to convert from.",
    };
  }
  if (args.oracleUnitPrice <= 0) {
    return {
      kind: "blocked",
      reason: "The gold market's oracle price is unavailable. Try again shortly.",
    };
  }

  const sourceAddress =
    source.kind === "solana" ? args.solanaAddress! : args.evmAddress;
  const fromAmountUSD = String(
    Math.max(
      1,
      Math.round(
        (Number(args.sourceAmountAtomic) / 10 ** source.decimals) *
          source.approxUnitUsd,
      ),
    ),
  );

  // ── the collateral route ─────────────────────────────────────────────────
  //
  // Direct first, always. It is one signature instead of two and one bridge
  // instead of one bridge plus a swap, so the day Trustware can solve it, it
  // wins with no code change.
  let route: GoldCollateralRoute | null = null;
  let directError = "";
  try {
    const leg = await priceLeg(
      quoteRequest({
        fromChain: source.chain,
        fromToken: source.token,
        toChain: String(ETHEREUM_CHAIN_ID),
        toToken: XAUT.address,
        fromAmount: args.sourceAmountAtomic.toString(),
        fromAddress: sourceAddress,
        toAddress: args.evmAddress,
        fromAmountUSD,
      }),
      fetchQuote,
    );
    route = { mode: "direct", leg };
  } catch (err) {
    directError = err instanceof Error ? err.message : String(err);
  }

  // Fall back to selling for Solana USDC and buying XAUt with the proceeds.
  // Only available when the sale can land in a Solana wallet we can then spend
  // from, which is why an EVM source with no Solana wallet stops here.
  if (!route) {
    if (!args.solanaAddress) {
      return {
        kind: "blocked",
        reason: `There is no route from ${source.symbol} on ${source.chainLabel} to XAUt, and no Solana wallet is available for the two-step conversion.`,
      };
    }
    let sell: GoldRouteLeg;
    try {
      sell = await priceLeg(
        quoteRequest({
          fromChain: source.chain,
          fromToken: source.token,
          toChain: TRUSTWARE_SOLANA_CHAIN,
          toToken: USDC_MINT,
          fromAmount: args.sourceAmountAtomic.toString(),
          fromAddress: sourceAddress,
          toAddress: args.solanaAddress,
          fromAmountUSD,
        }),
        fetchQuote,
      );
    } catch (err) {
      // Both hops failed. For GLDx and GLDon on Ethereum and BNB this is the
      // expected answer, not an outage: those wrappers have no route in any
      // direction off Solana. Say what the user can do instead of blaming the
      // network.
      return {
        kind: "blocked",
        reason:
          source.kind === "evm"
            ? `${source.symbol} on ${source.chainLabel} has no conversion route right now. Gold held on Solana (GLDx, GLDon or XAUt0) can fund this position today.`
            : `Could not price a conversion from ${source.symbol}. ${
                err instanceof Error ? err.message : "Try again shortly."
              }`,
      };
    }

    // Price hop 2 against hop 1's guaranteed MINIMUM, never its expected
    // amount. The plan then understates the outcome slightly, which is the
    // right direction: execution re-routes against the USDC that actually
    // arrived and can only do better.
    let buy: GoldRouteLeg;
    try {
      buy = await priceLeg(
        quoteRequest({
          fromChain: TRUSTWARE_SOLANA_CHAIN,
          fromToken: USDC_MINT,
          toChain: String(ETHEREUM_CHAIN_ID),
          toToken: XAUT.address,
          fromAmount: sell.toAmountMinAtomic,
          fromAddress: args.solanaAddress,
          toAddress: args.evmAddress,
          fromAmountUSD: String(
            Math.max(1, Math.round(Number(sell.toAmountMinAtomic) / 10 ** USDC_DECIMALS)),
          ),
        }),
        fetchQuote,
      );
    } catch (err) {
      return {
        kind: "blocked",
        reason: `Could not price the USDC to XAUt leg. ${
          err instanceof Error ? err.message : "Try again shortly."
        }`,
      };
    }
    route = { mode: "via-usdc", sell, buy };
  }

  const finalLeg = route.mode === "direct" ? route.leg : route.buy;
  const expectedXaut = BigInt(finalLeg.toAmountAtomic);
  const minXaut = BigInt(finalLeg.toAmountMinAtomic);
  if (expectedXaut <= 0n) {
    return {
      kind: "blocked",
      reason: "The conversion did not return a usable rate. Try again shortly.",
    };
  }

  // ── the value check ──────────────────────────────────────────────────────
  //
  // Delivered value comes from the Morpho oracle. Source value comes from what
  // the source actually sells for: on the two-hop path that is the USDC hop 1
  // delivers, which is a real executable number. On the direct path there is no
  // such intermediate, so Trustware's own USD figure is the only source-side
  // number available; the delivered side is still oracle-priced, so a bad
  // registry price can make this check conservative but never permissive.
  const deliveredValueUsd = xautToUsd(minXaut, args.oracleUnitPrice);
  const sourceValueUsd =
    route.mode === "via-usdc"
      ? Number(route.sell.toAmountMinAtomic) / 10 ** USDC_DECIMALS
      : (finalLeg.fromAmountUsd ??
        (Number(args.sourceAmountAtomic) / 10 ** source.decimals) *
          source.approxUnitUsd);

  if (sourceValueUsd <= 0) {
    return {
      kind: "blocked",
      reason: "Could not value this conversion. Try again shortly.",
    };
  }
  const lossBps = Math.round(
    ((sourceValueUsd - deliveredValueUsd) / sourceValueUsd) * 10_000,
  );
  if (lossBps > MAX_GOLD_FUNDING_LOSS_BPS) {
    return {
      kind: "blocked",
      reason: `Converting ${source.symbol} into XAUt would lose about ${(lossBps / 100).toFixed(1)}% of its value right now (about $${(sourceValueUsd - deliveredValueUsd).toFixed(2)}). That is above the ${MAX_GOLD_FUNDING_LOSS_BPS / 100}% limit, so nothing was sent. Try a different amount or come back later.`,
    };
  }

  // ── the gas top-up ───────────────────────────────────────────────────────
  const gasPlan = await planEthGas({
    ethBalanceAtomic: args.ethBalanceAtomic,
    gasPriceWei: args.gasPriceWei,
    solanaUsdcAtomic: args.solanaUsdcAtomic,
    solanaAddress: args.solanaAddress,
    evmAddress: args.evmAddress,
    positionValueUsd: deliveredValueUsd,
    fetchQuote,
  });
  if (gasPlan.kind === "blocked") return gasPlan;

  // The direct route's failure is kept off the plan on purpose. It is upstream
  // diagnostic noise ("Trustware proxy failed: 502"), and surfacing it would
  // make a conversion that is about to work look broken. It goes to the console
  // for whoever is debugging, and to scripts/morpho-gold-check.mts for whoever
  // is deciding whether to chase Trustware about it.
  if (directError) {
    console.info(
      "[gold funding] direct source -> XAUt route unavailable, using the USDC fallback:",
      directError,
    );
  }

  return {
    kind: "ready",
    route,
    gas: gasPlan.leg,
    expectedXautAtomic: expectedXaut.toString(),
    minXautAtomic: minXaut.toString(),
    sourceValueUsd,
    deliveredValueUsd,
    lossBps,
    gasCostUsd: gasPlan.costUsd,
  };
}

// ── gas ────────────────────────────────────────────────────────────────────

// What the wallet needs in ETH to complete a full borrow cycle, at a multiple of
// the current gas price that leaves room for gas to rise before the exit.
export function requiredEthWei(gasPriceWei: string): bigint {
  return (GAS_UNITS_FULL_CYCLE * BigInt(gasPriceWei || "0") * GAS_FLOOR_MULTIPLE) / 10n;
}

// True when the wallet cannot pay for a full cycle. Exported for the card's
// hint copy.
export function needsEthGas(
  ethBalanceAtomic: string,
  gasPriceWei: string,
): boolean {
  return BigInt(ethBalanceAtomic || "0") < requiredEthWei(gasPriceWei);
}

type GasPlan =
  | { kind: "ok"; leg?: GoldRouteLeg; costUsd: number | null }
  | { kind: "blocked"; reason: string };

async function planEthGas(args: {
  ethBalanceAtomic: string;
  gasPriceWei: string;
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  evmAddress: string;
  // What the position being opened is worth. The gas allowance scales with it,
  // so a small position is protected from a gas bill that swamps it.
  positionValueUsd: number;
  fetchQuote: QuoteFn;
}): Promise<GasPlan> {
  if (!needsEthGas(args.ethBalanceAtomic, args.gasPriceWei)) {
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
    (GAS_UNITS_FULL_CYCLE * gasPrice * GAS_TARGET_MULTIPLE) / 10n -
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
  let probe: GoldRouteLeg;
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
  let leg: GoldRouteLeg;
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

// ── execution ──────────────────────────────────────────────────────────────

export type GoldFundStage =
  | "gas"
  | "selling"
  | "buying"
  | "bridging"
  | "confirming"
  | "done";

export interface GoldFundProgress {
  stage: GoldFundStage;
  message: string;
  txHash?: string;
}

type Report = (p: GoldFundProgress) => void;

// Route one leg whose source is on Solana, sign it, and hand Trustware the
// hash. Settlement tracking is deliberately separate so independent legs can
// bridge at the same time.
async function broadcastSolanaLeg(args: {
  leg: GoldRouteLeg;
  minDeliveredAtomic: bigint;
  describe: string;
  solana: SolanaSigner;
  report: Report;
  signal?: AbortSignal;
}): Promise<string> {
  const routeRes = await fetchTrustwareRouteViaProxy(args.leg.request);
  const intentId = extractIntentId(routeRes);
  const transaction = extractExecution(routeRes)?.transaction;
  if (!intentId) throw new Error("Trustware returned no intent to track.");
  // For a Solana source the payload is a base64 transaction in `data` alone.
  // Anything hex-shaped is an EVM transaction that cannot be signed here.
  if (!transaction?.data || transaction.data.startsWith("0x")) {
    throw new Error("Trustware returned no signable Solana transaction.");
  }

  // The last free abort point: the fresh route must still clear the floor the
  // plan promised, before the user commits anything.
  const estimate = extractEstimate(routeRes);
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
  if (
    args.minDeliveredAtomic > 0n &&
    guaranteed &&
    BigInt(guaranteed) < args.minDeliveredAtomic
  ) {
    throw new Error(
      `The ${args.describe} rate moved and no longer covers this conversion. Try again for a fresh quote.`,
    );
  }

  const hash = await args.solana.signAndSendBase64(transaction.data);
  // Submit immediately after broadcast. Without this Trustware cannot track a
  // route the user has already paid for.
  await submitTrustwareReceipt(intentId, hash, args.signal);
  return intentId;
}

// Watch one intent to settlement, re-reporting progress on each poll.
//
// Trustware surfaces one stall worth naming rather than hiding behind a generic
// "bridging": a route that has landed on the source side but cannot pay for the
// destination transaction. It resolves itself, and saying so beats a progress
// bar that appears stuck.
function trackLeg(
  intentId: string,
  signal: AbortSignal | undefined,
  report: Report,
  message: string,
) {
  return trackTrustwareSettlement(intentId, signal, (status) =>
    report({
      stage: "bridging",
      message:
        status.data?.gas_status === "needs_gas"
          ? "The route stalled waiting for destination gas. Trustware is retrying."
          : message,
    }),
  );
}

// Read the wallet's Ethereum XAUt balance until it reflects the delivery.
async function awaitXaut(args: {
  evmAddress: string;
  atLeastAtomic: bigint;
  signal?: AbortSignal;
}): Promise<bigint> {
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  let last = 0n;
  for (;;) {
    if (args.signal?.aborted) return last;
    try {
      const res = await fetch(
        `/api/morpho/gold-position?address=${encodeURIComponent(args.evmAddress)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const { collateralBalanceAtomic } = (await res.json()) as {
          collateralBalanceAtomic?: string;
        };
        last = BigInt(collateralBalanceAtomic ?? "0");
        if (last >= args.atLeastAtomic) return last;
      }
    } catch {
      // Transient read failure; the next poll retries.
    }
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, ARRIVAL_POLL_MS));
  }
}

// Execute a funding plan. Returns the XAUt now sitting in the user's Ethereum
// wallet, ready to be supplied as collateral.
//
// Nothing here treats funds as delivered before Trustware reports success, and
// every validation that can happen before a signature does.
export async function executeGoldFunding(args: {
  plan: GoldFundingReady;
  source: GoldCollateralSource;
  evmAddress: string;
  solanaAddress: string | undefined;
  // Required whenever any leg starts on Solana, which today is every path.
  solana: SolanaSigner | undefined;
  // Required only when the source is on an EVM chain.
  evm: EvmSigner | undefined;
  // Wallet XAUt before funding, so the arrival check measures the delta rather
  // than an absolute the user may already have exceeded.
  xautBeforeAtomic: string;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ xautDeliveredAtomic: string }> {
  const report: Report = (p) => args.onProgress?.(p);
  const { plan } = args;
  const before = BigInt(args.xautBeforeAtomic || "0");

  // The gas leg is independent of the collateral legs, so it goes first and
  // bridges while the rest proceeds. It is always Solana-sourced.
  let gasIntent: string | undefined;
  if (plan.gas) {
    if (!args.solana) {
      throw new Error("No Solana wallet is available to buy Ethereum gas.");
    }
    report({
      stage: "gas",
      message: `Buying about $${plan.gasCostUsd?.toFixed(2)} of ETH for Ethereum gas.`,
    });
    gasIntent = await broadcastSolanaLeg({
      leg: plan.gas,
      minDeliveredAtomic: 0n,
      describe: "gas",
      solana: args.solana,
      report,
      signal: args.signal,
    });
  }

  if (plan.route.mode === "direct") {
    report({
      stage: "buying",
      message: `Converting ${args.source.symbol} into XAUt on Ethereum.`,
    });
    if (args.source.kind === "solana") {
      if (!args.solana) throw new Error("No Solana wallet is available.");
      const intent = await broadcastSolanaLeg({
        leg: plan.route.leg,
        minDeliveredAtomic: BigInt(plan.minXautAtomic),
        describe: "XAUt",
        solana: args.solana,
        report,
        signal: args.signal,
      });
      const bridging = "Bridging to Ethereum. This can take a few minutes.";
      report({ stage: "bridging", message: bridging });
      await Promise.all(
        [intent, gasIntent]
          .filter((id): id is string => Boolean(id))
          .map((id) => trackLeg(id, args.signal, report, bridging)),
      );
    } else {
      if (!args.evm) throw new Error("No Ethereum wallet is available.");
      await executeEvmRoute({
        request: plan.route.leg.request,
        evm: args.evm,
        describe: "XAUt",
        minDeliveredAtomic: BigInt(plan.minXautAtomic),
        onProgress: (p) =>
          report({ stage: "bridging", message: p.message, txHash: p.sourceTxHash }),
        signal: args.signal,
      });
      if (gasIntent) {
        await trackLeg(gasIntent, args.signal, report, "Bridging the ETH gas top-up.");
      }
    }
  } else {
    // ── hop 1: sell the source for Solana USDC ─────────────────────────────
    if (!args.solanaAddress) {
      throw new Error("No Solana wallet is available for this conversion.");
    }
    report({
      stage: "selling",
      message: `Selling ${atomicToUi(plan.route.sell.sourceAmountAtomic, args.source.decimals)} ${args.source.symbol} for USDC.`,
    });

    // Measure the USDC delta rather than an absolute: the wallet may already
    // hold USDC, and the gas leg spends some of it.
    const usdcBefore = await readSolanaUsdc(args.solanaAddress);

    if (args.source.kind === "solana") {
      if (!args.solana) throw new Error("No Solana wallet is available.");
      const intent = await broadcastSolanaLeg({
        leg: plan.route.sell,
        minDeliveredAtomic: BigInt(plan.route.sell.toAmountMinAtomic),
        describe: "USDC",
        solana: args.solana,
        report,
        signal: args.signal,
      });
      await trackLeg(intent, args.signal, report, "Selling for USDC on Solana.");
    } else {
      if (!args.evm) throw new Error("No Ethereum wallet is available.");
      await executeEvmRoute({
        request: plan.route.sell.request,
        evm: args.evm,
        describe: "USDC",
        minDeliveredAtomic: BigInt(plan.route.sell.toAmountMinAtomic),
        onProgress: (p) => report({ stage: "selling", message: p.message }),
        signal: args.signal,
      });
    }

    report({ stage: "confirming", message: "Confirming the USDC arrived on Solana." });
    const target = usdcBefore + BigInt(plan.route.sell.toAmountMinAtomic);
    const usdcAfter = await awaitTokenBalance({
      mint: USDC_MINT,
      owner: args.solanaAddress,
      atLeastAtomic: target.toString(),
      programId: TOKEN_PROGRAM_ID,
      timeoutMs: ARRIVAL_TIMEOUT_MS,
      signal: args.signal,
    });
    const proceeds = BigInt(usdcAfter) - usdcBefore;
    if (proceeds <= 0n) {
      // The bridge settled, so the money is in the user's wallet even if the
      // read has not caught up. Say so rather than implying a loss.
      throw new Error(
        "The sale settled but the Solana balance read has not caught up. Your funds are safe. Try again in a moment to finish buying XAUt.",
      );
    }

    // ── hop 2: buy XAUt with what actually arrived ─────────────────────────
    //
    // Re-priced against the real proceeds rather than reusing the planned leg,
    // which was sized against hop 1's guaranteed minimum. The user is better
    // off whenever hop 1 beat its floor, which is the usual case.
    if (!args.solana) throw new Error("No Solana wallet is available.");
    report({ stage: "buying", message: "Buying XAUt on Ethereum." });
    const buy = await priceLeg(
      quoteRequest({
        fromChain: TRUSTWARE_SOLANA_CHAIN,
        fromToken: USDC_MINT,
        toChain: String(ETHEREUM_CHAIN_ID),
        toToken: XAUT.address,
        fromAmount: proceeds.toString(),
        fromAddress: args.solanaAddress,
        toAddress: args.evmAddress,
        fromAmountUSD: String(
          Math.max(1, Math.round(Number(proceeds) / 10 ** USDC_DECIMALS)),
        ),
      }),
      fetchTrustwareQuoteViaProxy,
    );
    const intent = await broadcastSolanaLeg({
      leg: buy,
      minDeliveredAtomic: 0n,
      describe: "XAUt",
      solana: args.solana,
      report,
      signal: args.signal,
    });
    const bridging = "Bridging to Ethereum. This can take a few minutes.";
    report({ stage: "bridging", message: bridging });
    await Promise.all(
      [intent, gasIntent]
        .filter((id): id is string => Boolean(id))
        .map((id) => trackLeg(id, args.signal, report, bridging)),
    );
  }

  report({ stage: "confirming", message: "Confirming the XAUt arrived on Ethereum." });
  const after = await awaitXaut({
    evmAddress: args.evmAddress,
    atLeastAtomic: before + BigInt(plan.minXautAtomic),
    signal: args.signal,
  });
  const delivered = after > before ? after - before : 0n;
  if (delivered <= 0n) {
    throw new Error(
      "The XAUt is on Ethereum but the balance read has not caught up. Your funds are safe. Try again in a moment to supply it as collateral.",
    );
  }
  report({
    stage: "done",
    message: `${atomicToUi(delivered.toString(), XAUT.decimals)} XAUt arrived on Ethereum.`,
  });
  return { xautDeliveredAtomic: delivered.toString() };
}

// One fresh read of the Solana USDC balance.
//
// awaitTokenBalance with a target of zero is a one-shot read: the first
// successful poll clears the threshold and returns. The only case that waits is
// a missing token account, which reads as zero after the short timeout, and
// that is the right answer anyway.
//
// Returns 0 on failure. This is only ever used as the baseline of a delta, so a
// zero baseline makes the measured proceeds larger, never smaller, and the
// arrival check that follows is what actually gates the next hop.
async function readSolanaUsdc(owner: string): Promise<bigint> {
  try {
    const balance = await awaitTokenBalance({
      mint: USDC_MINT,
      owner,
      atLeastAtomic: "0",
      programId: TOKEN_PROGRAM_ID,
      timeoutMs: 5_000,
    });
    return BigInt(balance);
  } catch {
    return 0n;
  }
}
