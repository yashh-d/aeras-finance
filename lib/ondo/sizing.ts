// Turning "I hold 12 SPYx" into an order size.
//
// This is the highest-risk arithmetic in the integration, for three reasons:
//
//   1. Ondo's `size` field is base units, never USD. `quoteSize` is USD but is
//      restricted to market buys, and a hedge is a sell, so it is unavailable to
//      us. The conversion has to happen here.
//   2. The index perps are priced at index level, not ETF level, and by a
//      different factor each. US500-USD.P marks near 7751 against SPY's 772, a
//      factor of 10. US100-USD.P marks near 29639 against QQQ's 720, a factor of
//      41. Sizing by share count would open a position that many times too
//      large, and there is no single constant to correct it with.
//   3. Sizes must land on `baseIncrement`, which differs per market (0.0001 on
//      US100-USD.P against 0.001 on US500-USD.P).
//
// All of it runs in scaled BigInt rather than floats: a hedge sized by a value
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

// BigInt division truncates toward zero, which is a floor for the positive
// values used here. Rounding down matters: a hedge that rounds up is larger than
// the exposure it offsets, which turns a hedge into a net short.
function floorTo(value: bigint, increment: bigint): bigint {
  if (increment <= 0n) return value;
  return (value / increment) * increment;
}

export type HedgeSizeLimit = "none" | "market-cap" | "below-increment";

export interface HedgeSizeInput {
  // Tokens of the stock being hedged.
  quantity: string;
  // USD price of one token of that stock, not of the perp.
  tokenPriceUsd: string;
  // Portion of the exposure to offset, 0 to 1.
  hedgeRatio: number;
  // Mark price of the perp being shorted, at index level for the index perps.
  marketPriceUsd: string;
  baseIncrement: string;
  maxPositionBaseSize: string;
}

export interface HedgeSize {
  // Order size in base units, aligned to baseIncrement. "0" means no order.
  size: string;
  // What that size is actually worth, after rounding and caps.
  notionalUsd: string;
  // What we asked for before rounding and caps.
  targetNotionalUsd: string;
  // Full value of the holding being hedged.
  exposureNotionalUsd: string;
  limitedBy: HedgeSizeLimit;
  // Portion of the exposure the order actually offsets. Diverges from the
  // requested ratio when a cap binds, and the UI must show the achieved figure
  // rather than the requested one.
  effectiveRatio: number;
}

export function computeHedgeSize(input: HedgeSizeInput): HedgeSize {
  const { hedgeRatio } = input;
  if (!(hedgeRatio > 0) || hedgeRatio > 1) {
    throw new Error(`Hedge ratio must be between 0 and 1, got ${hedgeRatio}`);
  }

  const marketPrice = parseDecimal(input.marketPriceUsd);
  if (marketPrice <= 0n) {
    throw new Error("Market has no usable price, refusing to size a hedge");
  }

  const quantity = parseDecimal(input.quantity);
  const tokenPrice = parseDecimal(input.tokenPriceUsd);
  const increment = parseDecimal(input.baseIncrement);
  const maxBaseSize = parseDecimal(input.maxPositionBaseSize);

  const exposureNotional = multiply(quantity, tokenPrice);
  // toFixed keeps a UI-supplied float (0.75, 1/3) from carrying binary noise
  // into the order size.
  const ratio = parseDecimal(hedgeRatio.toFixed(6));
  const targetNotional = multiply(exposureNotional, ratio);

  const rawSize = divide(targetNotional, marketPrice);

  let limitedBy: HedgeSizeLimit = "none";
  let size = floorTo(rawSize, increment);

  // Ondo enforces maxPositionBaseSize per market and it is far tighter on
  // US100-USD.P (1.5 base units, roughly $44k) than on US500-USD.P (50, roughly
  // $388k), so a Nasdaq hedge hits it at a size a Nasdaq holder could plausibly
  // reach.
  if (maxBaseSize > 0n && size > maxBaseSize) {
    size = floorTo(maxBaseSize, increment);
    limitedBy = "market-cap";
  }

  if (size <= 0n) {
    return {
      size: "0",
      notionalUsd: "0",
      targetNotionalUsd: formatDecimal(targetNotional),
      exposureNotionalUsd: formatDecimal(exposureNotional),
      limitedBy: limitedBy === "market-cap" ? limitedBy : "below-increment",
      effectiveRatio: 0,
    };
  }

  const notional = multiply(size, marketPrice);

  return {
    size: formatDecimal(size),
    notionalUsd: formatDecimal(notional),
    targetNotionalUsd: formatDecimal(targetNotional),
    exposureNotionalUsd: formatDecimal(exposureNotional),
    limitedBy,
    effectiveRatio:
      exposureNotional > 0n
        ? Number(formatDecimal(divide(notional, exposureNotional)))
        : 0,
  };
}

// Ondo's own ceiling for the account, from GET /v1/perps/max_order_size. A short
// reads maxAskBaseSize; there is no side parameter on that endpoint. Applied
// after computeHedgeSize because it depends on live margin rather than on the
// user's holding.
export function clampToMaxOrderSize(
  size: string,
  maxAskBaseSize: string,
  baseIncrement: string,
): { size: string; clamped: boolean } {
  const requested = parseDecimal(size);
  const allowed = floorTo(parseDecimal(maxAskBaseSize), parseDecimal(baseIncrement));

  if (allowed <= 0n || requested <= allowed) {
    return { size, clamped: false };
  }
  return { size: formatDecimal(allowed), clamped: true };
}
