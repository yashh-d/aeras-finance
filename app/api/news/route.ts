import { NextResponse } from "next/server";

import { assetFeeds, FED_FEEDS, MARKET_FEEDS } from "@/lib/news/feeds";
import { loadNews } from "@/lib/news/server";
import { xstockByMint } from "@/lib/jupiter/xstocks";

export const dynamic = "force-dynamic";

// Headlines for the Terminal. With no query, the market-wide feeds; with
// ?scope=fed, the Federal Reserve's own releases; with ?asset=<mint>, the
// coverage for one catalog asset. The mint has to be in the catalog: this
// route resolves it to a fixed pair of feeds, so nothing a caller sends
// reaches a publisher as a URL.
//
// Fetching and caching live in lib/news/server.ts, per feed; this is just the
// resolution and the HTTP shape.

const LIMIT = 40;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get("asset");
  const scope = searchParams.get("scope");

  let feeds;
  if (scope === "fed") {
    feeds = FED_FEEDS;
  } else if (asset) {
    const xstock = xstockByMint(asset);
    if (!xstock) {
      return NextResponse.json(
        { error: "asset must be a catalog mint" },
        { status: 400 },
      );
    }
    feeds = assetFeeds(xstock);
  } else {
    feeds = MARKET_FEEDS;
  }

  try {
    const body = await loadNews(feeds, LIMIT);
    return NextResponse.json(body, {
      headers: { "cache-control": "public, max-age=60, s-maxage=60" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
