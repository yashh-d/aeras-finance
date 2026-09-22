"use client";

// Buy the SOL a first position needs, out of something the wallet already
// holds: its USDC, or a sliver of the very stock being posted as collateral.
//
// The obvious problem with "you need more SOL" is that every way of getting SOL
// costs SOL. A wallet holding 990,000 lamports cannot pay the transient rent on
// a wrapped-SOL account, so an ordinary swap out of USDC fails for the same
// reason the borrow did, one layer down.
//
// Jupiter Ultra settles this. A USDC to SOL order comes back with
// `gasless: true` and rentFeeLamports, signatureFeeLamports and
// prioritizationFeeLamports all zero, verified live on 2026-09-05, so Jupiter
// covers the gas and the user's SOL balance is never touched on the way in.
// That is what makes this the funding path rather than a deposit prompt: it
// works from a zero-SOL wallet, which is exactly the wallet that needs it.
//
// `gasless` is a property of the quote, not a guarantee of the pair, so it is
// read back off every order and the caller is told when it is false rather than
// walking into a fee the wallet cannot pay.
//
// Selling collateral works the same way and for the same reason. Measured live
// on 2026-09-05: TSLAx to SOL, $5.29 in, $5.34 out, gasless true, 0.009% price
// impact. app/api/jupiter/order already permits xStock to SOL, so this needed
// no new route. It is the path that fits this app's actual user, who bought a
// stock here and now wants to borrow against it holding no SOL and no USDC.
//
// Trustware is deliberately NOT used for this. It cannot execute Solana to
// Solana: /route returns a relay selection with no execution.transaction, every
// time, which lib/jupiter/convert.ts documents and
// scripts/trustware-solana-route-check.mts reproduces.

import {
  SOL_MINT,
  USDC_DECIMALS,
  USDC_MINT,
} from "@/lib/jupiter/constants";
import {
  executeUltraOrder,
  fetchUltraOrderViaProxy,
  toAtomic,
} from "@/lib/jupiter/ultra";
import { LAMPORTS_PER_SOL, lamportsToSol } from "./setup-cost";

// Headroom on the USDC side: slippage, the routing fee, and SOL moving between
// the quote and the signature. The overshoot lands in the user's own wallet as
// spendable SOL, so erring high costs them nothing and erring low puts them
// back in front of the failure.
const SIZING_MARGIN = 1.05;

// There is no hardcoded purchase floor, deliberately.
//
// This used to buy a flat $5 minimum on the theory that Ultra refuses gasless
// below it. Jupiter's own docs say the automatic-sponsorship threshold is
// "~$10 (dynamic, varies with current priority fee market)", so $5 was both too
// much for a $3.05 shortfall and too little to guarantee anything. The JupiterZ
// RFQ path has no stated minimum at all.
//
// So: ask for what is actually needed, and let Jupiter say if that is too small.
// It tells us precisely, with errorCode 3 "Swap below minimum for gasless" on an
// aggregator router. Only then does the size go up, and the confirmation screen
// says so before the user signs anything.
//
// Retry size for that case. Above the documented ~$10 so one retry settles it,
// and never applied silently.
const GASLESS_RETRY_USD = 12;

// Jupiter's aggregator error codes. The docs are explicit that these, not the
// message text, are the thing to match on: "the message text may be
// parameterised". Meaningful only when router is metis, dflow or okx.
const AGGREGATOR_ERR_INSUFFICIENT_FUNDS = 1;
const AGGREGATOR_ERR_INSUFFICIENT_SOL = 2;
const AGGREGATOR_ERR_BELOW_GASLESS_MIN = 3;
const AGGREGATOR_ROUTERS = new Set(["metis", "dflow", "okx"]);

// What the wallet can sell to cover a shortfall.
//
// USDC first wherever it exists, because spending it leaves the position alone.
// Collateral second: free and instant, but it shrinks the very deposit the user
// is about to make, which is a real cost even when it is a small one.
export type FundingSource =
  | { kind: "usdc"; balanceUi: number }
  | {
      kind: "collateral";
      symbol: string;
      mint: string;
      decimals: number;
      balanceUi: number;
      priceUsd: number;
    };

export function sourceMint(source: FundingSource): string {
  return source.kind === "usdc" ? USDC_MINT : source.mint;
}

export function sourceDecimals(source: FundingSource): number {
  return source.kind === "usdc" ? USDC_DECIMALS : source.decimals;
}

export function sourceSymbol(source: FundingSource): string {
  return source.kind === "usdc" ? "USDC" : source.symbol;
}

// Dollar value that has to be sold to cover a SOL shortfall, or null when it
// cannot be sized. Exported so the sheet can decide which routes to OFFER
// before the user clicks, rather than presenting a button that fails into an
// error telling them to go and find an asset they do not have.
export function usdNeededFor(
  shortfallLamports: number,
  solPriceUsd: number | null,
): number | null {
  if (solPriceUsd == null || solPriceUsd <= 0) return null;
  return lamportsToSol(shortfallLamports) * solPriceUsd * SIZING_MARGIN;
}

