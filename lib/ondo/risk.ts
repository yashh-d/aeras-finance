import { ONDO_AUTO_EXCHANGE_LTV, ONDO_EQUITY_HAIRCUT } from "./constants";

// Collateral health for a hedge margined with the stock being hedged.
//
// None of this comes back from the API. GET /v1/perps/balance has no ltv,
// usdcDebt or nonUsdcMarginValue field, so the number that decides whether
// Ondo sells the user's collateral has to be reconstructed here from the
// definitions in Ondo's risk docs:
//
//   Non-USDC Margin Value = collateral market value x (1 - haircut)
//   USDC Debt             = margin balance - Non-USDC Margin Value
//   LTV                   = abs(USDC Debt) / Non-USDC Margin Value
//
// Expanding margin balance as (USDC + haircut collateral + unrealized PnL)
// collapses USDC Debt to just (USDC + unrealized PnL). Debt is therefore not
// borrowing in any conventional sense: it is the account's losses net of its
// stablecoin balance. A hedge is a short, so a rally is what creates it.
//
// Ordinary numbers throughout. Nothing here is submitted; order sizes come from
// sizing.ts, which uses scaled BigInt for exactly that reason.

export interface CollateralPosition {
  // Market value of non-USDC collateral at the current mark, before haircut.
  collateralValueUsd: number;
  // USDC held in the perps account. Offsets losses one for one.
  usdcBalanceUsd: number;
  // Unrealized PnL across all positions. Negative for a short in a rally.
  unrealizedPnlUsd: number;
  haircut?: number;
}

export function collateralLtv(position: CollateralPosition): number {
  const haircut = position.haircut ?? ONDO_EQUITY_HAIRCUT;
  const credited = position.collateralValueUsd * (1 - haircut);
  if (credited <= 0) return 0;

  const debt = position.usdcBalanceUsd + position.unrealizedPnlUsd;
  if (debt >= 0) return 0;

  return -debt / credited;
}

export interface HedgeProjectionInput {
  // Value of the posted collateral at today's price, before haircut.
  collateralValueUsd: number;
  // Notional of the short at entry, from computeHedgeSize.
  shortNotionalUsd: number;
  usdcBalanceUsd: number;
  haircut?: number;
}

// LTV after the underlying moves by `priceMove` (0.1 for a 10% rally).
//
// Assumes the collateral and the perp move together. That holds for an exact
// hedge and is an approximation for the SPYx and QQQx routes, where the
// collateral is the ETF token and the short is the index perp. The gap between
// them is basis risk and is not modelled here.
export function projectLtv(
  input: HedgeProjectionInput,
  priceMove: number,
): number {
  return collateralLtv({
    collateralValueUsd: input.collateralValueUsd * (1 + priceMove),
    usdcBalanceUsd: input.usdcBalanceUsd,
    unrealizedPnlUsd: -input.shortNotionalUsd * priceMove,
    haircut: input.haircut,
  });
}

// The rally that pushes LTV to the auto-exchange threshold, or null when no
// rally does. Solving LTV(x) = threshold for x:
//
//   x = (usdc + threshold x credited) / (notional - threshold x credited)
//
// A non-positive denominator means the short is small enough relative to the
// collateral that LTV converges below the threshold however far the market
// runs. With the 10% equity haircut and the 30% threshold that boundary sits at
// a hedge ratio of 0.27, so any hedge covering more than 27% of the holding has
// a finite trigger.
export function autoExchangePriceMove(
  input: HedgeProjectionInput,
  threshold = ONDO_AUTO_EXCHANGE_LTV,
): number | null {
  const haircut = input.haircut ?? ONDO_EQUITY_HAIRCUT;
  const credited = input.collateralValueUsd * (1 - haircut) * threshold;

  const denominator = input.shortNotionalUsd - credited;
  if (denominator <= 0) return null;

  const move = (input.usdcBalanceUsd + credited) / denominator;
  return move > 0 ? move : 0;
}

// Same trigger expressed as a price, which is what the UI should show. Returns
// null when the position cannot reach the threshold.
export function autoExchangePrice(
  input: HedgeProjectionInput,
  currentPriceUsd: number,
  threshold = ONDO_AUTO_EXCHANGE_LTV,
): number | null {
  const move = autoExchangePriceMove(input, threshold);
  return move === null ? null : currentPriceUsd * (1 + move);
}

// Largest short this collateral can carry without ever reaching the threshold.
// Independent of the USDC balance: USDC delays the trigger but does not remove
// it, because it is a fixed cushion against a loss that grows with the rally.
export function maxSafeNotionalUsd(
  collateralValueUsd: number,
  haircut = ONDO_EQUITY_HAIRCUT,
  threshold = ONDO_AUTO_EXCHANGE_LTV,
): number {
  return collateralValueUsd * (1 - haircut) * threshold;
}

export interface MarginHeadroom {
  // Credited value of the collateral after the haircut.
  creditedMarginUsd: number;
  // Initial margin the short consumes at the market's max leverage.
  requiredMarginUsd: number;
  sufficient: boolean;
}

// Whether the posted collateral covers the short at all. Distinct from the LTV
// question: this is Ondo refusing the order, not Ondo selling the collateral
// later. It is rarely the binding constraint for a hedge, since a 1x hedge on
// 25x-leverage markets consumes about 4% of a 90% credited balance.
export function marginHeadroom(args: {
  collateralValueUsd: number;
  shortNotionalUsd: number;
  maxLeverage: number;
  usdcBalanceUsd?: number;
  haircut?: number;
}): MarginHeadroom {
  const haircut = args.haircut ?? ONDO_EQUITY_HAIRCUT;
  const creditedMarginUsd =
    args.collateralValueUsd * (1 - haircut) + (args.usdcBalanceUsd ?? 0);
  const requiredMarginUsd =
    args.maxLeverage > 0 ? args.shortNotionalUsd / args.maxLeverage : Infinity;

  return {
    creditedMarginUsd,
    requiredMarginUsd,
    sufficient: creditedMarginUsd >= requiredMarginUsd,
  };
}
