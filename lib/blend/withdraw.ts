"use client";

// Withdraw USDC from the user's Aeras Vault I account (Blend) to the embedded
// EVM wallet on Monad, with the wallet paying its own way.
//
// Two calls, because the form shows the review before anything is signed:
//
//   quoteBlendWithdraw   sign in, ask Blend to price the withdrawal to Monad
//                        and build one plan per chain the position sits on,
//                        then simulate each plan where it runs and price its
//                        gas (lib/blend/gas.ts). The review names every
//                        chain, its amount, the bridge fee, the gas the
//                        wallet will pay, whether gas has to be bought first,
//                        and whether Blend's step there would fail.
//   executeBlendWithdraw buy whatever gas is missing from Solana USDC, refresh
//                        the quote if the wait used it up, run the session
//                        (one owner transaction per chain, lib/blend/execute.ts),
//                        then sweep any USDC the bridged slices left in the
//                        Safe on Monad into the wallet.
//
// Where the USDC lands, verified by trace on 2026-09-22: on the destination
// chain Blend's step redeems to the Safe and the Safe transfers to the
// wallet in the same transaction; the slices bridged from Ethereum and Base
// are addressed to the Safe on Monad, which is why the sweep exists. It is
// idempotent: nothing in the Safe, nothing sent.
//
// When a chain's step would fail, the review also finds the most that can be
// withdrawn right now, by bisection over quotes: Blend fills a partial
// withdrawal from the destination chain first, so the Monad vault's idle
// liquidity is the ceiling on the whole withdrawal until it refills. On
// 2026-09-22 that ceiling was 3.53 USDC of a 4.30 USDC Monad slice, and a
// 6 USDC request was still routed to Monad alone and failed.
//
// The SDK instance is carried from the quote to the execute call: it holds
// the JWT, and the quote's session is bound to it.

import type { ActionPlan, BlendSdk, WithdrawQuote } from "@blend-money/fe";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex } from "viem";

import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import { MONAD_USDC } from "@/lib/morpho/constants";
import type { MorphoTxProgress } from "@/lib/morpho/deposit";
import { atomicToUi, toNumberOrNull } from "@/lib/trustware/amounts";

import { BLEND_APP_CHAIN_ID, BLEND_VENUE_NAME, blendChainName } from "./constants";
import {
  connectPlanChain,
  describeRevert,
  runBlendQuote,
  waitForReceipt,
  type EvmSigner,
} from "./execute";
import {
  ensureGasForChain,
  reviewPlansGas,
  type ChainGasReview,
  type SolanaSigner,
} from "./gas";
import { encodeOwnerBatch } from "./safe";
import { loadBlendSdk, persistBlendSession } from "./sdk";

export type { SolanaSigner } from "./gas";

export type BlendTxProgress = MorphoTxProgress;
type Report = (p: BlendTxProgress) => void;

// Re-quote when the gas legs have eaten into the quote's life and less than
// this is left; Blend refuses an expired session at lock time.
const REQUOTE_WITHIN_MS = 90_000;

// The ceiling search: each step is a quote and a simulation, about two
// seconds. Seven steps narrow a $10 position to a cent; a larger one stops
// at about one percent of the request.
const CEILING_STEPS = 7;
const CENT_ATOMIC = 10_000n;

export interface NativeUsd {
  ethereum?: number;
  monad?: number;
}

export interface BlendWithdrawChain extends ChainGasReview {
  // What leaves this chain, 6-decimal USDC atomic. Null when Blend expressed
  // it as "everything here" (a full withdrawal); the form reads the position.
  amountAtomic: string | null;
  // The bridge fee for this chain, USD. Null on the destination chain.
  feesUsd: number | null;
  // The simulated gas cost in USD, when the native price is known.
  gasCostUsd: number | null;
}

