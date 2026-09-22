// One headline, as the Terminal's news rail draws it.
export interface NewsItem {
  // Stable across refreshes so React keys and the dedupe hold: the feed's guid
  // when it has one, else the article URL.
  id: string;
  title: string;
  url: string;
  // Publisher. Google News carries it per item; a single-publisher feed like
  // CNBC's names it once for the whole feed; Yahoo's per-ticker feed does
  // neither, so there it is read off the article's host.
  source: string;
  // Unix milliseconds. Null when the feed gave no parseable date; those sort
  // last rather than being dropped, because a headline with no time is still a
  // headline.
  publishedAt: number | null;
}

export interface NewsResponse {
  items: NewsItem[];
  // When the oldest feed in the merge was last fetched from upstream, so the
  // client can say how fresh the list is without overstating it.
  fetchedAt: number;
  // True when at least one feed was served from a cache past its TTL because
  // upstream failed. The list is still worth showing; it is just older.
  stale: boolean;
}
