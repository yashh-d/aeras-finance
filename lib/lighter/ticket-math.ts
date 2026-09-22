// The figures the perps ticket derives from a chosen leverage. Display
// arithmetic in ordinary numbers, as risk.ts is; nothing here is submitted.

import { marginForLeverage } from "./risk";
import type { LighterMarket } from "./types";

// What the ticket opens at when the user has not moved the control. Moderate
// on purpose: a perps ticket is used by people who did not come to hedge, and
// the market maximum is the wrong first number to put in front of them.
export const DEFAULT_TICKET_LEVERAGE = 5;

export function clampLeverage(leverage: number, market: LighterMarket): number {
  return Math.max(1, Math.min(Math.floor(leverage), market.maxLeverage));
}

// The largest order the free margin covers at this leverage, capped by the
// exchange's per-order limit so 100% is never a size the venue would refuse.
export function maxNotionalUsd(
  availableMarginUsd: number,
  leverage: number,
  market: LighterMarket,
): number {
  const { leverage: allowed } = marginForLeverage(1, leverage, market);
  const byMargin = Math.max(0, availableMarginUsd) * allowed;
  const byOrderCap = Number(market.orderQuoteLimit);
  return Number.isFinite(byOrderCap) && byOrderCap > 0
    ? Math.min(byMargin, byOrderCap)
    : byMargin;
}
