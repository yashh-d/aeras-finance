import { describe, expect, it } from "vitest";

import { XSTOCKS } from "@/lib/jupiter/xstocks";

import { assetCoverage, assetFeeds, googleNewsFeed, MARKET_FEEDS, yahooTickerFeed } from "./feeds";

describe("news feed registry", () => {
  it("covers every catalog asset", () => {
    const missing = XSTOCKS.filter((x) => assetCoverage(x) == null).map((x) => x.symbol);
    expect(missing).toEqual([]);
  });

  it("gives every asset at least the Google feed, and the Yahoo feed only with a ticker", () => {
    for (const x of XSTOCKS) {
      const feeds = assetFeeds(x);
      const coverage = assetCoverage(x)!;
      expect(feeds.length).toBe(coverage.ticker ? 2 : 1);
      expect(feeds[feeds.length - 1].id).toBe(`google:${coverage.query}`);
      for (const feed of feeds) expect(() => new URL(feed.url)).not.toThrow();
    }
  });

  it("encodes the query and ticker into the URL", () => {
    expect(googleNewsFeed("S&P 500").url).toContain("q=S%26P%20500");
    expect(yahooTickerFeed("AAPL").url).toContain("s=AAPL&");
  });

  it("has unique ids across the market feeds", () => {
    const ids = MARKET_FEEDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
