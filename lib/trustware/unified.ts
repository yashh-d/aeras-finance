// Unified collateral: treat every holding of the same equity as one balance.
//
// A user's Tesla position can be spread across the Backed xStock on Solana, the
// Ondo mint on Solana, and the same Ondo token on an EVM chain. They are the
// same underlying, so the borrow surface offers the sum as one spendable
// balance and converts whatever is not already in xStock form before depositing.
//
// The planner deliberately never splits a single conversion across two sources:
// two routes means two sets of fees and two ways to fail. That rule stays. This
// module sits above it and sequences one conversion per source instead, largest
// first, until the deposit is covered. Each leg is a complete, independently
// priced conversion.
//
// Leg N's starting balance is leg N-1's GUARANTEED minimum, never its optimistic
// estimate, so a simulated multi-leg plan can only under-promise.

import type { XStockBorrowVault } from "@/lib/jupiter/borrow";
import { atomicToUi, rescaleAtomic, uiToAtomic } from "./amounts";
import {
  planCollateralDeposit,
  quoteSpendAll,
  type BlockedPlan,
  type ConvertThenDepositPlan,
  type HeldEquivalent,
  type SolanaQuoteFn,
} from "./planner";
import { dustAtomic, largestConvertibleAtomic } from "./selection";
import type { TrustwareQuoteRequest, TrustwareQuoteResponse } from "./types";

export interface UnifiedDepositPlan {
  kind: "unified-deposit";
  vault: XStockBorrowVault;
  // Total collateral to deposit once every leg has settled.
  depositAtomic: string;
  // Conversions to run in order. Empty when the wallet already holds enough.
  legs: ConvertThenDepositPlan[];
  // Summed across legs. Null when no leg reported a fee.
  totalFeesUsd: number | null;
}

export type UnifiedPlan = UnifiedDepositPlan | BlockedPlan;

export interface MaxDepositable {
  // Everything that could actually end up as collateral: what is already on
  // Solana plus the guaranteed delivery from converting every other holding.
  maxAtomic: string;
  // Sources whose route priced, and sources that did not. An unpriced source is
  // excluded from the maximum rather than counted at par, so the number stays
  // one the deposit can honour.
  priced: number;
  unpriced: number;
}

