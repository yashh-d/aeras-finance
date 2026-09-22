import { describe, expect, it } from "vitest";

import {
  mergeNews,
  parseFeedDate,
  publisherFromUrl,
  stripSourceSuffix,
  toNewsItem,
} from "./normalize";
import type { NewsItem } from "./types";

function item(
  title: string,
  publishedAt: number | null,
  url = `https://example.com/${title.toLowerCase().replace(/\W+/g, "-")}`,
): NewsItem {
  return { id: url, title, url, source: "Example", publishedAt };
}

describe("toNewsItem", () => {
  it("prefers the item's own source, then the feed's, then the link's host", () => {
    const raw = {
      title: "Headline - Yahoo Finance",
      link: "https://www.fool.com/story",
      guid: null,
      pubDate: null,
      source: null,
    };
    expect(toNewsItem({ ...raw, source: "Yahoo Finance" }, { name: "CNBC" }).source).toBe(
      "Yahoo Finance",
    );
    expect(toNewsItem(raw, { name: "CNBC" }).source).toBe("CNBC");
    expect(toNewsItem(raw, { name: null }).source).toBe("The Motley Fool");
  });

  it("strips the publisher suffix only when it names the source", () => {
    const raw = {
      title: "Headline - Yahoo Finance",
      link: "https://x.test/a",
      guid: "g1",
      pubDate: "Thu, 10 Sep 2026 19:29:06 +0000",
      source: "Yahoo Finance",
    };
    const out = toNewsItem(raw, { name: null });
    expect(out.title).toBe("Headline");
    expect(out.id).toBe("g1");
    expect(out.publishedAt).toBe(Date.UTC(2026, 8, 10, 19, 29, 6));
    expect(toNewsItem({ ...raw, source: "CNBC" }, { name: null }).title).toBe(
      "Headline - Yahoo Finance",
    );
  });

  it("falls back to the link as the id", () => {
    const raw = { title: "T", link: "https://x.test/a", guid: null, pubDate: null, source: null };
    expect(toNewsItem(raw, { name: "X" }).id).toBe("https://x.test/a");
  });
});

describe("stripSourceSuffix", () => {
  it("is case-insensitive and trims", () => {
    expect(stripSourceSuffix("Big news - the motley fool", "The Motley Fool")).toBe("Big news");
  });
  it("leaves an unrelated dash alone", () => {
    expect(stripSourceSuffix("Rates - what next", "Reuters")).toBe("Rates - what next");
  });
});

describe("parseFeedDate", () => {
  it("reads RFC 822 with an offset or GMT, and ISO", () => {
    expect(parseFeedDate("Thu, 10 Sep 2026 19:29:06 +0000")).toBe(
      Date.UTC(2026, 8, 10, 19, 29, 6),
    );
    expect(parseFeedDate("Fri, 11 Sep 2026 02:05:24 GMT")).toBe(
      Date.UTC(2026, 8, 11, 2, 5, 24),
    );
    expect(parseFeedDate("2026-09-10T12:00:00Z")).toBe(Date.UTC(2026, 8, 10, 12));
  });
  it("is null for nothing or nonsense", () => {
    expect(parseFeedDate(null)).toBeNull();
    expect(parseFeedDate("")).toBeNull();
    expect(parseFeedDate("yesterday-ish")).toBeNull();
  });
});

describe("publisherFromUrl", () => {
  it("names the hosts it knows and trims www. off the rest", () => {
    expect(publisherFromUrl("https://finance.yahoo.com/video/x.html?.tsrc=rss")).toBe(
      "Yahoo Finance",
    );
    expect(publisherFromUrl("https://247wallst.com/personal-finance/x")).toBe("24/7 Wall St.");
    expect(publisherFromUrl("https://www.unknown-site.example/a")).toBe("unknown-site.example");
  });
  it("copes with a link that is not a URL", () => {
    expect(publisherFromUrl("not a url")).toBe("Web");
  });
});

describe("mergeNews", () => {
  it("orders newest first with undated items last", () => {
    const out = mergeNews(
      [[item("Old", 1_000), item("Undated", null)], [item("New", 2_000)]],
      10,
    );
    expect(out.map((i) => i.title)).toEqual(["New", "Old", "Undated"]);
  });

  it("drops a story that arrived twice under different URLs, keeping the newer", () => {
    const out = mergeNews(
      [
        [item("Apple beats on iPhone: what it means", 1_000, "https://a.test/1")],
        [item("Apple beats on iPhone, what it means", 2_000, "https://b.test/2")],
      ],
      10,
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://b.test/2");
  });

  it("drops a repeated URL and honours the limit", () => {
    const dup = item("Same link", 5_000, "https://a.test/same");
    const out = mergeNews(
      [[dup, item("A", 4_000), item("B", 3_000)], [{ ...dup, title: "Same link retitled" }]],
      2,
    );
    expect(out.map((i) => i.title)).toEqual(["Same link", "A"]);
  });
});
