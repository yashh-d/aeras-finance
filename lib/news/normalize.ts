// From a feed's raw items to the rows the rail shows: a publisher for every
// row, Google's " - Publisher" suffix taken off the headline, dates parsed, and
// the two or five feeds behind one list merged, deduplicated and ordered.

import type { RawFeedItem } from "./rss";
import type { NewsItem } from "./types";

export function toNewsItem(
  raw: RawFeedItem,
  feed: { name: string | null },
): NewsItem {
  const source = raw.source ?? feed.name ?? publisherFromUrl(raw.link);
  return {
    id: raw.guid ?? raw.link,
    title: stripSourceSuffix(raw.title, source),
    url: raw.link,
    source,
    publishedAt: parseFeedDate(raw.pubDate),
  };
}

// Google News appends " - Publisher" to every title. Removed only when the
// suffix names the source the item already carries, so a headline that
// happens to end in a dash and a word keeps it.
export function stripSourceSuffix(title: string, source: string): string {
  const suffix = ` - ${source}`;
  return title.toLowerCase().endsWith(suffix.toLowerCase())
    ? title.slice(0, -suffix.length).trim()
    : title;
}

// Date.parse reads both the RFC 822 form RSS uses ("Thu, 10 Sep 2026 19:29:06
// +0000", also with "GMT") and the ISO form Atom uses.
export function parseFeedDate(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Yahoo's per-ticker feed carries no publisher and syndicates from dozens of
// sites, so the host is the only signal. Named where the name is well known;
// otherwise the host without its "www.", which is still more useful than
// nothing.
const PUBLISHERS: Readonly<Record<string, string>> = {
  "finance.yahoo.com": "Yahoo Finance",
  "www.fool.com": "The Motley Fool",
  "www.barrons.com": "Barron's",
  "www.reuters.com": "Reuters",
  "www.bloomberg.com": "Bloomberg",
  "www.cnbc.com": "CNBC",
  "www.wsj.com": "WSJ",
  "www.marketwatch.com": "MarketWatch",
  "www.investors.com": "Investor's Business Daily",
  "seekingalpha.com": "Seeking Alpha",
  "www.benzinga.com": "Benzinga",
  "www.zacks.com": "Zacks",
  "247wallst.com": "24/7 Wall St.",
  "www.tipranks.com": "TipRanks",
  "www.thestreet.com": "TheStreet",
  "www.businessinsider.com": "Business Insider",
  "www.forbes.com": "Forbes",
  "www.ft.com": "Financial Times",
  "techcrunch.com": "TechCrunch",
  "www.theverge.com": "The Verge",
  "www.coindesk.com": "CoinDesk",
  "cointelegraph.com": "Cointelegraph",
  "decrypt.co": "Decrypt",
  "www.theblock.co": "The Block",
  "www.nasdaq.com": "Nasdaq",
  "www.investing.com": "Investing.com",
  "www.globenewswire.com": "GlobeNewswire",
  "www.prnewswire.com": "PR Newswire",
  "www.businesswire.com": "Business Wire",
  "stocktwits.com": "Stocktwits",
  "www.moomoo.com": "Moomoo",
  "moomoo.com": "Moomoo",
  "simplywall.st": "Simply Wall St",
  "www.marketbeat.com": "MarketBeat",
  "marketbeat.com": "MarketBeat",
  "tipranks.com": "TipRanks",
  "www.stonex.com": "StoneX",
  "stonex.com": "StoneX",
};

export function publisherFromUrl(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Web";
  }
  // Yahoo syndicates its own stories under regional hosts (sg.finance.yahoo.com,
  // uk.finance.yahoo.com); they are all the one publisher.
  if (host.endsWith(".yahoo.com")) return "Yahoo Finance";
  return PUBLISHERS[host] ?? host.replace(/^www\./, "");
}

// Newest first, undated last, one row per story. A story syndicated to both
// Yahoo and Google arrives twice with different URLs, so the duplicate test is
// the headline with its punctuation and case removed, not the link.
export function mergeNews(lists: readonly NewsItem[][], limit: number): NewsItem[] {
  const all = lists.flat().sort(byNewest);
  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of all) {
    const titleKey = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenTitles.has(titleKey) || seenUrls.has(item.url)) continue;
    seenTitles.add(titleKey);
    seenUrls.add(item.url);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function byNewest(a: NewsItem, b: NewsItem): number {
  if (a.publishedAt == null && b.publishedAt == null) return 0;
  if (a.publishedAt == null) return 1;
  if (b.publishedAt == null) return -1;
  return b.publishedAt - a.publishedAt;
}