export interface BlendWithdrawQuote {
  sdk: BlendSdk;
  quote: WithdrawQuote;
  safeAddress: string;
  // The request that produced the quote, so it can be re-quoted unchanged.
  request: { amountAtomic: bigint; withdrawAll: boolean };
  // What Blend will move in total, 6-decimal USDC atomic.
  amountAtomic: string;
  feesUsd: number | null;
  estimatedSeconds: number;
  expiresAt: Date;
  chains: BlendWithdrawChain[];
  // Why the withdrawal cannot run as quoted, or null. Set when any chain's
  // step reverted in simulation.
  blocked: string | null;
  // When blocked: the most that can be withdrawn right now, 6-decimal atomic,
  // rounded down to a cent. 0n when nothing can. Null when not blocked or
  // when the search itself failed.
  withdrawableNowAtomic: bigint | null;
}

interface PayloadChain {
  chainId: number;
  amount: string;
  fees: { totalUsd?: string } | null;
}

async function quoteAndPlan(
  sdk: BlendSdk,
  request: { amountAtomic: bigint; withdrawAll: boolean },
  signal?: AbortSignal,
): Promise<{ quote: WithdrawQuote; plans: ActionPlan[]; perChain: Map<number, PayloadChain> }> {
  const quote = await sdk.quoteWithdraw(
    {
      destinationChainId: BLEND_APP_CHAIN_ID,
      amount: request.amountAtomic.toString(),
      isMaxWithdraw: request.withdrawAll,
      // One open session per account; a quote left behind by a closed tab
      // would otherwise block this one.
      forceReset: true,
    },
    { signal },
  );
  const session = await sdk.sessions.get(quote.intentId, { signal });
  if (session.type !== "WITHDRAW" || !session.actionPlans || session.actionPlans.length === 0) {
    throw new Error("Blend returned no plan for this withdrawal. Try again.");
  }
  const perChain = new Map<number, PayloadChain>(
    (session.payload?.payloads ?? []).map((p) => [
      p.chainId,
      { chainId: p.chainId, amount: p.amount, fees: p.fees as { totalUsd?: string } | null },
    ]),
  );
  return { quote, plans: session.actionPlans, perChain };
}

// A full withdrawal's per-chain amount is the maximum uint256; anything that
// long is "everything here" rather than a number the form can show.
function amountOrNull(amount: string | undefined): string | null {
  if (!amount || !/^\d+$/.test(amount) || amount.length > 30) return null;
  return amount;
}

