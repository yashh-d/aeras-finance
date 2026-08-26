import { builderCodeBlock } from "./builder";
import type { OndoOrderRequest } from "./types";

// Building the two orders the hedge ever sends.
//
// Every order in this integration goes through one of these two functions, for
// the same reason lib/lighter/signer.ts owns its market-order construction:
// the field combination Ondo accepts for a market order is narrow, and three of
// the ways to get it wrong are silent or misleading.
//
//   - `type` defaults to "limit". An order that omits both `type` and `price`
//     is rejected as a limit order with no price, not treated as a market
//     order. This is the easiest mistake to make from the docs, where `type` is
//     listed as optional.
//   - `timeInForce` cannot be set on a market order at all. Sending even the
//     default "GTC" alongside `type: "market"` is `invalid_time_in_force`.
//   - `quoteSize` is the USD-denominated size field, and it is accepted only on
//     market *buys*. A hedge is a sell, so the USD notional has to be converted
//     to base units by lib/ondo/sizing.ts before it gets here. There is no
//     shortcut where the exchange does that conversion for a short.
//
// The builder code is attached here rather than at a call site so no order can
// be placed without it. Since guide v1.0.5 removed the JWT-embedded builder
// code, an order that forgets it is simply unattributed, with no error to
// notice.

// A market order needs no price, but the caller has usually just read one.
// Keeping this a separate type from the request makes it obvious that the mark
// price is context for the caller, not something sent to Ondo.
export interface HedgeOrderParams {
  market: string;
  // Base units, already aligned to the market's baseIncrement.
  size: string;
  clientOrderId?: string;
}

// Opening a hedge: sell the perp against a holding the user keeps.
export function buildHedgeOrder(params: HedgeOrderParams): OndoOrderRequest {
  assertSize(params.size);

  return {
    market: params.market,
    side: "sell",
    type: "market",
    size: params.size,
    clientOrderId: params.clientOrderId,
    builderCode: builderCodeBlock(),
  };
}

// Closing a hedge: buy the same perp back, marked reduce-only.
//
// reduceOnly is not a nicety. Without it an oversized close does not stop at
// flat, it crosses through and leaves the user long the perp on top of the
// stock they already hold, which is the opposite of what the button says.
// Ondo enforces the flag with its own error codes (reduce_only_flipping_position,
// reduce_only_increasing_position), so an over-sized close is refused rather
// than silently flipping.
export function buildCloseHedgeOrder(params: HedgeOrderParams): OndoOrderRequest {
  assertSize(params.size);

  return {
    market: params.market,
    side: "buy",
    type: "market",
    size: params.size,
    reduceOnly: true,
    clientOrderId: params.clientOrderId,
    builderCode: builderCodeBlock(),
  };
}

// A trade opened from the perps surface rather than against a holding.
//
// Same construction as a hedge, and deliberately the same function shape, so
// the builder code cannot be dropped on this path either. The differences are
// that either side is allowed and that `reduceOnly` is the caller's choice:
// closing a long is a sell and closing a short is a buy, and both must be
// reduce-only so an oversized close cannot cross through flat into the
// opposite position.
export function buildTradeOrder(
  params: HedgeOrderParams & { side: "buy" | "sell"; reduceOnly?: boolean },
): OndoOrderRequest {
  assertSize(params.size);

  return {
    market: params.market,
    side: params.side,
    type: "market",
    size: params.size,
    reduceOnly: params.reduceOnly,
    clientOrderId: params.clientOrderId,
    builderCode: builderCodeBlock(),
  };
}

// Ondo accepts alphanumerics, underscores and dashes, up to 64 characters. The
// prefix makes our flow identifiable in Ondo's order history without having to
// correlate timestamps.
export function hedgeClientOrderId(kind: "open" | "close" | "trade"): string {
  return `aeras-${kind}-${crypto.randomUUID()}`;
}

function assertSize(size: string): void {
  if (!/^\d+(\.\d+)?$/.test(size) || Number(size) <= 0) {
    throw new Error(`Refusing to send an order with size ${JSON.stringify(size)}`);
  }
}
