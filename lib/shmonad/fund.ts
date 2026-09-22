"use client";

// Stake shMON from the user's Solana USDC, in one press.
//
// This is the Morpho venue's gas top-up leg (lib/morpho/fund.ts) sized to the
// whole deposit: Trustware converts Solana USDC into native MON delivered to
// the embedded EVM wallet, then the payable deposit runs. There is no
// separate gas leg because the delivered MON is the gas token; the flow keeps
// GAS_FLOOR_WEI back from it so the wallet can pay for the deposit now and
// for an exit and the leg home later.
//
// Why mint rather than buy shMON: Trustware can deliver shMON directly, but
// that path prices off a DEX pool and takes price impact at size, while
// deposit mints at the contract's own rate. Measured 2026-09-22 at 25 USDC:
// direct delivered about 594 shMON, minting about 600. See
// docs/shmonad-plan.md D2.
//
// The same rules as lib/morpho/fund.ts apply: nothing downstream treats funds
// as delivered before Trustware reports success, every validation that can
// happen before the user signs does, and the plan is re-made from a fresh
// balance read so a retry never re-buys what already arrived.

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { MONAD_CHAIN_ID } from "@/lib/morpho/constants";
import type { EvmSigner, MorphoTxProgress } from "@/lib/morpho/deposit";
import {
  broadcastFundingLeg,
  GAS_FLOOR_WEI,
  fundingRequest,
  quoteFunding,
  type MorphoFundingLeg,
  type QuoteFn,
} from "@/lib/morpho/fund";
import { atomicToUi } from "@/lib/trustware/amounts";
import { fetchTrustwareQuoteViaProxy } from "@/lib/trustware/client";
import {
  trackTrustwareSettlement,
  type SolanaSigner,
} from "@/lib/trustware/execute";

import { fetchShmonPosition } from "./client";
import {
  MIN_STAKE_USDC_ATOMIC,
  SHMON_FUNDING_TOKEN,
  STAKE_MAX_BUFFER_BPS,
} from "./constants";
import { monToShares, stakeableAfterReserve } from "./math";
import { stakeMon } from "./stake";

export type { SolanaSigner };

type Report = (p: MorphoTxProgress) => void;

// How long to wait for delivered MON to become readable after Trustware
// reports success; the destination transaction has mined by then.
const ARRIVAL_TIMEOUT_MS = 60_000;
const ARRIVAL_POLL_MS = 2_500;

// The stake ceiling: the Solana USDC discounted by the funding margin, the
// same margin maxFundableDepositAtomic applies for the Morpho venue.
export function maxStakeUsdcAtomic(solanaUsdcAtomic: string): string {
  return (
    (BigInt(solanaUsdcAtomic || "0") * BigInt(10_000 - STAKE_MAX_BUFFER_BPS)) /
    10_000n
  ).toString();
}

export type StakePlan =
  | {
      kind: "fund-then-stake";
      usdcAtomic: bigint;
      leg: MorphoFundingLeg;
      // Guaranteed MON delivered after slippage, 18-decimal.
      monDeliveredMinAtomic: bigint;
      // Of that, what stays in the wallet as the gas reserve.
      reserveKeptAtomic: bigint;
      // What the deposit will stake at minimum, and the shares that mints at
      // the current rate.
      monStakedMinAtomic: bigint;
      sharesMinAtomic: bigint;
      totalFeesUsd: number | null;
    }
  | { kind: "blocked"; reason: string };

// Price a stake without signing anything.
export async function planStake(args: {
  usdcAtomic: bigint;
  solanaUsdcAtomic: string;
  walletMonAtomic: string;
  // previewDeposit(1e18) from the metrics or position read.
  sharesPerMonAtomic: string;
  solanaAddress: string | undefined;
  evmAddress: string;
  fetchQuote?: QuoteFn;
}): Promise<StakePlan> {
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;
  const { usdcAtomic } = args;
  if (usdcAtomic <= 0n) return { kind: "blocked", reason: "Enter an amount above zero." };
  if (usdcAtomic < MIN_STAKE_USDC_ATOMIC) {
    return {
      kind: "blocked",
      reason: `The minimum stake is ${atomicToUi(MIN_STAKE_USDC_ATOMIC.toString(), USDC_DECIMALS)} USDC.`,
    };
  }
  if (usdcAtomic > BigInt(args.solanaUsdcAtomic || "0")) {
    return { kind: "blocked", reason: "Amount is above your Solana USDC balance." };
  }
  if (!args.solanaAddress) {
    return { kind: "blocked", reason: "No Solana wallet is available to stake from." };
  }

  const request = fundingRequest(
    usdcAtomic.toString(),
    args.solanaAddress,
    args.evmAddress,
    SHMON_FUNDING_TOKEN,
  );
  let quote: Awaited<ReturnType<typeof quoteFunding>>;
  try {
    quote = await quoteFunding(request, fetchQuote);
  } catch (err) {
    return {
      kind: "blocked",
      reason: `Could not price the conversion to MON. ${
        err instanceof Error ? err.message : "Try again shortly."
      }`,
    };
  }
  const delivered = BigInt(quote.toAmountMinAtomic);
  if (delivered <= 0n) {
    return { kind: "blocked", reason: "The conversion to MON did not return a usable rate." };
  }
  const walletMon = BigInt(args.walletMonAtomic || "0");
  const reserveKept = walletMon >= GAS_FLOOR_WEI ? 0n : GAS_FLOOR_WEI - walletMon;
  const staked = stakeableAfterReserve(delivered, reserveKept);
  if (staked <= 0n) {
    return {
      kind: "blocked",
      reason: "This amount would all go to the gas reserve. Stake a little more.",
    };
  }
  return {
    kind: "fund-then-stake",
    usdcAtomic,
    leg: {
      request,
      sourceAmountAtomic: usdcAtomic.toString(),
      toAmountMinAtomic: quote.toAmountMinAtomic,
      totalFeesUsd: quote.totalFeesUsd,
    },
    monDeliveredMinAtomic: delivered,
    reserveKeptAtomic: reserveKept,
    monStakedMinAtomic: staked,
    sharesMinAtomic: monToShares(staked, BigInt(args.sharesPerMonAtomic || "0")),
    totalFeesUsd: quote.totalFeesUsd,
  };
}

