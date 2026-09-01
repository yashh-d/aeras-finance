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

import { submitLighterTx } from "./client";
import {
  LIGHTER_MARGIN_MODE_ISOLATED,
  LIGHTER_TX_TYPE_CREATE_ORDER,
  LIGHTER_TX_TYPE_UPDATE_LEVERAGE,
} from "./constants";
import { ensureTradingKey } from "./onboarding";
import { wireInitialMarginFraction } from "./risk";
import { signMarketOrder, signUpdateLeverage } from "./signer";
import {
  computeHedgeSize,
  slippageBoundPrice,
  toWireInteger,
  type HedgeSize,
} from "./sizing";
import { currentNonce } from "./trade";
import type { LighterMarket } from "./types";

// A hedge is a taker order on a book we do not control, so some bound is
// required. 50 bps is wide enough to fill on the equity markets, whose spreads
// sat inside 10 bps when measured, and tight enough that a thin book cannot fill
// the whole order at an arbitrary price.
export const HEDGE_SLIPPAGE_BPS = 50;

// Leverage a hedge is opened at, and the margin mode that makes it mean
// something. 2x rather than the market maximum: a hedge held against a stock is
// a long-lived position, and margin not posted is margin not protecting it.
//
// This lives here, next to the code that SENDS it, rather than in the panel that
// draws it. It used to live in HedgePanel.tsx, and because placeHedge never sent
// an UpdateLeverage at all, the panel quoted margin and a liquidation price for a
// 2x isolated position while the exchange opened a cross position at the market
// default of 6.66%. On a $14.62 hedge the panel said $7.31 and Lighter reserved
// $0.97. Every consumer now reads the same constant as the transaction.
//
// Isolated, not cross, and that is the whole point rather than a detail. Under
// cross, the initial margin fraction changes what is reserved and nothing else:
// liquidation runs off the maintenance fraction against total account equity, so
// a 2x cross hedge would lock up $7.31 and still liquidate where a 15x one does.
// The panel's two figures are only simultaneously true under isolated margin.
//
// The cost is real and belongs in the UI, not in a comment: an isolated hedge is
// walled off, so it liquidates sooner than a cross one and cannot draw on the
// rest of the balance to survive a rally.
export const HEDGE_LEVERAGE = 2;
export const HEDGE_MARGIN_MODE = LIGHTER_MARGIN_MODE_ISOLATED;

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

  // ONE nonce read for BOTH transactions, incremented locally for the second.
  // Reading it again would not work: fetchLighterAccountState caches for four
  // seconds and the leverage transaction lands well inside that window, so the
  // second read returns the nonce the first transaction just spent and the order
  // is rejected. The increment is safe because the leverage submit is awaited,
  // so the sequencer has accepted nonce N before N+1 is signed.
  const nonce = await currentNonce(params.l1Address);

  // Leverage before the order, because the margin requirement is applied at
  // fill: an order that lands first is margined at whatever the market default
  // was, which is the bug this whole path exists to fix.
  //
  // Sent on every hedge rather than only when it differs. The setting is per
  // account per market and no endpoint reports its current value, so "already
  // 2x isolated" is not a state this code can observe. It costs a nonce and a
  // round trip, and Lighter charges no fee for it.
  const leverage = wireInitialMarginFraction(HEDGE_LEVERAGE, params.market);
  const leverageTx = await signUpdateLeverage({
    accountIndex,
    marketIndex: params.market.marketId,
    initialMarginFraction: leverage.fraction,
    marginMode: HEDGE_MARGIN_MODE,
    nonce,
  });

  try {
    await submitLighterTx(LIGHTER_TX_TYPE_UPDATE_LEVERAGE, leverageTx.txInfo);
  } catch (error) {
    // Deliberately fatal rather than falling through to the order. Placing it
    // anyway would open the position at the market default while the panel
    // showed 2x figures, which is exactly the divergence this replaced.
    //
    // OPEN QUESTION, needs a live test: most venues refuse a margin-mode change
    // while a position is open in that market. If adding to an existing hedge
    // starts failing here, that is the cause, and the fix is to skip this step
    // when the account already holds a position in this market (and to send the
    // order under `nonce`, not `nonce + 1`, since a rejected transaction spends
    // no nonce).
    throw new Error(
      `Could not set ${leverage.leverage}x isolated margin on ${params.market.symbol}, ` +
        `so the hedge was not placed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const tx = await signMarketOrder({
    accountIndex,
    marketIndex: params.market.marketId,
    clientOrderIndex: Date.now(),
    baseAmount: size.baseAmount,
    slippageBoundPrice: bound.wirePrice,
    isAsk: IS_ASK,
    nonce: nonce + 1,
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
