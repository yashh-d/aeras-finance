import { describe, expect, it } from "vitest";

import { XSTOCKS } from "@/lib/jupiter/xstocks";
import type { LighterMarket } from "@/lib/lighter/types";

import { hedgeRoutes } from "@/lib/lighter/hedge";

import {
  allPerpQuotes,
  catalogQuote,
  CRYPTO_PERPS,
  equityPerpQuotes,
  overviewQuotes,
  perpName,
  perpQuote,
  tapeQuotes,
  underlyingTicker,
  xstockForPerp,
} from "./quotes";
import { selectionForPerp } from "./selection";
import { marketLogo } from "@/lib/tokens/market-logos";

function market(symbol: string, markPrice: string, dailyPriceChange: number) {
  // Only the fields the quote reads; the rest of the shape is irrelevant here.
  return { symbol, markPrice, dailyPriceChange } as unknown as LighterMarket;
}

describe("catalogQuote", () => {
  it("reads price and change off the Jupiter map and is null without it", () => {
    const x = XSTOCKS[0];
    const priced = catalogQuote(x, {
      [x.mint]: { usdPrice: 325.48, priceChange24h: 3.32, liquidity: 0, decimals: 8 },
    });
    expect(priced).toMatchObject({ symbol: x.symbol, price: 325.48, change: 3.32 });
    expect(priced.target).toEqual({ kind: "asset", xstock: x });
    expect(catalogQuote(x, null)).toMatchObject({ price: null, change: null });
  });
});

describe("perpQuote", () => {
  it("uses the mark and labels the symbol as a perp", () => {
    const q = perpQuote("BTC", "Bitcoin", [market("BTC", "76859.4", -1.84)]);
    expect(q).toMatchObject({ symbol: "BTC-PERP", price: 76859.4, change: -1.84 });
    expect(q.target).toEqual({ kind: "perp", symbol: "BTC" });
  });

  it("is unpriced for a missing market or a zero mark", () => {
    expect(perpQuote("BTC", "Bitcoin", [])).toMatchObject({ price: null, change: null });
    expect(perpQuote("BTC", "Bitcoin", [market("BTC", "0", 0)]).price).toBeNull();
  });
});

describe("overviewQuotes and tapeQuotes", () => {
  it("lays out the strip as indices, Bitcoin and Ethereum, gold", () => {
    const strip = overviewQuotes(null, []);
    expect(strip.map((q) => q.symbol)).toEqual([
      "SPYx",
      "QQQx",
      "BTC-PERP",
      "ETH-PERP",
      "XAUt0",
    ]);
    expect(strip[4].name).toBe("Gold, oz");
  });

  it("puts the whole catalog on the tape before the majors, with unique ids", () => {
    const tape = tapeQuotes(null, []);
    expect(tape).toHaveLength(XSTOCKS.length + CRYPTO_PERPS.length);
    expect(new Set(tape.map((q) => q.id)).size).toBe(tape.length);
    expect(tape[0].symbol).toBe(XSTOCKS[0].symbol);
  });
});

describe("equityPerpQuotes", () => {
  it("agrees with every exact hedge route and never picks the dead SPACEX book", () => {
    const exact = hedgeRoutes().filter((r) => r.match === "exact");
    const markets = [
      ...exact.map((r) => market(r.market, "100", 1)),
      market("SPACEX", "2406.9", 0),
    ];
    const bySymbol = new Map(
      equityPerpQuotes(markets).map((q) => [q.target.kind === "perp" ? q.target.symbol : "", q]),
    );
    for (const route of exact) {
      expect(bySymbol.has(route.market), route.xstockSymbol).toBe(true);
      expect(bySymbol.get(route.market)!.name).toBe(
        XSTOCKS.find((x) => x.symbol === route.xstockSymbol)!.name,
      );
    }
    expect(bySymbol.has("SPACEX")).toBe(false);
  });

  it("prefers the market's own mark and falls back to the catalog's", () => {
    // Every catalog underlying has a market mark since 2026-09-12, so the
    // market's own wins for gold; the fallback is pinned on a market the
    // registry cannot know.
    const [gold] = equityPerpQuotes([market("PAXG", "4327", -1.9)]);
    expect(gold.symbol).toBe("PAXG-PERP");
    expect(gold.logo).toBe(marketLogo("PAXG"));
    expect(marketLogo("PAXG")).toBeDefined();
    expect(perpQuote("ZZZ", "Nothing", [market("ZZZ", "1", 0)]).logo).toBeUndefined();
    expect(perpQuote("ZZZ", "Nothing", [market("ZZZ", "1", 0)], "/x.png").logo).toBe("/x.png");
  });

  it("lists only names whose market is present, and keeps catalog order", () => {
    const quotes = equityPerpQuotes([market("TSLA", "363", -0.7), market("AAPL", "325", 2.5)]);
    expect(quotes.map((q) => q.symbol)).toEqual(["AAPL-PERP", "TSLA-PERP"]);
    expect(equityPerpQuotes([])).toEqual([]);
  });

  it("derives the underlying by dropping the x suffix only", () => {
    expect(underlyingTicker({ symbol: "AAPLx" })).toBe("AAPL");
    expect(underlyingTicker({ symbol: "PAXG" })).toBe("PAXG");
    expect(underlyingTicker({ symbol: "XAUt0" })).toBe("XAUt0");
  });
});

describe("every market on the Terminal", () => {
  const markets = [
    { symbol: "HYPE", markPrice: "78.4", dailyPriceChange: 1.2, dailyQuoteVolume: 56e6 },
    { symbol: "AAPL", markPrice: "333", dailyPriceChange: 2.1, dailyQuoteVolume: 2.4e6 },
    { symbol: "BTC", markPrice: "77000", dailyPriceChange: -0.1, dailyQuoteVolume: 857e6 },
    { symbol: "PAXG", markPrice: "4350", dailyPriceChange: 0.6, dailyQuoteVolume: 0.6e6 },
  ] as unknown as LighterMarket[];

  it("names markets by their catalog asset, the majors, or themselves", () => {
    expect(perpName("AAPL")).toBe("Apple");
    expect(perpName("BTC")).toBe("Bitcoin");
    expect(perpName("HYPE")).toBe("HYPE");
    expect(xstockForPerp("AAPL")?.symbol).toBe("AAPLx");
    expect(xstockForPerp("HYPE")).toBeUndefined();
  });

  it("lists every market busiest first, capped, with a mark where the catalog has one", () => {
    const all = allPerpQuotes(markets);
    expect(all.map((q) => q.symbol)).toEqual(["BTC-PERP", "HYPE-PERP", "AAPL-PERP", "PAXG-PERP"]);
    expect(allPerpQuotes(markets, 2).map((q) => q.symbol)).toEqual(["BTC-PERP", "HYPE-PERP"]);
    expect(all.find((q) => q.symbol === "PAXG-PERP")?.logo).toBe(marketLogo("PAXG"));
    // A market with no registry mark and no catalog asset has no mark at all.
    expect(allPerpQuotes([market("ZZZ", "1", 0)])[0].logo).toBeUndefined();
  });

  it("resolves a perp to its catalog asset when it has one, else to the bare market", () => {
    expect(selectionForPerp("AAPL")).toEqual({ kind: "asset", xstock: xstockForPerp("AAPL") });
    expect(selectionForPerp("HYPE")).toEqual({ kind: "perp", symbol: "HYPE" });
  });
});
