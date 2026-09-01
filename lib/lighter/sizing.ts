// Turning "I hold 12 SPYx" into an order Lighter will accept.
//
// Three things make this the highest-risk arithmetic in the integration:
//
//   1. base_amount and price cross the wire as integers scaled by the market's
//      own size_decimals and price_decimals. Those differ per market: SPY takes
//      4 size decimals, AAPL takes 3. Scaling by the wrong one is an order off
//      by a factor of ten.
//   2. Sizing is done by USD notional, never by share count. For the ten exact
//      routes the two are the same number, but GLDx hedges against spot gold at
//      roughly eleven times the ETF price. Notional sizing handles both with one
//      code path and no per-market correction factor, which is the mistake the
//      Ondo integration had to carry.
//   3. Two independent minimums apply, and the USD one usually binds first:
//      min_base_amount is 0.01 SPY, about $7.76, while min_quote_amount is $10.
//
// All of it runs in scaled BigInt rather than floats. A hedge sized by a value
// that drifted in the last binary place is a real position with real money
// behind it. Risk display math in risk.ts uses ordinary numbers, which is fine
// there because nothing is submitted from it.

const SCALE = 18;
const ONE = 10n ** BigInt(SCALE);

const DECIMAL = /^-?(\d+(\.\d*)?|\.\d+)$/;

export function parseDecimal(value: string): bigint {
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) {
    throw new Error(`Not a decimal number: ${value}`);
  }
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  const padded = (fraction + "0".repeat(SCALE)).slice(0, SCALE);
  const scaled = BigInt(whole || "0") * ONE + BigInt(padded);
  return negative ? -scaled : scaled;
}

export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / ONE;
  const fraction = (absolute % ONE).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function multiply(a: bigint, b: bigint): bigint {
  return (a * b) / ONE;
}

function divide(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Cannot divide by zero");
  return (a * ONE) / b;
}

// BigInt division truncates toward zero, a floor for the positive values used
// here. Rounding down matters: a hedge that rounds up is larger than the
// exposure it offsets, which turns a hedge into a net short.
function floorTo(value: bigint, increment: bigint): bigint {
  if (increment <= 0n) return value;
  return (value / increment) * increment;
}

function incrementFor(decimals: number): bigint {
  if (decimals < 0 || decimals > SCALE) {
    throw new Error(`Unsupported decimals: ${decimals}`);
  }
  return 10n ** BigInt(SCALE - decimals);
}

// Decimal string to the integer Lighter expects, scaled by the market's own
// decimals. Truncates rather than rounds, so a value already aligned to the
// increment is unchanged and one that is not can only shrink.
export function toWireInteger(value: string, decimals: number): string {
  const scaled = parseDecimal(value);
  if (scaled < 0n) throw new Error(`Cannot send a negative value: ${value}`);
  return (scaled / incrementFor(decimals)).toString();
}

export type HedgeSizeLimit =
  | "none"
  | "below-min-size"
  | "below-min-notional"
  | "quote-limit";

// The market's own constraints on an order. Every field is read straight off
// LighterMarket, and every one of them differs per market: passing another
// market's decimals or minimums is the failure mode this whole module exists to
// prevent.
export interface MarketLimits {
  marketPriceUsd: string;
  sizeDecimals: number;
  minBaseAmount: string;
  minQuoteAmount: string;
  orderQuoteLimit: string;
}

export interface OrderSize {
  // Order size in the perp's own units, aligned to the market increment. "0"
  // means no order should be sent.
  size: string;
  // The same size as the integer that goes in create_order's base_amount.
  baseAmount: string;
  // What that size is actually worth after rounding and caps.
  notionalUsd: string;
  // What we asked for before rounding and caps.
  targetNotionalUsd: string;
  limitedBy: HedgeSizeLimit;
}

// A USD notional to an order Lighter will accept.
//
// The one place the exchange's three limits are enforced, shared by the hedge
// path and the perps ticket. A hedge arrives here having already turned a
// holding into a notional; a ticket arrives with the notional the user typed.
// Neither should be able to enforce the minimums differently from the other.
function sizeForNotional(
  targetNotional: bigint,
  limits: MarketLimits,
): OrderSize {
  const marketPrice = parseDecimal(limits.marketPriceUsd);
  if (marketPrice <= 0n) {
    throw new Error("Market has no usable price, refusing to size an order");
  }

  const increment = incrementFor(limits.sizeDecimals);
  const minBase = parseDecimal(limits.minBaseAmount);
  const minQuote = parseDecimal(limits.minQuoteAmount);
  const quoteLimit = parseDecimal(limits.orderQuoteLimit);

  let limitedBy: HedgeSizeLimit = "none";
  let target = targetNotional;

  // Clamp the notional before converting to a size, so the cap is expressed in
  // the same units Lighter enforces it in.
  if (quoteLimit > 0n && target > quoteLimit) {
    target = quoteLimit;
    limitedBy = "quote-limit";
  }

  const size = floorTo(divide(target, marketPrice), increment);
  const notional = multiply(size, marketPrice);

  const rejected = (reason: HedgeSizeLimit): OrderSize => ({
    size: "0",
    baseAmount: "0",
    notionalUsd: "0",
    targetNotionalUsd: formatDecimal(targetNotional),
    limitedBy: reason,
  });

  // Both minimums are checked because either can bind first depending on the
  // market. Returning a size the exchange would reject is worse than returning
  // zero with a reason the UI can explain.
  if (size <= 0n || size < minBase) return rejected("below-min-size");
  if (notional < minQuote) return rejected("below-min-notional");

  return {
    size: formatDecimal(size),
    baseAmount: (size / increment).toString(),
    notionalUsd: formatDecimal(notional),
    targetNotionalUsd: formatDecimal(targetNotional),
    limitedBy,
  };
}

