"use client";

// Bringing a withdrawn Ondo collateral token home to Solana.
//
// **The rule this module exists to enforce: an Ondo asset belongs on Solana
// unless it is actively posted on Ondo Perps as margin for a trade or a hedge.**
// Ethereum is a waypoint, not a home. A token sitting in the embedded EVM
// wallet is doing nothing: it earns no yield, backs no position, cannot be lent
// on Kamino or Jupiter, and cannot be sold without another bridge. The same
// asset as a Solana xStock is tradeable on Jupiter and usable everywhere else
// in this app. So the default state after a withdrawal is "on its way back",
// and any surface that shows an Ondo token on Ethereum should offer the way
// home rather than presenting it as a settled position.
//
// The conversion is never automatic. It needs two Ethereum signatures and costs
// real money, so it is always the user's decision; the default is about what
// the app *offers*, not what it does behind their back.
//
// The third and last leg of the exit, and the one that makes the other two
// visible. `lib/ondo/withdraw.ts` gets the asset out of Ondo's custody, but it
// lands on Ethereum as an ERC-20, and **nothing in this app can display that**:
// the wallet scan filters cross-chain holdings through the equivalence registry
// in lib/trustware/equivalents.ts, every entry there is keyed to a Jupiter Lend
// borrow vault, and only TSLAx, SPYx, QQQx and NVDAx have one. SPCX does not, so
// a withdrawn SPCXon is real, confirmed on chain, and invisible on every screen.
//
// Converting it back to the canonical Solana xStock fixes that as a side effect
// rather than by special-casing the display: SPCXx is an ordinary curated
// holding the Portfolio already reads, prices and charts.
//
// **This leg needs ETH, unlike the two before it.** The deposit path avoids gas
// by pointing the bridge at Ondo's own deposit address, and the withdrawal is
// broadcast and paid for by Ondo. Here the user's own wallet has to sign an
// approve and a route call on Ethereum mainnet. The mirror of the deposit trick
// does not exist: Trustware's deposit-address routing is squid-only and squid
// does not carry the Ondo tokens, measured 2026-08-26:
//
//   POST /api/v1/routes/deposit-address
//   -> "Token is not supported for fromChain: 1 fromToken: 0xc9ee..."
//
// At the 0.125 gwei measured the same day, approve plus the LI.FI call is about
// $0.14. That is cheap now and was not always, so the gas check below reads a
// live estimate rather than trusting a constant.

