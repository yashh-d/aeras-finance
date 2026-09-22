import { describe, expect, it } from "vitest";

import {
  defaultDirection,
  sortBorrowRows,
  type BorrowSortRow,
} from "./sort";

function row(
  name: string,
  venue: string,
  fields: Partial<Omit<BorrowSortRow, "name" | "venue">> = {},
): BorrowSortRow {
  return {
    name,
    venue,
    sizeUsd: null,
    liquidityUsd: null,
    heldQty: 0,
    heldUsd: null,
    aprPct: null,
    ...fields,
  };
}

const names = (rows: BorrowSortRow[]) => rows.map((r) => r.name);

describe("sortBorrowRows", () => {
  it("keeps catalog order when no sort is chosen", () => {
    const rows = [row("Tesla", "Kamino"), row("Apple", "Jupiter Lend")];
    expect(names(sortBorrowRows(rows, null))).toEqual(["Tesla", "Apple"]);
  });

  it("sorts by market size, biggest first by default", () => {
    const rows = [
      row("Apple", "Jupiter Lend", { sizeUsd: 1_000 }),
      row("Tesla", "Jupiter Lend", { sizeUsd: 9_000 }),
      row("SPDR", "Kamino", { sizeUsd: 5_000 }),
    ];
    expect(
      names(sortBorrowRows(rows, { key: "size", direction: "desc" })),
    ).toEqual(["Tesla", "SPDR", "Apple"]);
    expect(
      names(sortBorrowRows(rows, { key: "size", direction: "asc" })),
    ).toEqual(["Apple", "SPDR", "Tesla"]);
  });

  it("puts markets with no figure last in both directions", () => {
    const rows = [
      row("Unloaded", "Kamino"),
      row("Apple", "Jupiter Lend", { liquidityUsd: 1_000 }),
      row("Tesla", "Jupiter Lend", { liquidityUsd: 9_000 }),
    ];
    expect(
      names(sortBorrowRows(rows, { key: "liquidity", direction: "desc" })),
    ).toEqual(["Tesla", "Apple", "Unloaded"]);
    expect(
      names(sortBorrowRows(rows, { key: "liquidity", direction: "asc" })),
    ).toEqual(["Apple", "Tesla", "Unloaded"]);
  });

  it("ranks a holding above an empty market even when it cannot be priced", () => {
    // The price feed can fail while the balances load fine. A row showing a
    // quantity must not fall below rows showing a dash.
    const rows = [
      row("Empty", "Jupiter Lend", { heldQty: 0, heldUsd: 0 }),
      row("Unpriced", "Kamino", { heldQty: 3, heldUsd: null }),
      row("Held", "Jupiter Lend", { heldQty: 1, heldUsd: 42 }),
    ];
    expect(
      names(sortBorrowRows(rows, { key: "balance", direction: "desc" })),
    ).toEqual(["Held", "Unpriced", "Empty"]);
    // Ascending still opens with the empty markets: zero is a real value, not
    // a missing one.
    expect(
      names(sortBorrowRows(rows, { key: "balance", direction: "asc" })),
    ).toEqual(["Empty", "Held", "Unpriced"]);
  });

  it("orders held balances by value, biggest first", () => {
    const rows = [
      row("Small", "Kamino", { heldQty: 1, heldUsd: 5 }),
      row("Big", "Jupiter Lend", { heldQty: 1, heldUsd: 500 }),
      row("Empty", "Kamino", { heldQty: 0, heldUsd: 0 }),
    ];
    expect(
      names(sortBorrowRows(rows, { key: "balance", direction: "desc" })),
    ).toEqual(["Big", "Small", "Empty"]);
  });

  it("breaks ties by name then venue, whatever the direction", () => {
    // Every Kamino market shares one USDC borrow rate, so ties are the norm.
    const rows = [
      row("Tesla", "Kamino", { aprPct: 7.5 }),
      row("Apple", "Kamino", { aprPct: 7.5 }),
      row("Apple", "Jupiter Lend", { aprPct: 7.5 }),
    ];
    expect(
      names(
        sortBorrowRows(rows, { key: "apy", direction: "desc" }),
      ),
    ).toEqual(["Apple", "Apple", "Tesla"]);
    expect(
      sortBorrowRows(rows, { key: "apy", direction: "desc" }).map((r) => r.venue),
    ).toEqual(["Jupiter Lend", "Kamino", "Kamino"]);
  });

  it("sorts by name, and reverses on the second click", () => {
    const rows = [
      row("Tesla", "Jupiter Lend"),
      row("Apple", "Jupiter Lend"),
      row("Nvidia", "Kamino"),
    ];
    expect(
      names(sortBorrowRows(rows, { key: "market", direction: "asc" })),
    ).toEqual(["Apple", "Nvidia", "Tesla"]);
    expect(
      names(sortBorrowRows(rows, { key: "market", direction: "desc" })),
    ).toEqual(["Tesla", "Nvidia", "Apple"]);
  });

  it("opens names A to Z and figures biggest first", () => {
    expect(defaultDirection("market")).toBe("asc");
    for (const key of ["size", "liquidity", "balance", "apy"] as const) {
      expect(defaultDirection(key)).toBe("desc");
    }
  });

  it("does not mutate the input", () => {
    const rows = [
      row("Tesla", "Jupiter Lend", { sizeUsd: 1 }),
      row("Apple", "Jupiter Lend", { sizeUsd: 9 }),
    ];
    sortBorrowRows(rows, { key: "size", direction: "desc" });
    expect(names(rows)).toEqual(["Tesla", "Apple"]);
  });
});
