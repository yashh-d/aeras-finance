import { describe, expect, it } from "vitest";

import { XSTOCKS } from "@/lib/jupiter/xstocks";

import {
  listedAssetByTicker,
  nasdaqListing,
  relatedAssets,
  sectionsFor,
  sectorOf,
  tradingViewSymbol,
} from "./listing";

describe("nasdaqListing", () => {
  it("lists every company as a stock, the three funds as ETFs, and no metal token", () => {
    for (const x of XSTOCKS) {
      const listing = nasdaqListing(x);
      if (x.category === "stocks") expect(listing?.assetClass, x.symbol).toBe("stocks");
      else if (["SPYx", "QQQx", "GLDx"].includes(x.symbol)) expect(listing?.assetClass, x.symbol).toBe("etf");
      else expect(listing, x.symbol).toBeNull();
    }
  });

  it("offers company sections to companies and quote and summary to funds", () => {
    expect(sectionsFor({ ticker: "AAPL", assetClass: "stocks" })).toContain("financials");
    expect(sectionsFor({ ticker: "SPY", assetClass: "etf" })).toEqual(["quote", "summary"]);
  });

  it("resolves a ticker back to its catalog asset, and nothing else", () => {
    expect(listedAssetByTicker("AAPL")?.xstock.symbol).toBe("AAPLx");
    expect(listedAssetByTicker("GLD")?.listing.assetClass).toBe("etf");
    expect(listedAssetByTicker("PAXG")).toBeUndefined();
    expect(listedAssetByTicker("MU")).toBeUndefined();
  });
});

describe("tradingViewSymbol and sectors", () => {
  it("has a symbol and a sector for every catalog asset", () => {
    for (const x of XSTOCKS) {
      expect(tradingViewSymbol(x), x.symbol).toMatch(/^[A-Z]+:[A-Z]+$/);
      expect(sectorOf(x), x.symbol).not.toBeNull();
    }
  });

  it("relates by sector and never to itself", () => {
    const apple = XSTOCKS.find((x) => x.symbol === "AAPLx")!;
    const related = relatedAssets(apple, 6);
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(6);
    expect(related.every((x) => x.mint !== apple.mint && sectorOf(x) === "Technology")).toBe(true);
  });
});
