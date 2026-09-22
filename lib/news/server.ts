// Server-side feed reads for app/api/news. Nothing in the browser fetches a
// feed: the CSP confines it to our origin, Yahoo wants a User-Agent, and one
// cache here serves every viewer where per-browser fetches would hit five
// publishers once per user per refresh.
//
// Each feed is cached on its own for five minutes and coalesced while a fetch
// is in flight. On a failure the cached copy is served for up to an hour past
// its TTL and the response says so, the same stale-on-error shape the chart
// and candle routes use, because a rail that was full a minute ago is more
// useful than an error while a publisher's edge is briefly unhappy.

import type { NewsFeed } from "./feeds";
import { mergeNews, toNewsItem } from "./normalize";
import { parseFeedItems } from "./rss";
import type { NewsItem, NewsResponse } from "./types";

const FEED_TTL_MS = 5 * 60_000;
const STALE_MAX_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;
// Yahoo's feed host answers 404 to anything that does not look like a browser.
// The product name is kept in so a publisher looking at their logs can see
// who is reading.
const USER_AGENT = "Mozilla/5.0 (compatible; AerasFinance/0.1)";
// Per feed, before the merge. A per-ticker feed carries about twenty; the
// market feeds up to fifty, and the rail shows far fewer than that.
const PER_FEED_LIMIT = 50;

interface CacheEntry {
  items: NewsItem[];
  fetchedAt: number;
}

interface FeedResult extends CacheEntry {
  stale: boolean;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

export async function fetchFeed(feed: NewsFeed): Promise<FeedResult> {
  const cached = cache.get(feed.id);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < FEED_TTL_MS) {
    return { ...cached, stale: false };
  }
  try {
    const fresh = await loadFeed(feed);
    return { ...fresh, stale: false };
  } catch (err) {
    if (cached && now - cached.fetchedAt < STALE_MAX_MS) {
      return { ...cached, stale: true };
    }
    throw err;
  }
}

function loadFeed(feed: NewsFeed): Promise<CacheEntry> {
  const pending = inFlight.get(feed.id);
  if (pending) return pending;
  const run = (async () => {
    const res = await fetch(feed.url, {
      cache: "no-store",
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${feed.id}: HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeedItems(xml)
      .slice(0, PER_FEED_LIMIT)
      .map((raw) => toNewsItem(raw, feed));
    const entry: CacheEntry = { items, fetchedAt: Date.now() };
    cache.set(feed.id, entry);
    return entry;
  })().finally(() => {
    inFlight.delete(feed.id);
  });
  inFlight.set(feed.id, run);
  return run;
}

// All feeds in parallel, merged. Feeds that fail with nothing cached are left
// out; the call fails only when every feed did, so a per-ticker rail with
// Yahoo down still shows Google's items.
export async function loadNews(
  feeds: readonly NewsFeed[],
  limit: number,
): Promise<NewsResponse> {
  const settled = await Promise.allSettled(feeds.map(fetchFeed));
  const ok: FeedResult[] = [];
  let firstError: unknown = null;
  for (const result of settled) {
    if (result.status === "fulfilled") ok.push(result.value);
    else if (firstError == null) firstError = result.reason;
  }
  if (ok.length === 0) {
    throw firstError instanceof Error
      ? firstError
      : new Error("No news feed answered");
  }
  return {
    items: mergeNews(
      ok.map((r) => r.items),
      limit,
    ),
    fetchedAt: Math.min(...ok.map((r) => r.fetchedAt)),
    stale: ok.some((r) => r.stale),
  };
}
