// Browser-side read of the news proxy. `key` is a catalog mint for one asset's
// coverage, "market" for the market-wide feeds, or "fed" for the Federal
// Reserve's releases; the route rejects anything else, so there is no way to
// point this at an arbitrary feed.

import type { NewsResponse } from "./types";

export const MARKET_NEWS_KEY = "market";
export const FED_NEWS_KEY = "fed";

export async function fetchNews(key: string): Promise<NewsResponse> {
  const url =
    key === MARKET_NEWS_KEY
      ? "/api/news"
      : key === FED_NEWS_KEY
        ? "/api/news?scope=fed"
        : `/api/news?asset=${encodeURIComponent(key)}`;
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Partial<NewsResponse> & {
    error?: string;
  };
  if (!res.ok || !body.items) {
    throw new Error(body.error ?? `News fetch failed: ${res.status}`);
  }
  return body as NewsResponse;
}
