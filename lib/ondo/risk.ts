import {
  ONDO_AUTO_EXCHANGE_LTV,
  ONDO_CLOSED_MARKET_AE_FEE,
  ONDO_EQUITY_HAIRCUT,
  ONDO_MAX_USDC_DEBT,
} from "./constants";
import type { OndoBalance } from "./types";

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

// The same LTV read off a live account rather than projected from a hedge that
// has not been placed yet.
//
// GET /v1/perps/balance carries no ltv, usdcDebt or nonUsdcMarginValue field,
// but it does carry enough to recover them. Ondo defines
//
//   margin balance = USDC balance + Non-USDC Margin Value + unrealized PnL
//
// so the credited value of the tokenized collateral is whatever the margin
// balance holds that the USDC balance and open PnL do not:
//
//   Non-USDC Margin Value = marginBalance - walletBalance - unrealizedPnl
//   USDC Debt             = marginBalance - Non-USDC Margin Value
//                         = walletBalance + unrealizedPnl
//
// Note this recovers the value *after* Ondo's haircut, because that is what
// enters the margin balance. It does not depend on the hardcoded 10% the
// projection functions use, which makes it the number to trust when both are
// available: a haircut change on Ondo's side moves this one on its own.
export interface LiveCollateralHealth {
  nonUsdcMarginValueUsd: number;
  // Negative when the account owes. Positive is a plain USDC balance, not credit.
  usdcDebtUsd: number;
  ltv: number;
  // Distance to the auto-exchange threshold, in USD of further loss.
  headroomToAutoExchangeUsd: number;
}

export function liveCollateralHealth(
  balance: OndoBalance,
  threshold = ONDO_AUTO_EXCHANGE_LTV,
): LiveCollateralHealth {
  const marginBalance = Number(balance.marginBalance);
  const walletBalance = Number(balance.walletBalance);
  const unrealizedPnl = Number(balance.unrealizedPnl);

  const nonUsdc = marginBalance - walletBalance - unrealizedPnl;
  const debt = walletBalance + unrealizedPnl;

  // No tokenized collateral posted means LTV is undefined rather than zero, but
  // zero is the safe reading: with no collateral there is nothing to auto-sell.
  if (!(nonUsdc > 0)) {
    return {
      nonUsdcMarginValueUsd: Math.max(nonUsdc, 0),
      usdcDebtUsd: debt,
      ltv: 0,
      headroomToAutoExchangeUsd: 0,
    };
  }

  const ltv = debt >= 0 ? 0 : -debt / nonUsdc;

  return {
    nonUsdcMarginValueUsd: nonUsdc,
    usdcDebtUsd: debt,
    ltv,
    headroomToAutoExchangeUsd: Math.max(nonUsdc * threshold + debt, 0),
  };
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
  const byLtv = ltvTriggerMove(input, threshold);
  const byDebtCap = debtCapTriggerMove(input);

  // Ondo fires auto-exchange on whichever limit is reached first:
  //
  //   Allowed USDC Debt = min(Non-USDC Margin Value x 30%, $100,000)
  //
  // Taking only the LTV branch puts the trigger too far away for a large
  // account, where the flat cap binds long before 30% of the collateral does.
  if (byLtv === null) return byDebtCap;
  if (byDebtCap === null) return byLtv;
  return Math.min(byLtv, byDebtCap);
}

function ltvTriggerMove(
  input: HedgeProjectionInput,
  threshold: number,
): number | null {
  const haircut = input.haircut ?? ONDO_EQUITY_HAIRCUT;
  const credited = input.collateralValueUsd * (1 - haircut) * threshold;

  const denominator = input.shortNotionalUsd - credited;
  if (denominator <= 0) return null;

  const move = (input.usdcBalanceUsd + credited) / denominator;
  return move > 0 ? move : 0;
}

// The rally that pushes debt to the flat cap. Debt on a hedge grows with the
// short's loss, so it is reached at
//
//   x = (cap + usdc) / shortNotional
//
// independent of the collateral, which is why it can bind while LTV is still
// comfortable. Null when there is no short to lose money on.
function debtCapTriggerMove(
  input: HedgeProjectionInput,
  cap = ONDO_MAX_USDC_DEBT,
): number | null {
  if (!(input.shortNotionalUsd > 0)) return null;

  const move = (cap + input.usdcBalanceUsd) / input.shortNotionalUsd;
  return move > 0 ? move : 0;
}

