"use client";

// One-click self-collateralized hedge.
//
// The whole thesis of this venue in a single call: take a tokenized stock the
// user already holds, post it to Ondo as margin, and short the matching perp
// against it. The user signs once, on Solana, and never touches Ethereum.
//
// Four steps, each of which already existed on its own. What is new here is the
// sequencing and, more importantly, the failure handling between them, because
// the steps are not equally reversible:
//
//   1. plan     price the conversion and run the three funding guards
//   2. fund     sign the Solana leg; the bridge delivers to Ondo's address
//   3. credit   wait for Ondo to actually mark the deposit as margin
//   4. hedge    open the short
//
// Step 2 is the point of no return. Once the source leg is signed the tokens
// have left the user's wallet, and the destination is an address they cannot
// sign for. Step 3 can therefore time out with the money already gone, which is
// a state the caller must be able to render honestly rather than as an error.
// `OneClickOutcome` distinguishes it: `funded-not-credited` means the deposit
// is in flight and the hedge did not open, and retrying the hedge later is
// correct while retrying the funding would double-spend.
//
// Step 4 is deliberately NOT retried automatically. If Ondo credits the margin
// but the order is rejected, the right move is to show the user a funded
// account and let them place the order, not to loop against a live exchange.

import { openOndoHedge, type OndoHedgeResult } from "./client";
import {
  ONDO_FUNDING_ENABLED,
  executeOndoFunding,
  planOndoFunding,
  type OndoFundingPlan,
  type OndoFundingProgress,
  type OndoFundingSource,
} from "./fund";
import type { OndoCollateral } from "./collateral";
import type { SolanaSigner } from "@/lib/trustware/execute";

export type OneClickStep =
  | "planning"
  | "funding"
  | "crediting"
  | "hedging";

export interface OneClickProgress {
  step: OneClickStep;
  // Detail from the funding leg, which has its own multi-stage progress.
  funding?: OndoFundingProgress;
  message: string;
}

export type OneClickOutcome =
  // Nothing was signed. Safe to change inputs and try again.
  | { kind: "blocked"; reason: string }
  // Priced and legal, but costlier than the soft bound. Nothing signed. Call
  // again with `acceptLossBps` set to `lossBps` to go ahead.
  | {
      kind: "needs-confirmation";
      lossBps: number;
      costUsd: number;
      inputValueUsd: number;
      deliveredValueUsd: number;
      reason: string;
    }
  // Everything worked.
  | {
      kind: "done";
      plan: OndoFundingPlan;
      fundingTxHash: string;
      creditedMarginUsd: number;
      hedge: OndoHedgeResult;
    }
  // Money moved, margin never showed up in time. NOT a retry of the whole flow.
  | {
      kind: "funded-not-credited";
      plan: OndoFundingPlan;
      fundingTxHash: string;
      waitedMs: number;
    }
  // Margin credited, the order did not go through. Funds are safe on Ondo.
  | {
      kind: "funded-not-hedged";
      plan: OndoFundingPlan;
      fundingTxHash: string;
      creditedMarginUsd: number;
      reason: string;
    };

// Ondo credits a bridge delivery when the destination leg lands, which is an
// Ethereum settlement rather than an internal transfer. Ten minutes is generous
// against normal mainnet finality and short enough that the UI is not stuck
// forever; past it the deposit is reported as in flight, not lost.
export const CREDIT_TIMEOUT_MS = 10 * 60 * 1000;
const CREDIT_POLL_MS = 6_000;

export interface OneClickArgs {
  collateral: OndoCollateral;
  source: OndoFundingSource;
  solana: SolanaSigner;
  // The holding being hedged, and how much of it to short.
  xstockSymbol: string;
  quantity: string;
  tokenPriceUsd: string;
  hedgeRatio: number;
  // Reads the account's available margin in USD. Polled until it rises.
  readMarginUsd: () => Promise<number>;
  // Set once the user has seen the cost and agreed to it.
  acceptLossBps?: number;
  onProgress?: (p: OneClickProgress) => void;
  signal?: AbortSignal;
}

