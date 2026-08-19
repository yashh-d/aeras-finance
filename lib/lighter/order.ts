"use client";

// Opening and closing a hedge.
//
// The order itself is a market sell on the perp that offsets the holding. What
// makes this more than one call is that three preconditions have to hold at the
// moment of signing, and each fails silently if it does not:
//
//   1. The WASM signer must already hold a client for this account index. That
//      table lives in Go memory and does not survive a reload, so it is rebuilt
//      by re-deriving the key. ensureTradingKey does exactly that, which is why
//      it is called here even for a user who registered weeks ago.
//   2. The nonce must be the current one for our key slot. It is read fresh
//      immediately before signing rather than reused from the state the panel
//      rendered from, because a rejected order still spends the nonce and a
//      stale one is rejected.
//   3. The key must actually be live on Lighter. A first-time user who registers
//      and immediately submits an order signs against a key the sequencer has
//      not seen yet, so that case returns and asks the caller to wait rather
//      than burning the attempt.

import type { EIP1193Provider } from "@privy-io/react-auth";

import { fetchLighterAccountState, submitLighterTx } from "./client";
import { LIGHTER_TX_TYPE_CREATE_ORDER } from "./constants";
import { ensureTradingKey } from "./onboarding";
import { signMarketOrder } from "./signer";
import {
  computeHedgeSize,
  slippageBoundPrice,
  toWireInteger,
  type HedgeSize,
} from "./sizing";
import type { LighterMarket } from "./types";

// A hedge is a taker order on a book we do not control, so some bound is
// required. 50 bps is wide enough to fill on the equity markets, whose spreads
// sat inside 10 bps when measured, and tight enough that a thin book cannot fill
// the whole order at an arbitrary price.
export const HEDGE_SLIPPAGE_BPS = 50;

// A hedge sells the perp. Long the stock, short the perp. Closing one buys it
// back.
const IS_ASK = 1;
const IS_BID = 0;

export type HedgeOrderOutcome =
  // size is present when opening, where the caller needs to show what was
  // actually sized after rounding and caps, and absent when closing, where the
  // size was already known.
  | { kind: "submitted"; txHash: string; size?: HedgeSize }
  // The trading key was registered by this call and is not usable yet. The
  // caller should poll the account state and retry, not resubmit blindly.
  | { kind: "key-registering"; txHash: string }
  // Onboarding is not far enough along to trade: no wallet, or no account
  // because nothing has been deposited.
  | { kind: "not-ready"; reason: string }
  // The order would be rejected by the exchange, with the reason from sizing.
  | { kind: "too-small"; size: HedgeSize };

export interface PlaceHedgeParams {
  provider: EIP1193Provider;
  l1Address: string;
  market: LighterMarket;
  // Tokens of the xStock being hedged, exact decimal string.
  quantity: string;
  // USD price of one xStock token. Differs from the perp mark on a proxy route.
  tokenPriceUsd: string;
  // Portion of the holding to offset, 0 to 1.
  hedgeRatio: number;
}

export async function placeHedge(
  params: PlaceHedgeParams,
): Promise<HedgeOrderOutcome> {
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
          ? "Deposit USDC to Lighter before hedging."
          : "Lighter account is not ready to trade yet.",
    };
  }

  const accountIndex = onboarding.accountIndex;

  const size = computeHedgeSize({
    quantity: params.quantity,
    tokenPriceUsd: params.tokenPriceUsd,
    hedgeRatio: params.hedgeRatio,
    marketPriceUsd: params.market.markPrice,
    sizeDecimals: params.market.sizeDecimals,
    minBaseAmount: params.market.minBaseAmount,
    minQuoteAmount: params.market.minQuoteAmount,
    orderQuoteLimit: params.market.orderQuoteLimit,
  });

  if (size.baseAmount === "0") {
    return { kind: "too-small", size };
  }

  const bound = slippageBoundPrice(
    params.market.markPrice,
    HEDGE_SLIPPAGE_BPS,
    true,
    params.market.priceDecimals,
  );

  const nonce = await currentNonce(params.l1Address);

  const tx = await signMarketOrder({
    accountIndex,
    marketIndex: params.market.marketId,
    clientOrderIndex: Date.now(),
    baseAmount: size.baseAmount,
    slippageBoundPrice: bound.wirePrice,
    isAsk: IS_ASK,
    nonce,
  });

  const orderTxHash = await submitLighterTx(
    LIGHTER_TX_TYPE_CREATE_ORDER,
    tx.txInfo,
  );

  return { kind: "submitted", txHash: orderTxHash, size };
}

// Closing a hedge is the same market order in the other direction, marked
// reduce-only so it can only ever shrink the position. Without that flag an
// oversized close silently flips the user long the perp on top of the stock they
// already hold, which is the opposite of what the button says.
export async function closeHedge(params: {
  provider: EIP1193Provider;
  l1Address: string;
  market: LighterMarket;
  // Size of the open short, in the perp's own units.
  size: string;
}): Promise<HedgeOrderOutcome> {
  const { onboarding, txHash } = await ensureTradingKey({
    provider: params.provider,
    l1Address: params.l1Address,
  });

  if (txHash) {
    return { kind: "key-registering", txHash };
  }
  if (onboarding.status !== "ready" || onboarding.accountIndex == null) {
    return { kind: "not-ready", reason: "Lighter account is not ready to trade yet." };
  }

  const baseAmount = toWireInteger(params.size, params.market.sizeDecimals);
  const bound = slippageBoundPrice(
    params.market.markPrice,
    HEDGE_SLIPPAGE_BPS,
    false,
    params.market.priceDecimals,
  );

  const nonce = await currentNonce(params.l1Address);

  const tx = await signMarketOrder({
    accountIndex: onboarding.accountIndex,
    marketIndex: params.market.marketId,
    clientOrderIndex: Date.now(),
    baseAmount,
    slippageBoundPrice: bound.wirePrice,
    isAsk: IS_BID,
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
// and submit the user may have hedged something else in another tab, and every
// order through our slot advances the same counter.
async function currentNonce(l1Address: string): Promise<number> {
  const state = await fetchLighterAccountState(l1Address);
  if (!state.account) {
    throw new Error("Lighter account disappeared before the order was signed");
  }
  return state.nextNonce;
}
