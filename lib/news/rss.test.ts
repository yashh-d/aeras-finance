import { describe, expect, it } from "vitest";

import { cleanText, decodeEntities, parseFeedItems } from "./rss";

// Excerpts of the feeds the Terminal reads, captured 2026-09-10. Each one
// differs in a way the reader has to cope with, which is why all four are here.

// Yahoo: no CDATA, elements in an unusual order (description first, title last),
// no source.
const YAHOO = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Yahoo! Finance: AAPL News</title>
<item>
  <description>Yahoo Finance Technology Editor Dan Howley joins Market Domination.</description>
  <guid isPermaLink="false">9451ea7f-7928-44ed-a220-eae3eaa12747</guid>
  <link>https://finance.yahoo.com/video/why-hardware-attract-buyers-192906871.html?.tsrc=rss</link>
  <pubDate>Thu, 10 Sep 2026 19:29:06 +0000</pubDate>
  <title>Why hardware will attract buyers to Apple's new lineup over AI features</title>
</item>
<item>
  <description>No title on this one.</description>
  <link>https://example.com/untitled</link>
</item>
</channel></rss>`;

// Google News: a per-item <source> with an attribute, the publisher appended to
// the title, and a description that is entity-encoded HTML.
const GOOGLE = `<rss version="2.0"><channel>
<item><title>How Apple stock usually reacts to big iPhone reveal events - Yahoo Finance</title><link>https://news.google.com/rss/articles/CBMiugFBVV95?oc=5</link><guid isPermaLink="false">CBMiugFBVV95</guid><pubDate>Wed, 09 Sep 2026 09:08:43 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/CBMiugFBVV95?oc=5" target="_blank"&gt;How Apple stock usually reacts&lt;/a&gt;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Yahoo Finance&lt;/font&gt;</description><source url="https://finance.yahoo.com">Yahoo Finance</source></item>
</channel></rss>`;

// CNBC: CDATA description, namespaced metadata elements, a curly apostrophe
// and an em dash in the title.
const CNBC = `<rss version="2.0" xmlns:metadata="https://www.cnbc.com/"><channel>
<item>
  <link>https://www.cnbc.com/2026/09/11/the-iphone-duo-enters-chinas-crowded-foldable-market.html</link>
  <guid isPermaLink="false">108360994</guid>
  <metadata:type>cnbcnewsstory</metadata:type>
  <title>The iPhone Duo enters China’s crowded foldable market — and faces a price test</title>
  <description><![CDATA[Chinese netizens focused on <b>price</b>.]]></description>
  <pubDate>Fri, 11 Sep 2026 02:05:24 GMT</pubDate>
</item>
</channel></rss>`;

// Nasdaq: an &amp; in the title, dc:creator and a nasdaq:tickers list.
const NASDAQ = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:nasdaq="https://www.nasdaq.com/"><channel>
<item>
  <title>Stocks Settle Lower as S&amp;P 500 Slides</title>
  <link>https://www.nasdaq.com/articles/stocks-settle-lower</link>
  <description>The S&amp;P 500 Index ($SPX ) closed down.</description>
  <pubDate>Fri, 11 Sep 2026 01:54:04 +0000</pubDate>
  <guid isPermaLink="true">https://www.nasdaq.com/articles/stocks-settle-lower?time=1789091644</guid>
  <dc:creator>Barchart</dc:creator>
  <nasdaq:tickers>AMAT,AAPL</nasdaq:tickers>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title type="html">An Atom &lt;b&gt;entry&lt;/b&gt;</title>
  <link rel="self" href="https://example.com/feed"/>
  <link rel="alternate" href="https://example.com/post?a=1&amp;b=2"/>
  <id>tag:example.com,2026:1</id>
  <updated>2026-09-10T12:00:00Z</updated>
</entry>
</feed>`;

describe("parseFeedItems", () => {
  it("reads Yahoo's item regardless of element order and skips one with no title", () => {
    const items = parseFeedItems(YAHOO);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      title:
        "Why hardware will attract buyers to Apple's new lineup over AI features",
      link: "https://finance.yahoo.com/video/why-hardware-attract-buyers-192906871.html?.tsrc=rss",
      guid: "9451ea7f-7928-44ed-a220-eae3eaa12747",
      pubDate: "Thu, 10 Sep 2026 19:29:06 +0000",
      source: null,
    });
  });

  it("reads Google News' per-item source", () => {
    const [item] = parseFeedItems(GOOGLE);
    expect(item.source).toBe("Yahoo Finance");
    expect(item.title).toBe(
      "How Apple stock usually reacts to big iPhone reveal events - Yahoo Finance",
    );
    expect(item.link).toBe("https://news.google.com/rss/articles/CBMiugFBVV95?oc=5");
    expect(item.pubDate).toBe("Wed, 09 Sep 2026 09:08:43 GMT");
  });

  it("keeps CNBC's punctuation and ignores its namespaced metadata", () => {
    const [item] = parseFeedItems(CNBC);
    expect(item.title).toBe(
      "The iPhone Duo enters China’s crowded foldable market — and faces a price test",
    );
    expect(item.guid).toBe("108360994");
  });

  it("decodes the ampersand in Nasdaq's title", () => {
    const [item] = parseFeedItems(NASDAQ);
    expect(item.title).toBe("Stocks Settle Lower as S&P 500 Slides");
    expect(item.guid).toBe(
      "https://www.nasdaq.com/articles/stocks-settle-lower?time=1789091644",
    );
  });

  it("reads an Atom entry's alternate link, id and updated time", () => {
    const [item] = parseFeedItems(ATOM);
    expect(item).toEqual({
      title: "An Atom entry",
      link: "https://example.com/post?a=1&b=2",
      guid: "tag:example.com,2026:1",
      pubDate: "2026-09-10T12:00:00Z",
      source: null,
    });
  });

  it("returns nothing for a document with no items", () => {
    expect(parseFeedItems("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseFeedItems("")).toEqual([]);
  });
});

describe("cleanText", () => {
  it("unwraps CDATA and strips the markup inside it", () => {
    expect(cleanText("<![CDATA[Chinese netizens focused on <b>price</b>.]]>")).toBe(
      "Chinese netizens focused on price.",
    );
  });

  it("strips markup that arrived entity-encoded", () => {
    expect(cleanText("&lt;a href=\"x\"&gt;Headline&lt;/a&gt;&amp;nbsp;&lt;font&gt;Pub&lt;/font&gt;")).toBe(
      "Headline Pub",
    );
  });

  it("leaves a bare less-than in a headline alone", () => {
    expect(cleanText("Stocks under <$100 to watch")).toBe("Stocks under <$100 to watch");
  });

  it("collapses whitespace", () => {
    expect(cleanText("  a\n\n  b\t c ")).toBe("a b c");
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("S&amp;P &#39;26 &#x2014; &quot;q&quot;")).toBe(
      "S&P '26 — \"q\"",
    );
  });

  it("decodes one level only and leaves unknown entities as written", () => {
    expect(decodeEntities("&amp;lt; &bogus; &#xZZ;")).toBe("&lt; &bogus; &#xZZ;");
  });
});
