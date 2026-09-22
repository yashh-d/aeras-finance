// Ordering for the Borrow tab's loan-options table.
//
// The table mixes three venues (Jupiter Lend, Kamino, Aave) whose figures come
// from three different reads that land at different times, so the comparator's
// real job is deciding what to do with the ones that have not arrived. It puts
// them last in BOTH directions: ascending by liquidity otherwise opens the list
// with every market we know nothing about, which reads as "these are the
// shallowest" when it means "these have not answered yet".

export type BorrowSortKey = "market" | "size" | "liquidity" | "balance" | "apy";
export type BorrowSortDirection = "asc" | "desc";

export interface BorrowSort {
  key: BorrowSortKey;
  direction: BorrowSortDirection;
}

// What the comparator reads. The row model in the panel carries this plus its
// rendering, so the two can be tested apart.
export interface BorrowSortRow {
  // Display name, e.g. "Tesla". What the Market column shows.
  name: string;
  // "Jupiter Lend", "Kamino", "Aave". Only a tiebreak: the same stock is listed
  // by two venues and those rows must not swap places between renders.
  venue: string;
  sizeUsd: number | null;
  liquidityUsd: number | null;
  // Quantity held. Only its sign matters to the ordering, but it decides the
  // case the dollar figure cannot: a holding whose price has not arrived still
  // outranks holding nothing.
  heldQty: number;
  // Value of the holding, not its quantity. Quantities are in different units
  // down this column (0.05 XAUt against 12 TSLAx), so only the dollar figure
  // compares. Zero means the user holds none; null means it could not be
  // priced.
  heldUsd: number | null;
  aprPct: number | null;
}

// Value of a holding for the Balance column. Nothing held is worth zero and
// needs no price to say so; something held that cannot be priced is unknown,
// and unknown sorts last rather than reading as empty.
export function heldValueUsd(
  quantity: number,
  priceUsd: number | null,
): number | null {
  if (quantity <= 0) return 0;
  return priceUsd != null ? quantity * priceUsd : null;
}

// Which way a column sorts on first click. Money and rates open biggest-first,
// because "where is the deepest market" and "what does it cost" are the
// questions those columns are scanned for. Names open A to Z.
export function defaultDirection(key: BorrowSortKey): BorrowSortDirection {
  return key === "market" ? "asc" : "desc";
}

function numericValue(row: BorrowSortRow, key: BorrowSortKey): number | null {
  switch (key) {
    case "size":
      return row.sizeUsd;
    case "liquidity":
      return row.liquidityUsd;
    case "balance":
      return row.heldUsd;
    case "apy":
      return row.aprPct;
    case "market":
      return null;
  }
}

// Name then venue, always ascending. Applied under every sort so equal figures
// (every Kamino row shares one USDC borrow rate, and unloaded rows share
// nothing at all) keep a fixed order instead of shuffling on each render.
function tieBreak(a: BorrowSortRow, b: BorrowSortRow): number {
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a.venue.localeCompare(b.venue);
}

export function compareBorrowRows(
  a: BorrowSortRow,
  b: BorrowSortRow,
  { key, direction }: BorrowSort,
): number {
  if (key === "market") {
    const ordered = tieBreak(a, b);
    return direction === "asc" ? ordered : -ordered;
  }

  if (key === "balance") {
    // Holding something outranks holding nothing. That is a real comparison
    // rather than a missing figure, so it follows the direction — ascending
    // still opens with the empty markets. It is separated out because a
    // holding that could not be priced has a null value, and left to the
    // numeric rule below it would sort beneath the markets holding nothing.
    const aHeld = a.heldQty > 0 ? 1 : 0;
    const bHeld = b.heldQty > 0 ? 1 : 0;
    if (aHeld !== bHeld) {
      return direction === "desc" ? bHeld - aHeld : aHeld - bHeld;
    }
  }

  const av = numericValue(a, key);
  const bv = numericValue(b, key);
  if (av == null || bv == null) {
    // Both unknown: fall through to the name order rather than calling them
    // equal, so the block of unloaded rows is itself stable.
    if (av == null && bv == null) return tieBreak(a, b);
    return av == null ? 1 : -1;
  }
  if (av === bv) return tieBreak(a, b);
  return direction === "asc" ? av - bv : bv - av;
}

export function sortBorrowRows<T extends BorrowSortRow>(
  rows: readonly T[],
  sort: BorrowSort | null,
): T[] {
  // No sort chosen keeps the catalog order, which groups by venue and is what
  // the list has always opened on.
  if (!sort) return [...rows];
  return [...rows].sort((a, b) => compareBorrowRows(a, b, sort));
}
