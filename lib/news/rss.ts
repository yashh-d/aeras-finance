// A small RSS 2.0 and Atom item reader.
//
// Written rather than installed. The five feeds the Terminal reads are plain
// RSS 2.0 (Yahoo, Google News, CNBC, Dow Jones, Bloomberg), and the fields the
// rail shows are title, link, date and source. A general XML parser would
// handle every feed on the internet; this handles those, is pinned by tests
// against captured excerpts of each, and adds nothing to the bundle. Atom
// entries are read too because the cost is two extra tag names.
//
// It is deliberately forgiving. Feeds wrap titles in CDATA or not, encode
// entities once or twice, and put HTML in descriptions, and the reader's job is
// to get a clean headline out of all of them rather than to validate the
// document. Nothing here is trusted: the output is text that the UI renders as
// text, never as markup.

export interface RawFeedItem {
  title: string;
  link: string;
  guid: string | null;
  // The date as the feed wrote it. Parsed later, so a feed with an odd format
  // still yields an item.
  pubDate: string | null;
  // Google News' per-item <source>. Null on every other feed seen so far.
  source: string | null;
}

const ITEM_RE = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;

export function parseFeedItems(xml: string): RawFeedItem[] {
  const items: RawFeedItem[] = [];
  for (const match of xml.matchAll(ITEM_RE)) {
    const block = match[2];
    const title = text(block, "title");
    const link = linkOf(block);
    // A headline with nowhere to go, or a link with no headline, is not a row.
    if (!title || !link) continue;
    items.push({
      title,
      link,
      guid: text(block, "guid") || text(block, "id") || null,
      pubDate:
        text(block, "pubDate") ||
        text(block, "published") ||
        text(block, "updated") ||
        text(block, "dc:date") ||
        null,
      source: text(block, "source") || null,
    });
  }
  return items;
}

// The inner markup of the first <name> element in the block, or null when the
// block has none. Namespaced names ("dc:date") pass straight through, since a
// colon is not special in a pattern.
function element(block: string, name: string): string | null {
  const re = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`,
    "i",
  );
  const found = re.exec(block);
  return found ? found[1] : null;
}

function text(block: string, name: string): string {
  const raw = element(block, name);
  return raw == null ? "" : cleanText(raw);
}

// RSS writes the URL as the element's text. Atom writes it as an href on a
// self-closing tag, one per relation, and the article is the "alternate" one
// (or the one with no rel, which the spec says means the same).
function linkOf(block: string): string {
  const inner = element(block, "link");
  if (inner) {
    const cleaned = cleanText(inner);
    if (/^https?:\/\//i.test(cleaned)) return cleaned;
  }
  let fallback = "";
  for (const tag of block.match(/<link\s[^>]*\/?>/gi) ?? []) {
    const href =
      /href\s*=\s*"([^"]+)"/i.exec(tag)?.[1] ??
      /href\s*=\s*'([^']+)'/i.exec(tag)?.[1];
    if (!href) continue;
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!rel || rel === "alternate") return decodeEntities(href);
    if (!fallback) fallback = decodeEntities(href);
  }
  return fallback;
}

// Requires a letter after the bracket, so "<$100" in a headline survives.
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

// Element content to plain text: CDATA unwrapped, tags stripped, entities
// decoded, then both again. The second pass is for HTML carried as XML text,
// which Google News' descriptions are: the XML layer encodes the HTML once and
// the HTML encodes its own entities once, so "&amp;nbsp;" is a space and
// "&lt;a&gt;" is a tag. On a plain title the second pass finds nothing to do.
export function cleanText(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (let pass = 0; pass < 2; pass++) {
    s = s.replace(TAG_RE, "");
    s = decodeEntities(s);
  }
  s = s.replace(TAG_RE, "");
  return s.replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// One pass, on purpose: "&amp;lt;" becomes "&lt;" and stops, which is what the
// author of a double-encoded feed meant to show.
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}
