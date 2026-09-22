// What the Terminal is looking at: a catalog asset, which has a spot ticket
// and may have a perp and a borrow venue, or a bare Lighter market with no
// catalog asset behind it, which has the perp ticket and nothing else.
//
// A perp on a catalog underlying is never a bare selection: "AAPL" resolves to
// Apple in perps mode, so the asset's news, financials and related names stay
// on screen while the perp is traded.

import { xstockForPerp } from "./quotes";
import type { XStock } from "@/lib/jupiter/xstocks";

export type TerminalSelection =
  | { kind: "asset"; xstock: XStock }
  | { kind: "perp"; symbol: string };

export function selectionForPerp(symbol: string): TerminalSelection {
  const xstock = xstockForPerp(symbol);
  return xstock ? { kind: "asset", xstock } : { kind: "perp", symbol };
}

export function selectionId(selection: TerminalSelection): string {
  return selection.kind === "asset"
    ? `asset:${selection.xstock.mint}`
    : `perp:${selection.symbol}`;
}
