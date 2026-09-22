import { describe, expect, it } from "vitest";

import { movers } from "./movers";
import type { Quote } from "./quotes";

function q(symbol: string, change: number | null, price: number | null = 10): Quote {
  return {
    id: symbol,
    symbol,
    name: symbol,
    price,
    change,
    target: { kind: "perp", symbol },
  };
}

describe("movers", () => {
  it("orders gainers by size of rise and losers by size of fall", () => {
    const out = movers([q("A", 1), q("B", 5), q("C", -3), q("D", -0.5), q("E", 2)], 5);
    expect(out.gainers.map((x) => x.symbol)).toEqual(["B", "E", "A"]);
    expect(out.losers.map((x) => x.symbol)).toEqual(["C", "D"]);
  });

  it("caps each side and leaves out the unpriced and the unchanged", () => {
    const out = movers(
      [q("A", 4), q("B", 3), q("C", 2), q("Z", 0), q("N", null), q("P", 9, null), q("L", -1)],
      2,
    );
    expect(out.gainers.map((x) => x.symbol)).toEqual(["A", "B"]);
    expect(out.losers.map((x) => x.symbol)).toEqual(["L"]);
  });
});