async function readWalletMon(evmAddress: string): Promise<bigint | null> {
  try {
    const p = await fetchShmonPosition(evmAddress);
    return BigInt(p.walletMonAtomic);
  } catch {
    return null;
  }
}

// Poll the wallet's MON through the position route until it reaches the
// target. Trustware has reported success, so this only absorbs read lag.
async function awaitWalletMon(
  evmAddress: string,
  atLeast: bigint,
  signal?: AbortSignal,
): Promise<bigint> {
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  let last = 0n;
  for (;;) {
    if (signal?.aborted) return last;
    const now = await readWalletMon(evmAddress);
    if (now != null) {
      last = now;
      if (now >= atLeast) return now;
    }
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, ARRIVAL_POLL_MS));
  }
}

// The one-press stake: convert, wait, deposit. Returns the deposit hash and
// what was staked.
export async function stakeFromSolana(args: {
  usdcAtomic: bigint;
  solanaUsdcAtomic: string;
  walletMonAtomic: string;
  sharesPerMonAtomic: string;
  signer: EvmSigner;
  solana: SolanaSigner;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ txHash: string; stakedMonAtomic: bigint; funded: boolean }> {
  const report: Report = (p) => args.onProgress?.(p);

  // Plan against a fresh read: the card's balance can lag the chain, and a
  // retry must not re-buy MON a first attempt already delivered.
  const before = (await readWalletMon(args.signer.address)) ?? BigInt(args.walletMonAtomic || "0");
  const plan = await planStake({
    usdcAtomic: args.usdcAtomic,
    solanaUsdcAtomic: args.solanaUsdcAtomic,
    walletMonAtomic: before.toString(),
    sharesPerMonAtomic: args.sharesPerMonAtomic,
    solanaAddress: args.solana.address,
    evmAddress: args.signer.address,
  });
  if (plan.kind === "blocked") throw new Error(plan.reason);

  const leg = await broadcastFundingLeg({
    funding: plan.leg,
    minDeliveredAtomic: plan.monDeliveredMinAtomic,
    describe: "MON",
    solana: args.solana,
    report,
    signal: args.signal,
  });
  report({ stage: "funding", message: `Bridging to Monad (chain ${MONAD_CHAIN_ID}). This can take a few minutes.` });
  await trackTrustwareSettlement(leg.intentId, args.signal, () =>
    report({ stage: "funding", message: "Bridging to Monad. This can take a few minutes." }),
  );

  report({ stage: "funding", message: "MON arrived. Confirming the Monad balance." });
  const after = await awaitWalletMon(
    args.signer.address,
    before + plan.monDeliveredMinAtomic,
    args.signal,
  );
  const delivered = after > before ? after - before : 0n;
  if (delivered < plan.monDeliveredMinAtomic) {
    throw new Error(
      "The MON is on Monad but the balance read has not caught up. " +
        "Your funds are safe. Try again in a moment and the stake will skip the conversion.",
    );
  }

  // Stake what arrived, keeping the reserve; a wallet already above the
  // reserve stakes the whole delivery.
  const stakeable = stakeableAfterReserve(after, GAS_FLOOR_WEI);
  const amount = stakeable < delivered ? stakeable : delivered;
  if (amount <= 0n) {
    throw new Error("The delivered MON does not cover the gas reserve. Stake a larger amount.");
  }
  const txHash = await stakeMon({ amountAtomic: amount, signer: args.signer, onProgress: args.onProgress });
  return { txHash, stakedMonAtomic: amount, funded: true };
}

// Stake MON already sitting in the Monad wallet, keeping the reserve. Used
// when a funded stake's conversion landed but its deposit did not (a retry),
// and by the Buy + Earn close path's mirror image. Not a form of its own.
export async function stakeWalletMon(args: {
  walletMonAtomic: string;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<{ txHash: string; stakedMonAtomic: bigint }> {
  const fresh = (await readWalletMon(args.signer.address)) ?? BigInt(args.walletMonAtomic || "0");
  const amount = stakeableAfterReserve(fresh, GAS_FLOOR_WEI);
  if (amount <= 0n) {
    throw new Error("The Monad wallet holds no MON beyond the gas reserve.");
  }
  const txHash = await stakeMon({ amountAtomic: amount, signer: args.signer, onProgress: args.onProgress });
  return { txHash, stakedMonAtomic: amount };
}

// Solana USDC the wallet must hold for a stake, for the Buy + Earn ticket's
// preview: the amount itself, since fees come off the delivered side.
export const STAKE_SOURCE_MINT = USDC_MINT;