import { xstockBySymbol } from "@/lib/jupiter/xstocks";
import { atomicToUi, toNumberOrNull } from "@/lib/trustware/amounts";
import { fetchTrustwareQuoteViaProxy } from "@/lib/trustware/client";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
} from "@/lib/trustware/constants";
import {
  executeEvmRoute,
  type ConversionProgress,
  type EvmSigner,
} from "@/lib/trustware/execute";
import {
  extractEstimate,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "@/lib/trustware/types";

import type { OndoCollateral } from "./collateral";
import { selfCollateralizingRoutes } from "./hedge";

// Ondo credits and returns collateral on Ethereum only.
const ETHEREUM_CHAIN = "1";

// Gas the wallet must hold before this is offered, as a multiple of the
// estimated cost. Approve plus a bridge call is roughly 446k gas; 3x absorbs a
// price spike between the estimate and the second signature, which matters
// because running out of gas *between* the approve and the route call leaves an
// allowance granted and nothing bridged.
const GAS_SAFETY_MULTIPLE = 3;

// Rough gas for the two transactions, used only to size the balance check.
// The approve is ~46k and a LI.FI/Mayan bridge call ~400k, both measured.
const ESTIMATED_GAS_UNITS = 446_000n;

// The same soft bound the deposit path uses, and for the same reason: the cost
// here is the spread between two thin markets, not the bridge. Measured
// 2026-08-26, SPCXon -> SPCXx delivered $18.07 on $18.83, about 400 bps at that
// size. Small balances are simply expensive to move and the user has to see the
// number rather than have it refused or hidden.
export const MAX_UNWIND_LOSS_BPS = 150;

// No override above this. Nothing at this level is a spread.
export const HARD_MAX_UNWIND_LOSS_BPS = 1_000;

export interface UnwindTarget {
  // The Ondo token on Ethereum, e.g. SPCXon.
  collateralSymbol: string;
  contractAddress: string;
  decimals: number;
  // The canonical Solana xStock it becomes, e.g. SPCXx.
  xstockSymbol: string;
  mint: string;
  xstockDecimals: number;
}

// Which Solana xStock an Ondo collateral token converts back into.
//
// Read through the hedge route table rather than a second mapping, so one place
// decides that SPCXon corresponds to SPCXx. That table is also what decides
// which xStock can be posted as its own margin, so the two directions cannot
// drift apart.
//
// Deliberately NOT the Trustware equivalence registry: that one is keyed to
// Jupiter Lend borrow vaults and therefore cannot represent SPCX at all, which
// is the whole reason a withdrawn SPCXon is invisible today.
export function unwindTargetFor(
  collateralSymbol: string,
): UnwindTarget | undefined {
  const route = selfCollateralizingRoutes().find(
    (r) => r.collateralSymbol === collateralSymbol,
  );
  if (!route) return undefined;

  const xstock = xstockBySymbol(route.xstockSymbol);
  if (!xstock) return undefined;

  return {
    collateralSymbol,
    // Filled by the caller from the live token config, never hardcoded.
    contractAddress: "",
    decimals: 18,
    xstockSymbol: xstock.symbol,
    mint: xstock.mint,
    xstockDecimals: xstock.decimals,
  };
}

export interface UnwindPlan {
  kind: "ready";
  target: UnwindTarget;
  amountAtomic: string;
  // What lands on Solana, at the xStock's own decimals.
  deliveredAtomic: string;
  deliveredMinAtomic: string;
  deliveredTokens: string;
  deliveredValueUsd: number | null;
  inputValueUsd: number | null;
  lossBps: number | null;
  bridgeFeesUsd: number | null;
  // Native ETH the wallet holds, and what the two transactions are estimated to
  // cost. Both surfaced because "you cannot afford the gas" has to be a visible
  // number, not a failed signature.
  gasBalanceWei: string;
  gasNeededWei: string;
}

export interface UnwindBlocked {
  kind: "blocked";
  reason: string;
}

export interface UnwindNeedsConfirmation {
  kind: "needs-confirmation";
  target: UnwindTarget;
  lossBps: number;
  costUsd: number;
  inputValueUsd: number;
  deliveredValueUsd: number;
  reason: string;
}

export type UnwindResult = UnwindPlan | UnwindBlocked | UnwindNeedsConfirmation;

type QuoteFn = (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;

export async function planOndoUnwind(args: {
  collateral: OndoCollateral;
  // Atomic units of the Ethereum token to convert.
  amountAtomic: string;
  // The wallet holding it, which is also the signer. Never caller-supplied in
  // the UI: it is the embedded EVM wallet, the same one Ondo withdrew to.
  evmAddress: string;
  // Where it lands. The user's own Solana wallet.
  solanaAddress: string;
  // Native ETH balance, in wei. Read by the caller so this module needs no RPC.
  gasBalanceWei: bigint;
  // Live gas price in wei, for the same reason.
  gasPriceWei: bigint;
  acceptLossBps?: number;
  fetchQuote?: QuoteFn;
}): Promise<UnwindResult> {
  const { collateral, amountAtomic, evmAddress, solanaAddress } = args;
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;

  if (BigInt(amountAtomic || "0") <= 0n) {
    return { kind: "blocked", reason: "Enter an amount above zero." };
  }

  const base = unwindTargetFor(collateral.symbol);
  if (!base) {
    return {
      kind: "blocked",
      reason: `Aeras has no Solana equivalent registered for ${collateral.symbol}, so it cannot be brought back automatically. It is safe in your Ethereum wallet.`,
    };
  }

  // Contract and decimals come from Ondo's live token config, not the registry,
  // so a token address that moved cannot send the wrong asset.
  const target: UnwindTarget = {
    ...base,
    contractAddress: collateral.contractAddress,
    decimals: collateral.decimals,
  };

  const gasNeededWei = ESTIMATED_GAS_UNITS * args.gasPriceWei * BigInt(GAS_SAFETY_MULTIPLE);
  if (args.gasBalanceWei < gasNeededWei) {
    return {
      kind: "blocked",
      reason: `This needs about ${formatEth(gasNeededWei)} ETH for gas and the wallet holds ${formatEth(args.gasBalanceWei)}. Unlike the withdrawal, which Ondo paid for, this leg is signed by your own wallet on Ethereum. Fund it with a little ETH and try again.`,
    };
  }

  const request: TrustwareQuoteRequest = {
    fromChain: ETHEREUM_CHAIN,
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: target.contractAddress,
    toToken: target.mint,
    fromAmount: amountAtomic,
    fromAddress: evmAddress,
    toAddress: solanaAddress,
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
  };

  let estimate;
  try {
    estimate = extractEstimate(await fetchQuote(request));
  } catch (err) {
    return {
      kind: "blocked",
      reason: `Could not price this conversion. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    };
  }

  if (!estimate?.toAmount) {
    return {
      kind: "blocked",
      reason: `No route from ${target.collateralSymbol} on Ethereum to ${target.xstockSymbol} on Solana right now.`,
    };
  }

  const deliveredAtomic = estimate.toAmount;
  const deliveredMinAtomic =
    estimate.toAmountMin ??
    (
      (BigInt(deliveredAtomic) *
        BigInt(Math.round((100 - TRUSTWARE_DEFAULT_SLIPPAGE) * 100))) /
      10_000n
    ).toString();

  const deliveredTokens = atomicToUi(deliveredMinAtomic, target.xstockDecimals);

  // Marked against Ondo's own price where there is one, matching the deposit
  // path: it is the figure the user has been looking at all along.
  const mark = Number(collateral.markPriceUsd);

  // Valued from the GUARANTEED minimum, not the expected amount.
  //
  // Trustware's `toAmountUsd` corresponds to `toAmount`, the optimistic figure,
  // while `deliveredTokens` above is `toAmountMin`. Mixing them reports a cost
  // computed from a quantity the user is not promised, which understates the
  // loss by the whole slippage tolerance: on the live SPCXon quote that is the
  // difference between 0.13440 and 0.13306 SPCXx, about 1% of the position.
  // The conversion cost shown has to be the worst case the user has agreed to.
  //
  // SPCXon and SPCXx track the same underlying, so Ondo's collateral mark
  // prices both. Falls back to Trustware's own figure only where there is no
  // market to mark against, which is GLDon and SLVon.
  const deliveredValueUsd =
    collateral.priceable && mark > 0
      ? Number(deliveredTokens) * mark
      : toNumberOrNull(estimate.toAmountUsd);
  const inputTokens = Number(atomicToUi(amountAtomic, target.decimals));
  const inputValueUsd =
    collateral.priceable && mark > 0
      ? inputTokens * mark
      : toNumberOrNull(estimate.fromAmountUsd);

  let lossBps: number | null = null;
  if (inputValueUsd !== null && inputValueUsd > 0 && deliveredValueUsd !== null) {
    lossBps = Math.round(((inputValueUsd - deliveredValueUsd) / inputValueUsd) * 10_000);

    if (lossBps > HARD_MAX_UNWIND_LOSS_BPS) {
      return {
        kind: "blocked",
        reason: `This route would deliver about $${deliveredValueUsd.toFixed(2)} of ${target.xstockSymbol} for $${inputValueUsd.toFixed(2)} of ${target.collateralSymbol}, a ${(lossBps / 100).toFixed(1)}% loss. That is a broken market, not a spread. Refusing to route it.`,
      };
    }

    const accepted = args.acceptLossBps ?? -1;
    if (lossBps > MAX_UNWIND_LOSS_BPS && lossBps > accepted) {
      return {
        kind: "needs-confirmation",
        target,
        lossBps,
        costUsd: inputValueUsd - deliveredValueUsd,
        inputValueUsd,
        deliveredValueUsd,
        reason: `Converting $${inputValueUsd.toFixed(2)} of ${target.collateralSymbol} delivers about $${deliveredValueUsd.toFixed(2)} of ${target.xstockSymbol}, costing $${(inputValueUsd - deliveredValueUsd).toFixed(2)} (${(lossBps / 100).toFixed(2)}%). Most of that is the spread between two thin markets rather than the bridge, so it falls sharply at larger sizes.`,
      };
    }
  }

  return {
    kind: "ready",
    target,
    amountAtomic,
    deliveredAtomic,
    deliveredMinAtomic,
    deliveredTokens,
    deliveredValueUsd,
    inputValueUsd,
    lossBps,
    bridgeFeesUsd: toNumberOrNull(estimate.totalFeesUsd),
    gasBalanceWei: args.gasBalanceWei.toString(),
    gasNeededWei: gasNeededWei.toString(),
  };
}

// Signs the approve and the route call, then tracks the bridge to Solana.
//
// The machinery is `executeEvmRoute`, the same generic EVM-source path the
// Monad USDC return leg uses. Nothing here is Ondo-specific once the plan is
// built: by this point Ondo is out of the picture entirely and this is an
// ordinary Ethereum-to-Solana conversion of a token the user holds outright.
export async function executeOndoUnwind(args: {
  plan: UnwindPlan;
  evm: EvmSigner;
  solanaAddress: string;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
}): Promise<{ sourceTxHash: string; destTxHash: string | null }> {
  const { plan, evm, solanaAddress } = args;

  const result = await executeEvmRoute({
    request: {
      fromChain: ETHEREUM_CHAIN,
      toChain: TRUSTWARE_SOLANA_CHAIN,
      fromToken: plan.target.contractAddress,
      toToken: plan.target.mint,
      fromAmount: plan.amountAtomic,
      fromAddress: evm.address,
      toAddress: solanaAddress,
      slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
    },
    evm,
    describe: plan.target.xstockSymbol,
    // Re-quoting between planning and signing can move the rate. The floor is
    // the minimum the user was shown, so a route that has since got worse
    // fails before the signature rather than after it.
    minDeliveredAtomic: BigInt(plan.deliveredMinAtomic),
    onProgress: args.onProgress,
    signal: args.signal,
  });

  return { sourceTxHash: result.sourceTxHash, destTxHash: result.destTxHash };
}

function formatEth(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}
