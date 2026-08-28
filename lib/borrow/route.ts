// Which venue lends against a given xStock, and on what terms.
//
// Both venues take many of the same mints, and the two express their terms in
// different units: Jupiter carries collateralFactor and liquidationThreshold in
// tenths of a percent (650 = 65%), Kamino carries max LTV as a fraction (0.55)
// and its liquidation threshold as a whole percent (65). Normalising both to
// fractions is the whole point of this module. Every caller downstream compares
// the two, and a comparison across two unit systems is the kind of bug that
// produces a plausible number rather than an error.
//
// Jupiter is preferred wherever both exist, and on the current numbers that is
// not a coin toss: it lends more and liquidates later on all four overlapping
// mints (TSLAx 65/75 against Kamino's 55/65, SPYx 75/85 against 73/75, QQQx
// 75/85 against 70/72, NVDAx 65/75 against 55/65). Kamino is the fallback that
// carries the mints Jupiter has no vault for at all.
//
// lib/borrow/availability.ts answers the narrower question of whether any venue
// takes a mint. This answers which one, and is the resolver the borrow-funded
// hedge sizes against.

import {
  XSTOCK_BORROW_VAULTS,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import {
  KAMINO_XSTOCK_COLLATERALS,
  type KaminoCollateralReserve,
} from "@/lib/kamino/reserves";

export type BorrowVenue = "jupiter" | "kamino";

export interface BorrowRoute {
  venue: BorrowVenue;
  venueLabel: "Jupiter Lend" | "Kamino";
  collateralSymbol: string;
  collateralMint: string;
  collateralDecimals: number;
  // Both normalised to fractions of 1, whatever the venue's own units were.
  // collateralFactor is the most that may be drawn; liquidationThreshold is
  // where the position becomes liquidatable.
  collateralFactor: number;
  liquidationThreshold: number;
  // Carried so a caller can name the specific market without re-resolving it.
  // Exactly one of the two is set, matching the venue.
  vault?: XStockBorrowVault;
  reserve?: KaminoCollateralReserve;
}

function fromJupiter(vault: XStockBorrowVault): BorrowRoute {
  return {
    venue: "jupiter",
    venueLabel: "Jupiter Lend",
    collateralSymbol: vault.collateralSymbol,
    collateralMint: vault.collateralMint,
    collateralDecimals: vault.collateralDecimals,
    // Tenths of a percent on this venue: 650 is 65%.
    collateralFactor: vault.collateralFactor / 1000,
    liquidationThreshold: vault.liquidationThreshold / 1000,
    vault,
  };
}

function fromKamino(reserve: KaminoCollateralReserve): BorrowRoute {
  return {
    venue: "kamino",
    venueLabel: "Kamino",
    collateralSymbol: reserve.symbol,
    collateralMint: reserve.collateralMint,
    collateralDecimals: reserve.decimals,
    // Already a fraction on this venue.
    collateralFactor: reserve.maxLtvSnapshot,
    // Whole percent on this venue, unlike max LTV directly above it in the same
    // record. This asymmetry is the reason the module exists.
    liquidationThreshold: reserve.liquidationThreshold / 100,
    reserve,
  };
}

// The venue a borrow against this mint should go to, or undefined when neither
// takes it. Jupiter first, Kamino as fallback.
export function borrowRouteFor(mint: string): BorrowRoute | undefined {
  const vault = XSTOCK_BORROW_VAULTS.find((v) => v.collateralMint === mint);
  if (vault) return fromJupiter(vault);

  const reserve = KAMINO_XSTOCK_COLLATERALS.find(
    (c) => c.collateralMint === mint,
  );
  if (reserve) return fromKamino(reserve);

  return undefined;
}

// Every route, Jupiter's first then Kamino's non-overlapping remainder. Used by
// the check script to walk the full surface and by any UI that lists what can be
// borrowed against without asking per mint.
export function borrowRoutes(): BorrowRoute[] {
  const routes = XSTOCK_BORROW_VAULTS.map(fromJupiter);
  const covered = new Set(routes.map((r) => r.collateralMint));
  for (const reserve of KAMINO_XSTOCK_COLLATERALS) {
    if (!covered.has(reserve.collateralMint)) routes.push(fromKamino(reserve));
  }
  return routes;
}

// How much of the collateral factor a plan is allowed to consume.
//
// Borrowing right up to the factor is rejected on chain as soon as the oracle
// ticks down between building the transaction and landing it, and a borrow that
// lands at exactly the cap is one tick from being unwindable only at a loss.
// Ten percent of headroom is what the multiply path already reserves for the
// same reason (see maxLeverageForVault in lib/jupiter/multiply.ts).
export const MAX_BORROW_RATIO_OF_CF = 0.9;

// The most a plan should draw against this route, as a fraction of collateral
// value. Deliberately below the venue's own factor.
export function safeMaxBorrowRatio(route: BorrowRoute): number {
  return route.collateralFactor * MAX_BORROW_RATIO_OF_CF;
}

// Health factor for a position drawn at `borrowRatio` of collateral value.
// Below 1.0 is liquidatable. Matches the definition in docs/jupiter-borrow.md,
// health = LT / LTV, so the two surfaces cannot disagree.
export function healthAt(route: BorrowRoute, borrowRatio: number): number {
  if (borrowRatio <= 0) return Infinity;
  return route.liquidationThreshold / borrowRatio;
}

// How far the collateral price may fall before the position is liquidatable, as
// a fraction of today's price. Debt is fixed while collateral is marked, so the
// position crosses the threshold when price * LT == debt.
export function borrowLiquidationDrop(
  route: BorrowRoute,
  borrowRatio: number,
): number | null {
  if (borrowRatio <= 0) return null;
  const drop = 1 - borrowRatio / route.liquidationThreshold;
  return drop > 0 ? drop : 0;
}
