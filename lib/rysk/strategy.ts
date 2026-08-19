import type { RyskCollateralChoice, RyskOption } from "./types";

// What selling one strike actually commits the user to.
//
// On Rysk the taker is the seller: we write the option, post the collateral and
// receive the premium. So the price we transact at is the maker's bid, never the
// ask. Everything below is derived from `bid` for that reason, and is null when
// no maker has quoted.

export interface RyskTicket {
  option: RyskOption;
  collateral: RyskCollateralChoice;
  quantity: number;
  // What gets locked until expiry: the underlying for a call, the stable for a
  // put. Denominated in `collateral.collateralSymbol`.
  collateralAmount: number;
  // Value of that collateral at the current index price.
  notionalUsd: number;
  premiumUsd: number | null;
  // Premium over posted collateral, for the holding period and annualised from
  // it. Distinct from `option.indicativeApy`, which Rysk models rather than
  // quotes.
  periodYield: number | null;
  annualizedYield: number | null;
  // The price the position effectively transacts at if assigned: strike plus
  // premium when selling a call, strike minus premium when selling a put.
  effectivePrice: number | null;
  // Signed distance of the strike from spot.
  moneyness: number;
}

export function buildTicket(
  option: RyskOption,
  collateral: RyskCollateralChoice,
  quantity: number,
): RyskTicket {
  const perContract = option.bid;

  // A put is secured with strike-worth of stable per contract. A call is secured
  // with the underlying itself, so one contract locks one token.
  const collateralAmount = option.isPut ? option.strike * quantity : quantity;
  const notionalUsd = option.isPut
    ? option.strike * quantity
    : option.indexPrice * quantity;

  const premiumUsd = perContract === null ? null : perContract * quantity;
  const periodYield =
    premiumUsd === null || notionalUsd <= 0 ? null : premiumUsd / notionalUsd;

  // Sub-day expiries would blow this up, and Rysk lists weeklies, so the floor
  // is a guard rather than a real case.
  const annualizedYield =
    periodYield === null
      ? null
      : periodYield * (365 / Math.max(option.daysToExpiry, 0.5));

  const effectivePrice =
    perContract === null
      ? null
      : option.isPut
        ? option.strike - perContract
        : option.strike + perContract;

  return {
    option,
    collateral,
    quantity,
    collateralAmount,
    notionalUsd,
    premiumUsd,
    periodYield,
    annualizedYield,
    effectivePrice,
    moneyness:
      option.indexPrice > 0
        ? (option.strike - option.indexPrice) / option.indexPrice
        : 0,
  };
}

// Rysk settles physically, so assignment moves the collateral itself rather than
// paying a cash difference. Spelling out both branches is the disclosure.
export function assignmentSummary(ticket: RyskTicket): {
  ifAssigned: string;
  ifNotAssigned: string;
} {
  const { option, collateral, quantity } = ticket;
  const size = `${trimNumber(quantity)} ${option.underlying}`;
  const strike = formatUsd(option.strike);

  if (option.isPut) {
    return {
      ifAssigned: `${option.underlying} below ${strike}: your ${trimNumber(ticket.collateralAmount)} ${collateral.collateralSymbol} buys ${size} at ${strike}.`,
      ifNotAssigned: `${option.underlying} at or above ${strike}: the collateral unlocks and you keep the premium.`,
    };
  }

  return {
    ifAssigned: `${option.underlying} above ${strike}: your ${size} sells at ${strike}.`,
    ifNotAssigned: `${option.underlying} at or below ${strike}: the collateral unlocks and you keep the premium.`,
  };
}

export function formatUsd(value: number): string {
  const digits = value >= 100 ? 2 : value >= 1 ? 3 : 6;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })}`;
}

export function formatPercent(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function trimNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

// Showing the UTC hour matters because that is the moment the collateral
// unlocks, and it lands on the previous evening for a US user. The hour is not
// uniform across underlyings, so it is always read from the timestamp rather
// than assumed.
export function formatExpiry(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleString("en-US", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