// The same figure in the source's own units: dollars for USDC, tokens for a
// stock. Null when it cannot be sized.
export function sourceAmountNeeded(
  shortfallLamports: number,
  solPriceUsd: number | null,
  source: FundingSource,
): number | null {
  const usd = usdNeededFor(shortfallLamports, solPriceUsd);
  if (usd == null) return null;
  if (source.kind === "usdc") return usd;
  if (source.priceUsd <= 0) return null;
  return usd / source.priceUsd;
}

// Can this source actually cover it? The check the sheet gates each button on.
export function sourceCanCover(
  shortfallLamports: number,
  solPriceUsd: number | null,
  source: FundingSource,
): boolean {
  const needed = sourceAmountNeeded(shortfallLamports, solPriceUsd, source);
  return needed != null && needed <= source.balanceUi;
}

export interface SetupFundingPlan {
  // What is being sold, so the confirmation can name it. "USDC" or "TSLAx".
  sourceSymbol: string;
  sourceKind: FundingSource["kind"];
  // Amount of that source being spent, in its own UI units.
  sourceUi: number;
  // Its dollar value, which is what the setup log records and the confirmation
  // shows for a stock, where "0.0421 TSLAx" means nothing on its own.
  sourceUsd: number;
  // SOL the order expects to deliver.
  expectedLamports: number;
  // False means Jupiter will charge fees for this order, so the wallet needs
  // enough SOL to pay them. The caller must say so rather than proceeding.
  //
  // Read from signatureFeePayer, not the `gasless` flag: the docs call the
  // payer comparison the deterministic check and `gasless` a summary of three
  // separate paths. `gasless` is the fallback when the field is absent.
  gasless: boolean;
  // True when Jupiter refused the amount actually needed as below its gasless
  // minimum and this plan is the larger retry. The confirmation says so, because
  // selling several times what the position costs is not something to slip past
  // someone who is here to spend $3.
  raisedForGasless: boolean;
  requestId: string;
  transaction: string;
}

export class SetupFundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupFundingError";
  }
}

// Size and fetch an order that delivers at least `shortfallLamports` of SOL.
//
// Ultra quotes exact-in, so the USDC amount is derived from the SOL price and
// then checked against what the order actually returns. A single re-quote
// covers the case where the price used for sizing was stale enough to leave the
// order short; two round trips is the ceiling, because a loop here would sit
// between the user and a button.
export async function quoteSetupFunding({
  walletAddress,
  shortfallLamports,
  solPriceUsd,
  source,
}: {
  walletAddress: string;
  shortfallLamports: number;
  solPriceUsd: number | null;
  source: FundingSource;
}): Promise<SetupFundingPlan> {
  if (solPriceUsd == null || solPriceUsd <= 0) {
    throw new SetupFundingError(
      "No SOL price available to size this purchase. Try again in a moment.",
    );
  }

  const symbol = sourceSymbol(source);
  let amountUi = sourceAmountNeeded(shortfallLamports, solPriceUsd, source);
  if (amountUi == null) {
    throw new SetupFundingError(
      `No price available for ${symbol}. Try again in a moment.`,
    );
  }

  if (amountUi > source.balanceUi) {
    // The sheet checks sourceCanCover before offering a route, so reaching this
    // means the balance moved underneath us. It is a guard, not a path a user is
    // meant to hit: with nothing to sell they are offered the funding flow.
    throw new SetupFundingError(
      `This needs about ${amountUi.toFixed(4)} ${symbol} and the wallet holds ${source.balanceUi.toFixed(4)}. Add SOL another way.`,
    );
  }

  let order = await requestOrder(amountUi, source, walletAddress, {
    allowBelowGaslessMin: true,
  });
  let raisedForGasless = false;

  // Jupiter refused this size as below its gasless minimum. That threshold moves
  // with the priority-fee market, so it is discovered here rather than guessed
  // at: retry once, larger, and mark the plan so the confirmation can explain
  // why it is asking for more than the position costs.
  if (belowGaslessMinimum(order)) {
    const retryUi =
      source.kind === "usdc"
        ? GASLESS_RETRY_USD
        : GASLESS_RETRY_USD / source.priceUsd;
    if (retryUi > source.balanceUi) {
      throw new SetupFundingError(
        `Jupiter will not cover the network fee on a swap this small, and there is not enough ${symbol} here to reach its minimum. Add SOL another way.`,
      );
    }
    amountUi = retryUi;
    raisedForGasless = true;
    order = await requestOrder(amountUi, source, walletAddress);
  }

  // The order came back short of what the position needs. Scale by the miss and
  // ask once more.
  if (Number(order.outAmount) < shortfallLamports) {
    const ratio = shortfallLamports / Math.max(Number(order.outAmount), 1);
    amountUi = Math.min(amountUi * ratio * SIZING_MARGIN, source.balanceUi);
    order = await requestOrder(amountUi, source, walletAddress);
    if (Number(order.outAmount) < shortfallLamports) {
      throw new SetupFundingError(
        `Could not buy enough SOL with the ${symbol} in this wallet. Add SOL another way.`,
      );
    }
  }

  return {
    sourceSymbol: symbol,
    sourceKind: source.kind,
    sourceUi: amountUi,
    sourceUsd:
      source.kind === "usdc" ? amountUi : amountUi * source.priceUsd,
    expectedLamports: Number(order.outAmount),
    gasless: isGasless(order, walletAddress),
    raisedForGasless,
    requestId: order.requestId,
    transaction: order.transaction!,
  };
}