// The real ceiling for the deposit field.
//
// Summing holdings at par overstates it: a conversion costs fees, so a balance
// of N source tokens becomes less than N collateral tokens. Quoting each source
// at its full balance is the only way to know the true figure, and using it
// means Max fills a number the deposit can actually be funded from.
export async function quoteMaxDepositable(input: {
  vault: XStockBorrowVault;
  solanaAddress: string;
  evmAddress: string | undefined;
  solanaCollateralAtomic: string;
  heldEquivalents: HeldEquivalent[];
  fetchQuote?: (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;
  // Override the Solana-to-Solana pricing engine. See planner.SolanaQuoteFn.
  quoteSolana?: SolanaQuoteFn;
}): Promise<MaxDepositable> {
  let total = BigInt(input.solanaCollateralAtomic || "0");
  let priced = 0;
  let unpriced = 0;

  const quotes = await Promise.all(
    input.heldEquivalents.map((candidate) =>
      quoteSpendAll({
        candidate,
        vault: input.vault,
        solanaAddress: input.solanaAddress,
        evmAddress: input.evmAddress,
        fetchQuote: input.fetchQuote,
        quoteSolana: input.quoteSolana,
      }),
    ),
  );

  for (const result of quotes) {
    if ("kind" in result) {
      unpriced++;
      continue;
    }
    total += BigInt(result.quote.toAmountMinAtomic);
    priced++;
  }

  return { maxAtomic: total.toString(), priced, unpriced };
}

export interface UnifiedPlanInput {
  vault: XStockBorrowVault;
  requestedUi: string | number;
  solanaAddress: string;
  evmAddress: string | undefined;
  solanaCollateralAtomic: string;
  heldEquivalents: HeldEquivalent[];
  fetchQuote?: (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;
  // Override the Solana-to-Solana pricing engine. See planner.SolanaQuoteFn.
  quoteSolana?: SolanaQuoteFn;
}

function sameSource(a: HeldEquivalent, b: ConvertThenDepositPlan): boolean {
  return a.source.chain === b.source.chain && a.source.token === b.source.token;
}

// Biggest holding by 1:1 notional. Spending the largest source first keeps the
// number of conversions down, and each conversion is a fee and a way to fail.
function pickLargest(
  held: HeldEquivalent[],
  collateralDecimals: number,
): HeldEquivalent {
  return held.reduce((best, h) => {
    const a = BigInt(rescaleAtomic(h.balanceAtomic, h.source.decimals, collateralDecimals));
    const b = BigInt(
      rescaleAtomic(best.balanceAtomic, best.source.decimals, collateralDecimals),
    );
    return a > b ? h : best;
  });
}

// Plan a deposit against the whole unified balance.
//
// Every leg is priced by the existing single-source planner, so the per-leg
// guarantees (minimum delivered clears the shortfall it was sized for, source
// balance covers the amount sent) hold exactly as they do for one conversion.
export async function planUnifiedDeposit(
  input: UnifiedPlanInput,
): Promise<UnifiedPlan> {
  const { vault, solanaCollateralAtomic, heldEquivalents } = input;
  const decimals = vault.collateralDecimals;

  let requested: bigint;
  try {
    requested = BigInt(uiToAtomic(input.requestedUi, decimals));
  } catch {
    return { kind: "insufficient", vault, reason: "Enter a valid amount." };
  }

  const dust = BigInt(dustAtomic(decimals));
  let onSolana = BigInt(solanaCollateralAtomic || "0");
  let available = [...heldEquivalents];
  const legs: ConvertThenDepositPlan[] = [];
  let lastBlock: BlockedPlan | null = null;

  // One leg per source at most, so a source that fails to close the gap can
  // never be retried into an endless loop.
  while (requested - onSolana > dust && available.length > 0) {
    const remaining = requested - onSolana;
    // Face value of the largest remaining source. Fees mean it delivers less
    // than this, so it is only used to decide WHICH branch to take, never to
    // size a leg.
    const cap = BigInt(largestConvertibleAtomic(available, decimals));
    if (cap <= 0n) break;

    if (remaining < cap) {
      // The last leg. Size it exactly: the planner solves for the source amount
      // that clears what is left and no more.
      const plan = await planCollateralDeposit({
        vault,
        requestedUi: atomicToUi((onSolana + remaining).toString(), decimals),
        solanaAddress: input.solanaAddress,
        evmAddress: input.evmAddress,
        solanaCollateralAtomic: onSolana.toString(),
        heldEquivalents: available,
        fetchQuote: input.fetchQuote,
        quoteSolana: input.quoteSolana,
      });
      if (plan.kind === "direct-deposit") break;
      if (plan.kind === "convert-then-deposit") {
        legs.push(plan);
        onSolana += BigInt(plan.quote.toAmountMinAtomic);
        available = available.filter((h) => !sameSource(h, plan));
        continue;
      }

      // Exact sizing failed. That is expected right at the ceiling: the planner
      // adds headroom on top of the solved amount, so covering a shortfall that
      // already equals what a source can deliver asks for more than it holds.
      // Spending the source outright is the honest answer, and it is what the
      // user asked for by depositing their whole balance.
      const top = pickLargest(available, decimals);
      const spendRest = await quoteSpendAll({
        candidate: top,
        vault,
        solanaAddress: input.solanaAddress,
        evmAddress: input.evmAddress,
        fetchQuote: input.fetchQuote,
        quoteSolana: input.quoteSolana,
      });
      if ("kind" in spendRest) {
        lastBlock = plan;
        break;
      }
      const rest = BigInt(spendRest.quote.toAmountMinAtomic);
      if (rest < remaining) {
        // Even spending it all leaves a gap. The planner's own reason names the
        // amounts, so keep it rather than restating a vaguer version.
        lastBlock = plan;
        break;
      }
      legs.push({
        kind: "convert-then-deposit",
        vault,
        depositAtomic: requested.toString(),
        shortfallAtomic: remaining.toString(),
        source: top.source,
        sourceAmountAtomic: spendRest.sourceAmountAtomic,
        quote: spendRest.quote,
      });
      onSolana += rest;
      available = available.filter((h) => h !== top);
      continue;
    }

    // This source cannot finish the job on its own, so it gets spent in full and
    // the next source picks up the rest. Its balance is quoted directly, since
    // what a holding is worth after fees is not something to assume.
    const top = pickLargest(available, decimals);
    const spend = await quoteSpendAll({
      candidate: top,
      vault,
      solanaAddress: input.solanaAddress,
      evmAddress: input.evmAddress,
      fetchQuote: input.fetchQuote,
      quoteSolana: input.quoteSolana,
    });
    if ("kind" in spend) {
      // Remember why, but keep going: a source that cannot serve a leg does not
      // mean the next one cannot either.
      lastBlock = spend;
      available = available.filter((h) => h !== top);
      continue;
    }
    const delivered = BigInt(spend.quote.toAmountMinAtomic);
    // A source that delivers nothing usable would loop forever otherwise.
    if (delivered <= 0n) {
      available = available.filter((h) => h !== top);
      continue;
    }
    legs.push({
      kind: "convert-then-deposit",
      vault,
      depositAtomic: requested.toString(),
      shortfallAtomic: remaining.toString(),
      source: top.source,
      sourceAmountAtomic: spend.sourceAmountAtomic,
      quote: spend.quote,
    });
    // Advance on the guaranteed floor, not the estimate.
    onSolana += delivered;
    available = available.filter((h) => h !== top);
  }

  if (requested - onSolana > dust) {
    return (
      lastBlock ?? {
        kind: "insufficient",
        vault,
        reason: `You need ${atomicToUi((requested - onSolana).toString(), decimals)} more ${vault.collateralSymbol} than your holdings can cover.`,
      }
    );
  }

  const fees = legs
    .map((l) => l.quote.totalFeesUsd)
    .filter((f): f is number => f != null);

  return {
    kind: "unified-deposit",
    vault,
    depositAtomic: requested.toString(),
    legs,
    totalFeesUsd: fees.length ? fees.reduce((a, b) => a + b, 0) : null,
  };
}
