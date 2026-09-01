"use client";

// Opening and closing a position on the perps tab.
//
// The hedge path in order.ts answers "offset this holding". This one answers
// "put this many dollars long or short on this market", which is the same
// transaction with two differences that matter:
//
//   - Direction is an input rather than a constant. A hedge is always a sell;
//     here the user picks, and the slippage bound has to follow that choice.
//     Passing a bound on the wrong side of the mark does not fail, it fills at
//     any price the book offers.
//   - Size comes from a notional the user typed rather than from a holding and
//     a ratio, so there is no exposure to measure the result against.
//
// The three preconditions order.ts documents apply here unchanged, because they
// are properties of the venue rather than of hedging: the WASM signer has to
// hold a client for the account (rebuilt by re-deriving the key, since that
// table does not survive a reload), the nonce has to be read fresh immediately
// before signing, and a key registered seconds ago is not live yet.

import type { EIP1193Provider } from "@privy-io/react-auth";

import { fetchLighterAccountState, submitLighterTx } from "./client";
import { LIGHTER_TX_TYPE_CREATE_ORDER } from "./constants";
import { ensureTradingKey } from "./onboarding";
import { signMarketOrder } from "./signer";
import {
  computeOrderSize,
  slippageBoundPrice,
  toWireInteger,
  type OrderSize,
} from "./sizing";
import type { LighterMarket } from "./types";

// Same 50 bps the hedge path uses, for the same reason: wide enough to fill on
// the equity books, whose spreads sat inside 10 bps when measured, and tight
// enough that a thin book cannot fill the whole order at an arbitrary price.
export const TRADE_SLIPPAGE_BPS = 50;

// Lighter names the side by which half of the book the order rests on. A long
// buys, so it is a bid; a short sells, so it is an ask.
const IS_ASK = 1;
const IS_BID = 0;

export type TradeSide = "long" | "short";

export type LighterTradeOutcome =
  // size is present when opening, where the caller shows what was actually
  // sized after rounding and caps, and absent when closing, where the size was
  // already known.
  | { kind: "submitted"; txHash: string; size?: OrderSize }
  // The trading key was registered by this call and is not usable yet. Poll the
  // account state and retry rather than resubmitting blindly.
  | { kind: "key-registering"; txHash: string }
  // Onboarding is not far enough along to trade: no wallet, or no account
  // because nothing has been deposited.
  | { kind: "not-ready"; reason: string }
  // The order would be rejected by the exchange, with the reason from sizing.
  | { kind: "too-small"; size: OrderSize };

export async function placeLighterTrade(params: {
  provider: EIP1193Provider;
  l1Address: string;
  market: LighterMarket;
  side: TradeSide;
  // What the user asked for, in dollars. Exact decimal string.
  notionalUsd: string;
}): Promise<LighterTradeOutcome> {
  const { onboarding, txHash } = await ensureTradingKey({
    provider: params.provider,
    l1Address: params.l1Address,
  });

  if (txHash) {
    return { kind: "key-registering", txHash };
  }
  if (onboarding.status !== "ready" || onboarding.accountIndex == null) {
    return {
      kind: "not-ready",
      reason:
        onboarding.status === "needs-deposit"
          ? "Deposit USDC to Lighter before trading."
          : "Lighter account is not ready to trade yet.",
    };
  }

  const size = computeOrderSize({
    notionalUsd: params.notionalUsd,
    marketPriceUsd: params.market.markPrice,
    sizeDecimals: params.market.sizeDecimals,
    minBaseAmount: params.market.minBaseAmount,
    minQuoteAmount: params.market.minQuoteAmount,
    orderQuoteLimit: params.market.orderQuoteLimit,
  });

  if (size.baseAmount === "0") {
    return { kind: "too-small", size };
  }

  const isAsk = params.side === "short";
  const bound = slippageBoundPrice(
    params.market.markPrice,
    TRADE_SLIPPAGE_BPS,
    isAsk,
    params.market.priceDecimals,
  );

  const nonce = await currentNonce(params.l1Address);

  const tx = await signMarketOrder({
    accountIndex: onboarding.accountIndex,
    marketIndex: params.market.marketId,
    clientOrderIndex: Date.now(),
    baseAmount: size.baseAmount,
    slippageBoundPrice: bound.wirePrice,
    isAsk: isAsk ? IS_ASK : IS_BID,
    nonce,
  });

  const orderTxHash = await submitLighterTx(
    LIGHTER_TX_TYPE_CREATE_ORDER,
    tx.txInfo,
  );

  return { kind: "submitted", txHash: orderTxHash, size };
}

// Closing is the same market order in the other direction, marked reduce-only
// so it can only ever shrink the position. Without that flag an oversized close
// flips the user into the opposite position rather than stopping at flat, which
// is the opposite of what the button says.
export async function closeLighterPosition(params: {
  provider: EIP1193Provider;
  l1Address: string;
  market: LighterMarket;
  // Size of the open position, in the perp's own units. Unsigned: direction
  // lives in isShort, exactly as it does on LighterPosition.
  size: string;
  isShort: boolean;
}): Promise<LighterTradeOutcome> {
  const { onboarding, txHash } = await ensureTradingKey({
    provider: params.provider,
    l1Address: params.l1Address,
  });

  if (txHash) {
    return { kind: "key-registering", txHash };
  }
  if (onboarding.status !== "ready" || onboarding.accountIndex == null) {
    return {
      kind: "not-ready",
      reason: "Lighter account is not ready to trade yet.",
    };
  }

  // Closing a short buys it back; closing a long sells it. The bound follows,
  // which is the whole reason this is derived rather than passed in.
  const isAsk = !params.isShort;
  const baseAmount = toWireInteger(params.size, params.market.sizeDecimals);
  const bound = slippageBoundPrice(
    params.market.markPrice,
    TRADE_SLIPPAGE_BPS,
    isAsk,
    params.market.priceDecimals,
  );

  const nonce = await currentNonce(params.l1Address);

  const tx = await signMarketOrder({
    accountIndex: onboarding.accountIndex,
    marketIndex: params.market.marketId,
    clientOrderIndex: Date.now(),
    baseAmount,
    slippageBoundPrice: bound.wirePrice,
    isAsk: isAsk ? IS_ASK : IS_BID,
    reduceOnly: 1,
    nonce,
  });

  const orderTxHash = await submitLighterTx(
    LIGHTER_TX_TYPE_CREATE_ORDER,
    tx.txInfo,
  );

  return { kind: "submitted", txHash: orderTxHash };
}

// Re-read rather than trusting the nonce the panel rendered with. Between render
// and submit the user may have traded something else in another tab, and every
// order through our key slot advances the same counter.
//
// Shared with the hedge path in order.ts: both spend the same counter, so both
// have to read it the same way.
export async function currentNonce(l1Address: string): Promise<number> {
  const state = await fetchLighterAccountState(l1Address);
  if (!state.account) {
    throw new Error("Lighter account disappeared before the order was signed");
  }
  return state.nextNonce;
}
