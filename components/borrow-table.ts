import type { ReactNode } from "react";

import type { BorrowSortRow } from "@/lib/borrow/sort";
import type { XStock } from "@/lib/jupiter/xstocks";

// Column geometry for the Borrow tab's loan-options table, shared by the header,
// every Solana market row in BorrowPanel.tsx and the Aave gold row in
// AaveGoldBorrowCard.tsx, so the figures line up down the whole list.
//
// Each numeric column is a fixed width and is always rendered, including the
// balance column: sizing it to its content would let the two rows the user
// holds shift every column left and break the alignment. Dropped on container
// width, not viewport width. This table renders both full bleed on the Borrow
// tab and inside a two-fifths card on Home, so a viewport breakpoint showed
// every column at desktop sizes and pushed the APY figure off the right edge of
// the narrow placement.
export const COL_SIZE = "hidden w-24 shrink-0 text-right @md:block";
export const COL_LIQUIDITY = "hidden w-24 shrink-0 text-right @xl:block";
export const COL_BALANCE = "hidden w-24 shrink-0 text-right @3xl:block";
export const COL_APY = "w-20 shrink-0 text-right";

// One row of the table, whichever venue it came from.
//
// The three venues read from three different places and their rows used to be
// built and drawn separately, which is why the gold row carried its own copy of
// this markup. They share one model now because the list is sortable: a sort is
// over the whole table, so every row has to be comparable to every other before
// any of them is drawn.
export interface BorrowTableRow extends BorrowSortRow {
  // Stable per venue and market, e.g. "jup-77" or "kamino-<reserve>". Also the
  // expansion key, so only one row in the table is open at a time.
  key: string;
  // What the row's logo badge needs.
  identity: Pick<XStock, "symbol" | "name" | "logo">;
  // The line under the name, e.g. "TSLAx · Jupiter Lend".
  subtitle: string;
  // True while this row's venue has not answered yet, so its figures read as
  // pending rather than as an empty market.
  statsLoading: boolean;
  // The card this row opens. A function, not an element: the table builds every
  // row on every render and only one of these is ever mounted.
  renderBody: () => ReactNode;
}