// Did Jupiter refuse this order purely for being too small to sponsor?
// Aggregator errorCode 3. Checked on router + code, never on the message.
function belowGaslessMinimum(order: {
  router?: string;
  errorCode?: number;
  transaction?: string;
}): boolean {
  return (
    !order.transaction &&
    AGGREGATOR_ROUTERS.has(order.router ?? "") &&
    order.errorCode === AGGREGATOR_ERR_BELOW_GASLESS_MIN
  );
}

// Will someone other than the user pay the network fee?
//
// The docs call comparing signatureFeePayer to the taker "the deterministic
// opt-out" and describe `gasless` as a summary of three separate paths, so the
// comparison wins where the field exists. This matters: the wallet reading this
// screen holds about 0.001 SOL, so a swap it has to pay for cannot land.
function isGasless(
  order: { signatureFeePayer?: string | null; gasless?: boolean },
  taker: string,
): boolean {
  if (order.signatureFeePayer != null) return order.signatureFeePayer !== taker;
  return order.gasless === true;
}

async function requestOrder(
  amountUi: number,
  source: FundingSource,
  taker: string,
  opts?: { allowBelowGaslessMin?: boolean },
) {
  const order = await fetchUltraOrderViaProxy({
    inputMint: sourceMint(source),
    outputMint: SOL_MINT,
    amount: toAtomic(amountUi, sourceDecimals(source)),
    taker,
  });
  // Ultra reports failures in the body with HTTP 200, so the transaction being
  // absent is the real check, not the status code.
  if (order.error || !order.transaction) {
    // The caller handles this one by retrying larger, so hand it back intact
    // rather than turning it into an error it would have to parse again.
    if (opts?.allowBelowGaslessMin && belowGaslessMinimum(order)) return order;

    const symbol = sourceSymbol(source);
    const aggregator = AGGREGATOR_ROUTERS.has(order.router ?? "");
    // Match on router + code. The docs warn the message text is parameterised
    // and must not be matched on, which is what this used to do.
    if (aggregator && order.errorCode === AGGREGATOR_ERR_INSUFFICIENT_FUNDS) {
      throw new SetupFundingError(
        `Not enough ${symbol} in this wallet to buy the SOL. Add SOL another way.`,
      );
    }
    if (aggregator && order.errorCode === AGGREGATOR_ERR_INSUFFICIENT_SOL) {
      throw new SetupFundingError(
        `This swap needs SOL for the network fee and the wallet has none. Add SOL another way.`,
      );
    }
    throw new SetupFundingError(
      order.errorMessage ?? order.error ?? "Jupiter returned no order for this swap.",
    );
  }
  return order;
}

// Sign the order and hand it back to Ultra to broadcast, which is the flow
// CLAUDE.md specifies: we never broadcast an Ultra transaction ourselves.
export async function executeSetupFunding({
  plan,
  signTxBase64,
}: {
  plan: SetupFundingPlan;
  signTxBase64: (base64Tx: string) => Promise<string>;
}): Promise<string> {
  const signed = await signTxBase64(plan.transaction);
  const result = await executeUltraOrder({
    signedTransaction: signed,
    requestId: plan.requestId,
  });
  if (result.status !== "Success" || !result.signature) {
    throw new SetupFundingError(
      result.error ?? "The SOL purchase did not go through. Nothing was spent.",
    );
  }
  return result.signature;
}

// Wait for the bought SOL to show up before letting the position open.
//
// Ultra confirms the swap, but the balance read behind it can still be a slot
// or two behind, and opening on a stale read would fail the position for the
// exact reason the user just paid to fix. Polls the balance rather than the
// signature, because the balance is the thing the next transaction depends on.
export async function awaitLamports({
  connection,
  walletAddress,
  atLeast,
  timeoutMs = 30_000,
  signal,
}: {
  connection: import("@solana/web3.js").Connection;
  walletAddress: string;
  atLeast: number;
  timeoutMs?: number;
  // Stops the poll early. A card purchase can legitimately take minutes, so
  // this wait is long, and a long wait the user cannot get out of is its own
  // bug: they closed the funding window and the screen kept saying "Waiting".
  signal?: AbortSignal;
}): Promise<number> {
  const { PublicKey } = await import("@solana/web3.js");
  const owner = new PublicKey(walletAddress);
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) return last;
    last = await connection.getBalance(owner, "confirmed");
    if (last >= atLeast) return last;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

export { LAMPORTS_PER_SOL };
