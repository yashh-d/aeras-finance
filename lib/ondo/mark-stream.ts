// The Ondo mark price stream, message shapes only.
//
// Ondo's integration guide (step 7) offers a WebSocket at ONDO_WS_URL with a
// `markPricesPerps` channel: send a subscribe frame naming the markets and
// ping every second. This file holds the frames we send and the reading of
// what comes back; the socket itself and its lifecycle are in
// use-mark-price-stream.ts.
//
// The reader is deliberately tolerant of shape. It was written against the
// guide's description of the channel rather than a captured frame, so rather
// than assert one layout it walks the message for an entry naming the market
// (by `market` or `symbol`, or as a key) and takes the first mark-price
// field on it. A frame it cannot read yields null and the chart keeps the
// price it had; nothing is ever drawn from a guess. When a live frame has
// been captured, pin the shape here and in the test.

export const MARK_PRICE_CHANNEL = "markPricesPerps";

export function subscribeFrame(markets: readonly string[]): string {
  return JSON.stringify({ op: "subscribe", channel: MARK_PRICE_CHANNEL, markets });
}

export function unsubscribeFrame(markets: readonly string[]): string {
  return JSON.stringify({ op: "unsubscribe", channel: MARK_PRICE_CHANNEL, markets });
}

export const PING_FRAME = JSON.stringify({ op: "ping" });

// Ondo's guide asks for a ping every second.
export const PING_INTERVAL_MS = 1_000;

const PRICE_KEYS = ["markPrice", "mark_price", "markPx", "price", "p"] as const;
const NAME_KEYS = ["market", "symbol", "s"] as const;
const MAX_DEPTH = 6;

export function parseMarkPriceMessage(raw: unknown, market: string): number | null {
  let body: unknown = raw;
  if (typeof raw === "string") {
    try {
      body = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return find(body, market, 0);
}

function find(node: unknown, market: string, depth: number): number | null {
  if (depth > MAX_DEPTH || node == null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = find(item, market, depth + 1);
      if (hit != null) return hit;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;

  // { market: "SPY-USD.P", markPrice: "..." }
  if (NAME_KEYS.some((k) => obj[k] === market)) {
    const price = priceOf(obj);
    if (price != null) return price;
  }

  // { "SPY-USD.P": "..." } or { "SPY-USD.P": { markPrice: "..." } }
  if (market in obj) {
    const value = obj[market];
    const direct = asNumber(value);
    if (direct != null) return direct;
    if (value != null && typeof value === "object") {
      const price = priceOf(value as Record<string, unknown>);
      if (price != null) return price;
    }
  }

  for (const value of Object.values(obj)) {
    const hit = find(value, market, depth + 1);
    if (hit != null) return hit;
  }
  return null;
}

function priceOf(obj: Record<string, unknown>): number | null {
  for (const key of PRICE_KEYS) {
    const price = asNumber(obj[key]);
    if (price != null) return price;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}
