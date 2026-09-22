// Live check of every feed the Terminal reads: the market-wide feeds, and the
// per-asset coverage for each catalog entry. Prints what each returned and
// fails if a market feed errors or a catalog asset has no headlines at all
// across its feeds.
//
// These are third-party RSS endpoints with no contract. Run after touching
// lib/news/feeds.ts, and when the rail looks thin in production.
//
//   npx tsx scripts/news-feeds-check.mts

import { XSTOCKS } from "../lib/jupiter/xstocks";
import { assetFeeds, FED_FEEDS, MARKET_FEEDS, type NewsFeed } from "../lib/news/feeds";
import { fetchFeed } from "../lib/news/server";

let failures = 0;

async function probe(feed: NewsFeed): Promise<number> {
  try {
    const result = await fetchFeed(feed);
    const newest = result.items[0];
    console.log(
      `  ${feed.id.padEnd(28)} ${String(result.items.length).padStart(3)} items` +
        (newest ? `  ${newest.source}: ${newest.title.slice(0, 70)}` : ""),
    );
    return result.items.length;
  } catch (err) {
    console.log(
      `  ${feed.id.padEnd(28)} FAIL ${err instanceof Error ? err.message : String(err)}`,
    );
    return -1;
  }
}

console.log("Market feeds");
for (const feed of MARKET_FEEDS) {
  const n = await probe(feed);
  if (n <= 0) failures += 1;
}

console.log("\nFed feeds");
for (const feed of FED_FEEDS) {
  const n = await probe(feed);
  if (n <= 0) failures += 1;
}

console.log("\nPer-asset coverage");
for (const x of XSTOCKS) {
  console.log(`${x.symbol} (${x.name})`);
  const feeds = assetFeeds(x);
  if (feeds.length === 0) {
    console.log("  no coverage entry");
    failures += 1;
    continue;
  }
  let total = 0;
  for (const feed of feeds) {
    const n = await probe(feed);
    if (n > 0) total += n;
  }
  if (total === 0) {
    console.log("  NO HEADLINES from any feed");
    failures += 1;
  }
}

console.log(failures === 0 ? "\nAll feeds answered." : `\n${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