// Sizing an order the user asked for in dollars, which is what the perps ticket
// does. No holding, no ratio: the notional is the input rather than something
// derived from an exposure.
//
// Throws on a notional that is not a positive decimal, in keeping with the rest
// of this module: a caller previewing an order as the user types has to guard
// its own input rather than be handed a silently zeroed size.
export function computeOrderSize(
  input: { notionalUsd: string } & MarketLimits,
): OrderSize {
  const target = parseDecimal(input.notionalUsd);
  if (target <= 0n) {
    throw new Error(`Order notional must be positive, got ${input.notionalUsd}`);
  }
  return sizeForNotional(target, input);
}

// marketPriceUsd here is the mark of the perp being shorted, not the price of
// the token being hedged. On a proxy route the two differ by an order of
// magnitude, which is why both appear.
export interface HedgeSizeInput extends MarketLimits {
  // Tokens of the xStock being hedged.
  quantity: string;
  // USD price of one token of that xStock, not of the perp.
  tokenPriceUsd: string;
  // Portion of the exposure to offset, 0 to 1.
  hedgeRatio: number;
}

export interface HedgeSize extends OrderSize {
  // Full value of the holding being hedged.
  exposureNotionalUsd: string;
  // Portion of the exposure the order actually offsets. Diverges from the
  // requested ratio whenever a cap or an increment binds, and the UI must show
  // the achieved figure rather than the requested one.
  effectiveRatio: number;
}

export function computeHedgeSize(input: HedgeSizeInput): HedgeSize {
  const { hedgeRatio } = input;
  if (!(hedgeRatio > 0) || hedgeRatio > 1) {
    throw new Error(`Hedge ratio must be between 0 and 1, got ${hedgeRatio}`);
  }

  const quantity = parseDecimal(input.quantity);
  const tokenPrice = parseDecimal(input.tokenPriceUsd);

  const exposureNotional = multiply(quantity, tokenPrice);
  // toFixed keeps a UI-supplied float (0.75, 1/3) from carrying binary noise
  // into the order size.
  const ratio = parseDecimal(hedgeRatio.toFixed(6));
  const targetNotional = multiply(exposureNotional, ratio);

  // A hedge is a notional like any other order once the exposure has been
  // turned into one. What it adds is the two figures only a hedge has: the
  // exposure it is measured against, and the portion of it actually offset.
  const sized = sizeForNotional(targetNotional, input);
  const notional = parseDecimal(sized.notionalUsd);

  return {
    ...sized,
    exposureNotionalUsd: formatDecimal(exposureNotional),
    effectiveRatio:
      exposureNotional > 0n && notional > 0n
        ? Number(formatDecimal(divide(notional, exposureNotional)))
        : 0,
  };
}

// A market order on Lighter still carries a price, which acts as the worst
// acceptable fill rather than a limit to rest at. The direction is easy to get
// backwards and expensive when you do: a hedge is a sell, so the bound sits
// below the mark. Passing a bound above it would let the order fill at any
// price at all.
export function slippageBoundPrice(
  markPriceUsd: string,
  slippageBps: number,
  isAsk: boolean,
  priceDecimals: number,
): { price: string; wirePrice: string } {
  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error(`Slippage out of range: ${slippageBps} bps`);
  }
  const mark = parseDecimal(markPriceUsd);
  const delta = (mark * BigInt(slippageBps)) / 10000n;
  const bound = isAsk ? mark - delta : mark + delta;
  if (bound <= 0n) throw new Error("Slippage bound collapsed to zero");

  const increment = incrementFor(priceDecimals);
  // Round the bound outward so rounding never tightens the constraint into a
  // no-fill: down for a sell, up for a buy.
  const aligned = isAsk
    ? floorTo(bound, increment)
    : floorTo(bound + increment - 1n, increment);

  return {
    price: formatDecimal(aligned),
    wirePrice: (aligned / increment).toString(),
  };
}
