// Where the Terminal's headlines come from. Two kinds of list, both public RSS
// with no key: the market-wide feeds, and per catalog asset, the underlying
// company's coverage.
//
// Per asset there are two sources, because each fails differently. Yahoo
// Finance files headlines under the underlying's ticker and syndicates from
// many publishers, so it is broad, but it needs a browser-like User-Agent
// (a bare fetch is answered 404) and it has nothing for the gold tokens.
// Google News search takes any query, so it covers those and names the
// publisher per item. Both are fetched, merged and deduplicated, so a story
// on both shows once.
//
// Every feed here answered on 2026-09-10; scripts/news-feeds-check.mts is the
// live check. These are third-party endpoints with no contract, so if one
// goes quiet the rail degrades to the other source rather than to nothing.

import type { XStock } from "@/lib/jupiter/xstocks";

export interface NewsFeed {
  // Cache key. Stable and unique across every feed the app reads.
  id: string;
  // Publisher when the feed is one publisher's own. Null when items come from
  // many, in which case the publisher is read per item or from the link.
  name: string | null;
  url: string;
}

export const MARKET_FEEDS: readonly NewsFeed[] = [
  {
    id: "cnbc-finance",
    name: "CNBC",
    url: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
  },
  {
    id: "wsj-markets",
    name: "WSJ",
    url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
  },
  {
    id: "marketwatch-top",
    name: "MarketWatch",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
  },
  {
    id: "bloomberg-markets",
    name: "Bloomberg",
    url: "https://feeds.bloomberg.com/markets/news.rss",
  },
  {
    id: "yahoo-top",
    name: "Yahoo Finance",
    url: "https://finance.yahoo.com/rss/topstories",
  },
] as const;

// The Fed's own releases: FOMC statements and minutes, and speeches. Both
// are the Board's RSS, keyless, and answered on 2026-09-10.
export const FED_FEEDS: readonly NewsFeed[] = [
  {
    id: "fed-monetary",
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml",
  },
  {
    id: "fed-speeches",
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/speeches.xml",
  },
] as const;

interface AssetCoverage {
  // The exchange ticker Yahoo files the company under. Null where the asset has
  // none (bullion tokens), which drops the Yahoo feed and leaves the query.
  ticker: string | null;
  // The Google News search. Company name and ticker together: the name alone
  // pulls consumer stories ("Apple" is also a fruit and a record label) and the
  // ticker alone pulls stock-screener spam.
  query: string;
}

// Keyed by catalog symbol. lib/news/feeds.test.ts asserts every catalog entry
// is here, so adding an asset without adding its coverage fails CI rather
// than rendering an empty rail.
const COVERAGE: Readonly<Record<string, AssetCoverage>> = {
  AAPLx: { ticker: "AAPL", query: "Apple AAPL" },
  TSLAx: { ticker: "TSLA", query: "Tesla TSLA" },
  NVDAx: { ticker: "NVDA", query: "Nvidia NVDA" },
  MSFTx: { ticker: "MSFT", query: "Microsoft MSFT" },
  AMZNx: { ticker: "AMZN", query: "Amazon AMZN" },
  METAx: { ticker: "META", query: "Meta Platforms META" },
  GOOGLx: { ticker: "GOOGL", query: "Alphabet GOOGL" },
  COINx: { ticker: "COIN", query: "Coinbase COIN" },
  CRCLx: { ticker: "CRCL", query: "Circle CRCL stock" },
  MSTRx: { ticker: "MSTR", query: "Strategy MSTR bitcoin" },
  SPYx: { ticker: "SPY", query: "S&P 500" },
  QQQx: { ticker: "QQQ", query: "Nasdaq 100" },
  // Yahoo files SpaceX under SPCX with real coverage, checked live; the
  // query is the name alone because the ticker is too new to help.
  SPCXx: { ticker: "SPCX", query: "SpaceX" },
  HOODx: { ticker: "HOOD", query: "Robinhood HOOD" },
  PLTRx: { ticker: "PLTR", query: "Palantir PLTR" },
  MCDx: { ticker: "MCD", query: "McDonald's MCD" },
  AVGOx: { ticker: "AVGO", query: "Broadcom AVGO" },
  GLDx: { ticker: "GLD", query: "gold price" },
  // Bullion. Yahoo has no feed for either token (PAXG returns an empty
  // channel), and the news that moves them is the metal's.
  PAXG: { ticker: null, query: "gold price" },
  XAUt0: { ticker: null, query: "gold price" },
};

export function assetCoverage(xstock: XStock): AssetCoverage | undefined {
  return COVERAGE[xstock.symbol];
}

export function yahooTickerFeed(ticker: string): NewsFeed {
  return {
    id: `yahoo:${ticker}`,
    name: null,
    url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`,
  };
}

export function googleNewsFeed(query: string): NewsFeed {
  return {
    id: `google:${query}`,
    name: null,
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
  };
}

// The feeds behind one asset's rail. Empty only for an asset with no coverage
// entry, which the test above prevents.
export function assetFeeds(xstock: XStock): NewsFeed[] {
  const coverage = assetCoverage(xstock);
  if (!coverage) return [];
  const feeds: NewsFeed[] = [];
  if (coverage.ticker) feeds.push(yahooTickerFeed(coverage.ticker));
  feeds.push(googleNewsFeed(coverage.query));
  return feeds;
}