export async function quoteBlendWithdraw(args: {
  // 6-decimal atomic. Ignored by Blend when withdrawAll is set.
  amountAtomic: bigint;
  withdrawAll: boolean;
  evm: EvmSigner;
  // Native prices for the gas figures; missing entries leave USD blank.
  nativeUsd?: NativeUsd;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<BlendWithdrawQuote> {
  const report: Report = (p) => args.onProgress?.(p);
  if (!args.withdrawAll && args.amountAtomic <= 0n) {
    throw new Error("Enter an amount to withdraw.");
  }
  const request = { amountAtomic: args.amountAtomic, withdrawAll: args.withdrawAll };

  report({ stage: "switching", message: `Signing in to ${BLEND_VENUE_NAME}.` });
  const { sdk, session } = await loadBlendSdk(args.evm);

  report({ stage: "switching", message: "Pricing the withdrawal." });
  const { quote, plans, perChain } = await quoteAndPlan(sdk, request, args.signal);

  report({ stage: "switching", message: "Checking each chain." });
  const reviews = await reviewPlansGas(plans, args.evm);

  const chains: BlendWithdrawChain[] = reviews.map((r) => {
    const p = perChain.get(r.chainId);
    const usd = r.chainId === 143 ? args.nativeUsd?.monad : args.nativeUsd?.ethereum;
    return {
      ...r,
      amountAtomic: amountOrNull(p?.amount),
      feesUsd: toNumberOrNull(p?.fees?.totalUsd),
      gasCostUsd:
        usd != null && r.costWei > 0n ? (Number(r.costWei) / 1e18) * usd : null,
    };
  });
  const feesUsd = Number(quote.totalFeesUsd);
  const blocked = chains.find((c) => c.revert)?.revert ?? null;

  // A blocked quote is never executed, so its session can be spent on the
  // search (every trial quote force-resets the account's open session).
  let withdrawableNowAtomic: bigint | null = null;
  if (blocked) {
    try {
      withdrawableNowAtomic = await findWithdrawableNow(
        sdk,
        args.evm,
        BigInt(quote.totalAmount),
        (message) => report({ stage: "switching", message }),
        args.signal,
      );
    } catch (err) {
      console.error("[blend withdraw ceiling]", err);
    }
  }

  return {
    sdk,
    quote,
    safeAddress: session.safeAddress,
    request,
    amountAtomic: quote.totalAmount,
    feesUsd: Number.isFinite(feesUsd) ? feesUsd : null,
    estimatedSeconds: quote.estimatedSeconds,
    expiresAt: new Date(quote.expiresAt),
    chains,
    blocked,
    withdrawableNowAtomic,
  };
}

// Bisect the largest amount whose every step simulates, between nothing and
// the amount that failed. Each trial quote replaces the account's open
// session and is cancelled after its simulation; the caller's blocked quote
// is gone by the end, which is fine because it could not have run.
async function findWithdrawableNow(
  sdk: BlendSdk,
  evm: EvmSigner,
  failedAtomic: bigint,
  report: (message: string) => void,
  signal?: AbortSignal,
): Promise<bigint> {
  let lo = 0n;
  let hi = failedAtomic;
  const tolerance = failedAtomic / 100n > CENT_ATOMIC ? failedAtomic / 100n : CENT_ATOMIC;
  for (let i = 0; i < CEILING_STEPS && hi - lo > tolerance; i++) {
    const mid = (lo + hi) / 2n;
    report(`Finding how much can be withdrawn right now (${i + 1} of ${CEILING_STEPS}).`);
    const trial = await quoteAndPlan(sdk, { amountAtomic: mid, withdrawAll: false }, signal);
    const reviews = await reviewPlansGas(trial.plans, evm);
    await sdk.sessions.cancel(trial.quote.intentId).catch(() => {});
    if (reviews.every((r) => r.revert === null)) lo = mid;
    else hi = mid;
  }
  return (lo / CENT_ATOMIC) * CENT_ATOMIC;
}

export interface BlendWithdrawResult {
  txHashes: { hash: string; chainId: number }[];
  destinationChainId: number;
  amountAtomic: string;
  feesUsd: number | null;
  // USDC moved from the Safe to the wallet after settlement, atomic. "0"
  // when the Safe held none.
  sweptAtomic: string;
  sweepTxHash: string | null;
}

export async function executeBlendWithdraw(args: {
  quoted: BlendWithdrawQuote;
  evm: EvmSigner;
  // Needed only when a chain's gas has to be bought.
  solana: SolanaSigner | undefined;
  solanaUsdcAtomic: string;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<BlendWithdrawResult> {
  const report: Report = (p) => args.onProgress?.(p);
  const { sdk } = args.quoted;
  const address = args.evm.address;
  if (!address) throw new Error("No embedded EVM wallet available.");
  if (args.quoted.blocked) throw new Error(args.quoted.blocked);

  const positionValueUsd = Number(atomicToUi(args.quoted.amountAtomic, USDC_DECIMALS));
  for (const chain of args.quoted.chains) {
    if (!chain.needsTopUp) continue;
    await ensureGasForChain({
      review: chain,
      evm: args.evm,
      solana: args.solana,
      solanaUsdcAtomic: args.solanaUsdcAtomic,
      positionValueUsd,
      report: (message) => report({ stage: "funding", message }),
      signal: args.signal,
    });
  }

  // The gas legs can outlive a quote. The request is unchanged, so a fresh
  // one is the same withdrawal at today's fee.
  let quote = args.quoted.quote;
  if (Date.now() >= args.quoted.expiresAt.getTime() - REQUOTE_WITHIN_MS) {
    report({ stage: "switching", message: "Refreshing the quote." });
    quote = (await quoteAndPlan(sdk, args.quoted.request, args.signal)).quote;
  }

  const amountUi = atomicToUi(quote.totalAmount, USDC_DECIMALS);
  report({ stage: "withdrawing", message: `Withdrawing ${amountUi} USDC to your Monad wallet.` });
  const result = await runBlendQuote({
    sdk,
    quote,
    evm: args.evm,
    report: (message) => report({ stage: "withdrawing", message }),
    onSubmitted: () => report({ stage: "confirming", message: "Confirming with Blend." }),
    signal: args.signal,
  });
  persistBlendSession(sdk, address);

  if (result.status !== "settled") {
    throw new Error(
      result.error ??
        `Blend reported the withdrawal as ${result.status}. Check your Monad wallet before retrying.`,
    );
  }

  const swept = await sweepSafeUsdc({
    evm: args.evm,
    safeAddress: args.quoted.safeAddress,
    report: (message) => report({ stage: "withdrawing", message }),
  });

  const first = result.txHashes[0];
  report({ stage: "done", message: "Withdrawal settled.", txHash: first?.hash });
  return {
    txHashes: result.txHashes,
    destinationChainId: quote.destinationChainId,
    amountAtomic: quote.totalAmount,
    feesUsd: args.quoted.feesUsd,
    sweptAtomic: swept.amountAtomic,
    sweepTxHash: swept.txHash,
  };
}

// Move whatever USDC sits in the Safe on Monad into the wallet, as one owner
// transaction. The bridged slices of a withdrawal are addressed to the Safe;
// left there, Blend's rebalancing could put them back to work.
async function sweepSafeUsdc(args: {
  evm: EvmSigner;
  safeAddress: string;
  report: (message: string) => void;
}): Promise<{ amountAtomic: string; txHash: string | null }> {
  const owner = args.evm.address as Hex;
  const safe = args.safeAddress as Hex;
  const provider = await connectPlanChain(args.evm, BLEND_APP_CHAIN_ID);
  const held = decodeFunctionResult({
    abi: erc20Abi,
    functionName: "balanceOf",
    data: (await provider.request({
      method: "eth_call",
      params: [
        {
          to: MONAD_USDC.address,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [safe] }),
        },
        "latest",
      ],
    })) as Hex,
  });
  if (held <= 0n) return { amountAtomic: "0", txHash: null };

  args.report(
    `Moving ${atomicToUi(held.toString(), USDC_DECIMALS)} USDC from your account to your wallet.`,
  );
  const data = encodeOwnerBatch(owner, [
    {
      to: MONAD_USDC.address as Hex,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [owner, held] }),
      operation: 0,
    },
  ]);
  const call = { from: owner, to: safe, data };
  let gas: bigint;
  try {
    gas = BigInt((await provider.request({ method: "eth_estimateGas", params: [call] })) as string);
  } catch (err) {
    throw new Error(
      `${describeRevert(BLEND_APP_CHAIN_ID, err)} The withdrawn USDC is in your account on ${blendChainName(BLEND_APP_CHAIN_ID)}; try again in a moment.`,
    );
  }
  const txHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ ...call, gas: `0x${((gas * 125n) / 100n).toString(16)}` }],
  })) as string;
  await waitForReceipt(provider, txHash, BLEND_APP_CHAIN_ID);
  return { amountAtomic: held.toString(), txHash };
}

// Drop a reviewed quote the user walked away from, so the next one does not
// have to force-reset past it. Best effort.
export async function discardBlendWithdrawQuote(
  quoted: BlendWithdrawQuote,
): Promise<void> {
  try {
    await quoted.sdk.sessions.cancel(quoted.quote.intentId);
  } catch {
    // The next quote passes forceReset and clears it anyway.
  }
}
