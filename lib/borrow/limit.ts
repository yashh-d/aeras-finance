// Borrow limits, computed the way the protocols compute them.
//
// Every figure here is derived with integer arithmetic on atomic units and a
// fixed-point price, and every division floors. That is not fastidiousness: a
// borrow limit quoted a fraction above what the chain will allow is a
// transaction that fails simulation, and one quoted from a float that rounded
// up is the same thing with a harder-to-find cause. Floats are allowed only at
// the edges, for display.
//
// Nothing in this module reads the network or React. It takes the venue's own
// published parameters and returns a number; the callers are responsible for
// passing live values rather than registry snapshots.

// Prices are carried as integers scaled by 10^PRICE_SCALE. 15 is Jupiter's own
// scale for xStock vault oracles, so its payload needs no reinterpretation.
export const PRICE_SCALE = 15;
const PRICE_ONE = 10n ** BigInt(PRICE_SCALE);

// Loan-to-value ratios are carried in basis points. Both venues publish theirs
// in different units and both convert exactly: Kamino as a decimal string
// ("0.6"), Jupiter as an integer per mille ("650").
const BPS_ONE = 10_000n;

/**
 * Parse a non-negative decimal string into an integer scaled by 10^scale.
 *
 * Exact, and deliberately not `Number(s) * 10 ** scale`: that route puts an
 * oracle price through a binary float on the way to a transaction amount.
 * Digits past the scale are truncated rather than rounded, which keeps every
 * rounding in this module in the same direction.
 */
export function parseScaled(value: string, scale: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Not a non-negative decimal: ${value}`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(scale)).slice(0, scale);
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded || "0");
}

/** A Kamino `maxLtv` ("0.6") as basis points (6000n). */
export function ltvBpsFromDecimal(maxLtv: string): bigint {
  return parseScaled(maxLtv, 4);
}

/** A Jupiter `collateralFactor` ("650", per mille) as basis points (6500n). */
export function ltvBpsFromPerMille(factor: string | number): bigint {
  return BigInt(factor) * 10n;
}

/** An oracle price in USD per whole token, as a decimal string. */
export function priceFromDecimal(usdPerToken: string): bigint {
  return parseScaled(usdPerToken, PRICE_SCALE);
}

/**
 * A Jupiter oracle price, which the API already publishes scaled by 1e15.
 *
 * Use `oraclePriceOperate` for anything that sizes a borrow or a withdrawal,
 * never the plain `oraclePrice`: the protocol marks operations and liquidations
 * at separately configured prices, and sizing a borrow at the liquidation mark
 * quotes a limit the chain will not honour. They are frequently equal, which is
 * exactly what makes reading the wrong one easy to miss.
 */
export function priceFromJupiterOracle(raw: string | number | bigint): bigint {
  return BigInt(raw);
}

export interface CollateralInput {
  // Atomic units of the collateral token.
  atomic: bigint;
  decimals: number;
  // Oracle price, scaled by 10^PRICE_SCALE. The venue's own mark, not a price
  // map: liquidation is judged at the venue's oracle, so a limit derived from
  // anything else is a different number from the one the chain enforces.
  priceScaled: bigint;
  // Max LTV in basis points.
  ltvBps: bigint;
}

/**
 * The most that can be drawn against a pool of collateral, in atomic units of
 * the borrow token. Floors, so the result is always drawable.
 *
 * limit = collateral x price x ltv, converted into the borrow token's units.
 * Multiplications are applied before any division so no intermediate is
 * truncated early.
 */
export function borrowLimitAtomic(
  collateral: CollateralInput,
  borrowDecimals: number,
): bigint {
  if (collateral.atomic <= 0n) return 0n;
  const numerator =
    collateral.atomic *
    collateral.priceScaled *
    collateral.ltvBps *
    10n ** BigInt(borrowDecimals);
  const denominator =
    10n ** BigInt(collateral.decimals) * PRICE_ONE * BPS_ONE;
  return numerator / denominator;
}

/** Sum of the limits of several pools, each with its own price and LTV. */
export function totalBorrowLimitAtomic(
  pools: readonly CollateralInput[],
  borrowDecimals: number,
): bigint {
  let total = 0n;
  for (const pool of pools) total += borrowLimitAtomic(pool, borrowDecimals);
  return total;
}

export interface AvailableInput {
  // Collateral already posted at the venue, plus anything the form will post as
  // part of the same borrow. See the note on double counting below.
  pools: readonly CollateralInput[];
  borrowDecimals: number;
  // Debt already outstanding against these pools, in atomic units.
  debtAtomic: bigint;
  // Undrawn liquidity at the venue. Headroom earned by collateral is not
  // drawable from a market that has already lent everything out, so this caps
  // the answer. Undefined where the caller has not read it.
  liquidityAtomic?: bigint;
  // The venue's smallest permitted borrow, where it publishes one. A quote
  // below this is not a small borrow, it is a failed one, so it comes back as
  // zero rather than as an amount the user can submit.
  minimumBorrowAtomic?: bigint;
}

/**
 * What can actually be drawn right now, in atomic units of the borrow token.
 *
 * A note on double counting, which is the bug that prompted this module.
 * `pools` must not contain the same tokens twice. Collateral posted at the
 * venue and collateral sitting in the wallet are two pools, and a deposit moves
 * tokens from the second to the first in a single transaction -- so they can
 * only ever be read as overlapping if they are read at different points in
 * time. Read the wallet side at `processed` commitment and the invariant holds
 * in the safe direction: `processed` is never behind a confirmed deposit, so
 * spent stock cannot still be counted in the wallet, while a venue read that
 * lags simply under-quotes.
 */
export function availableToBorrowAtomic(input: AvailableInput): bigint {
  const limit = totalBorrowLimitAtomic(input.pools, input.borrowDecimals);
  let available = limit - input.debtAtomic;
  if (available <= 0n) return 0n;
  if (input.liquidityAtomic != null && input.liquidityAtomic < available) {
    available = input.liquidityAtomic;
  }
  if (available <= 0n) return 0n;
  if (input.minimumBorrowAtomic != null && available < input.minimumBorrowAtomic) {
    return 0n;
  }
  return available;
}

/**
 * Atomic units to a float, for display only.
 *
 * Never feed the result back into a transaction amount: that is the round trip
 * this module exists to keep out of the borrow path.
 */
export function atomicToNumber(atomic: bigint, decimals: number): number {
  return Number(atomic) / 10 ** decimals;
}