export async function runOneClickHedge(
  args: OneClickArgs,
): Promise<OneClickOutcome> {
  const report = args.onProgress ?? (() => {});

  if (!ONDO_FUNDING_ENABLED) {
    return {
      kind: "blocked",
      reason:
        "Posting collateral to Ondo is switched off until one live deposit confirms Ondo credits a bridge-delivered transfer. Set NEXT_PUBLIC_ONDO_FUNDING_ENABLED=true once it has.",
    };
  }

  // ── 1. Plan ────────────────────────────────────────────────────────────────
  report({ step: "planning", message: "Pricing the deposit" });
  const planned = await planOndoFunding({
    collateral: args.collateral,
    source: args.source,
    acceptLossBps: args.acceptLossBps,
  });
  if (planned.kind === "blocked") {
    return { kind: "blocked", reason: planned.reason };
  }
  // Costlier than the soft bound and not yet agreed to. Hand the numbers back
  // so the caller can show them; nothing has been signed.
  if (planned.kind === "needs-confirmation") {
    return {
      kind: "needs-confirmation",
      lossBps: planned.lossBps,
      costUsd: planned.costUsd,
      inputValueUsd: planned.inputValueUsd,
      deliveredValueUsd: planned.deliveredValueUsd,
      reason: planned.reason,
    };
  }
  const plan = planned;

  // Margin baseline read BEFORE funding. Crediting is detected as a rise from
  // here rather than as "margin > 0", so an account that already has collateral
  // posted does not read as instantly credited.
  const marginBefore = await safeMargin(args.readMarginUsd);

  // ── 2. Fund ────────────────────────────────────────────────────────────────
  report({ step: "funding", message: "Converting and delivering to Ondo" });
  let fundingTxHash: string;
  try {
    const res = await executeOndoFunding({
      plan,
      solana: args.solana,
      signal: args.signal,
      onProgress: (funding) =>
        report({ step: "funding", funding, message: "Converting and delivering to Ondo" }),
    });
    fundingTxHash = res.txHash;
  } catch (err) {
    // Nothing settled, so this is still a clean failure the user can retry.
    return {
      kind: "blocked",
      reason: err instanceof Error ? err.message : "The deposit could not be sent.",
    };
  }

  // ── 3. Wait for the credit ────────────────────────────────────────────────
  report({ step: "crediting", message: "Waiting for Ondo to credit the margin" });
  const startedAt = Date.now();
  let creditedMarginUsd = marginBefore;
  while (Date.now() - startedAt < CREDIT_TIMEOUT_MS) {
    if (args.signal?.aborted) break;
    await sleep(CREDIT_POLL_MS, args.signal);
    const now = await safeMargin(args.readMarginUsd);
    // A cent of tolerance: margin drifts with mark price, so require a rise
    // that is clearly a deposit rather than a tick.
    if (now > marginBefore + 0.01) {
      creditedMarginUsd = now;
      break;
    }
  }

  if (creditedMarginUsd <= marginBefore + 0.01) {
    return {
      kind: "funded-not-credited",
      plan,
      fundingTxHash,
      waitedMs: Date.now() - startedAt,
    };
  }

  // ── 4. Hedge ──────────────────────────────────────────────────────────────
  report({ step: "hedging", message: "Opening the short" });
  try {
    const hedge = await openOndoHedge({
      xstockSymbol: args.xstockSymbol,
      quantity: args.quantity,
      tokenPriceUsd: args.tokenPriceUsd,
      hedgeRatio: args.hedgeRatio,
    });
    return { kind: "done", plan, fundingTxHash, creditedMarginUsd, hedge };
  } catch (err) {
    return {
      kind: "funded-not-hedged",
      plan,
      fundingTxHash,
      creditedMarginUsd,
      reason: err instanceof Error ? err.message : "The order was rejected.",
    };
  }
}

async function safeMargin(read: () => Promise<number>): Promise<number> {
  try {
    const v = await read();
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      resolve();
    }, { once: true });
  });
}