// Which of the two limits fires first, for a UI that has to explain why a
// trigger sits where it does. "Collateral" is the LTV threshold, "debt-cap" is
// the flat $100,000 ceiling.
export function autoExchangeTrigger(
  input: HedgeProjectionInput,
  threshold = ONDO_AUTO_EXCHANGE_LTV,
): "ltv" | "debt-cap" | "never" {
  const byLtv = ltvTriggerMove(input, threshold);
  const byDebtCap = debtCapTriggerMove(input);

  if (byLtv === null && byDebtCap === null) return "never";
  if (byLtv === null) return "debt-cap";
  if (byDebtCap === null) return "ltv";
  return byDebtCap < byLtv ? "debt-cap" : "ltv";
}

// What clearing a given debt actually costs in collateral.
//
// Auto-exchange sells enough to clear the debt entirely, plus a 2.5% closed
// -market settlement fee when it fires during a weekend or a US market
// holiday. The fee comes out of the collateral, not as a separate charge, so
// the position loses that much more equity.
//
// Weekends are Friday 20:00 ET to Sunday 20:00 ET. A short hedge accrues debt
// exactly when the market rallies, and this is the window where the collateral
// cannot be sold into an open market, so the expensive case and the likely case
// are the same case.
export function autoExchangeCostUsd(
  debtUsd: number,
  closedMarket: boolean,
  fee = ONDO_CLOSED_MARKET_AE_FEE,
): number {
  const debt = Math.max(debtUsd, 0);
  return closedMarket ? debt * (1 + fee) : debt;
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

// Largest short this collateral can carry without ever reaching the LTV
// threshold. Independent of the USDC balance: USDC delays the trigger but does
// not remove it, because it is a fixed cushion against a loss that grows with
// the rally.
//
// "Never" here means never by LTV. The flat $100,000 debt cap is a separate
// trigger that any short can reach given a large enough move, so a short under
// this figure is not unconditionally safe, only safe from the collateral-ratio
// branch. autoExchangePriceMove accounts for both.
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

// ── Self-collateralized hedge headroom ──────────────────────────────────────

export interface SelfHedgeHeadroomInput {
  // Market value of the collateral posted, before Ondo's haircut.
  collateralUsd: number;
  // Fraction retained after the haircut, e.g. 0.9 for a 10% haircut.
  retained: number;
  // Notional of the short.
  shortNotionalUsd: number;
  // Ondo's maintenance margin rate for the market, e.g. 0.05.
  maintenanceMarginRate: number;
}

// How far the underlying has to move against a self-collateralized hedge before
// it liquidates.
//
// The usual leverage intuition does not apply here, and getting it wrong is the
// difference between a hedge that survives anything and one that dies on a 5%
// move. Collateral and short are the SAME underlying: a rally hurts the short
// and helps the collateral at once, so equity moves at the *difference* of the
// two rather than at the short alone.
//
//   equity(k)      = retained * collateral * k - notional * (k - 1)
//   maintenance(k) = mmr * notional * k
//
// Liquidation is the k where those cross. When the coefficient on k is positive
// the position never liquidates on an upward move, because the collateral gains
// at least as fast as the short loses.
//
// Measured on the live SPCX numbers: posting the whole $18.94 holding against a
// $19.35 short survives a +491% move. Posting only the $2.14 the 10x
// requirement asks for dies at +5%. Same hedge, same notional.
export function selfHedgeLiquidationMove(
  input: SelfHedgeHeadroomInput,
): number | null {
  const { collateralUsd, retained, shortNotionalUsd, maintenanceMarginRate } =
    input;
  if (shortNotionalUsd <= 0 || collateralUsd <= 0) return null;

  const slope =
    retained * collateralUsd -
    shortNotionalUsd -
    maintenanceMarginRate * shortNotionalUsd;
  // Collateral outruns the short: no upward move liquidates it.
  if (slope >= 0) return null;

  const k = shortNotionalUsd / -slope;
  return k - 1;
}
