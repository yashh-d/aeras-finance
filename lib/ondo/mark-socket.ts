"use client";

// One shared WebSocket per Ondo market, for anything that wants the mark
// price as it ticks: the TradingView datafeed's live bar, the chart header.
//
// Reference counted. The first subscriber opens the socket, sends the
// subscribe frame and starts the one-second ping Ondo's guide asks for; the
// last one to leave closes it. A subscriber that arrives while the socket is
// already open shares it, so a chart and a header never hold two sockets to
// the same market. Reconnects with backoff, and a frame that cannot be read
// is dropped rather than guessed at (see mark-stream.ts).
//
// The socket connects from the browser directly, not through our route
// handlers, so Ondo's CORS allowlist applies to it even though it does not
// to REST. If the handshake is refused, subscribers simply never hear a
// price, and everything built on this stays correct from history alone.

import { ONDO_WS_URL } from "./constants";
import {
  parseMarkPriceMessage,
  PING_FRAME,
  PING_INTERVAL_MS,
  subscribeFrame,
} from "./mark-stream";

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

type Listener = (price: number) => void;

interface Feed {
  listeners: Set<Listener>;
  socket: WebSocket | null;
  ping: ReturnType<typeof setInterval> | null;
  retry: ReturnType<typeof setTimeout> | null;
  backoff: number;
  closed: boolean;
}

const feeds = new Map<string, Feed>();

export function subscribeMarkPrice(market: string, listener: Listener): () => void {
  if (typeof WebSocket === "undefined") return () => {};

  let feed = feeds.get(market);
  if (!feed) {
    feed = {
      listeners: new Set(),
      socket: null,
      ping: null,
      retry: null,
      backoff: RECONNECT_MIN_MS,
      closed: false,
    };
    feeds.set(market, feed);
    connect(market, feed);
  }
  feed.listeners.add(listener);

  return () => {
    const f = feeds.get(market);
    if (!f) return;
    f.listeners.delete(listener);
    if (f.listeners.size === 0) {
      f.closed = true;
      stopPing(f);
      if (f.retry) clearTimeout(f.retry);
      if (f.socket) {
        f.socket.onclose = null;
        f.socket.close();
      }
      feeds.delete(market);
    }
  };
}

function stopPing(feed: Feed) {
  if (feed.ping) clearInterval(feed.ping);
  feed.ping = null;
}

function connect(market: string, feed: Feed) {
  if (feed.closed) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(ONDO_WS_URL);
  } catch {
    scheduleReconnect(market, feed);
    return;
  }
  feed.socket = ws;

  ws.onopen = () => {
    if (feed.closed) return;
    feed.backoff = RECONNECT_MIN_MS;
    ws.send(subscribeFrame([market]));
    stopPing(feed);
    feed.ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(PING_FRAME);
    }, PING_INTERVAL_MS);
  };

  ws.onmessage = (event) => {
    if (feed.closed) return;
    const price = parseMarkPriceMessage(event.data, market);
    if (price == null) return;
    for (const listener of feed.listeners) listener(price);
  };

  ws.onclose = () => {
    stopPing(feed);
    if (!feed.closed) scheduleReconnect(market, feed);
  };

  // onerror is always followed by onclose, which owns the reconnect.
  ws.onerror = () => {};
}

function scheduleReconnect(market: string, feed: Feed) {
  if (feed.closed || feed.retry) return;
  feed.retry = setTimeout(() => {
    feed.retry = null;
    connect(market, feed);
  }, feed.backoff);
  feed.backoff = Math.min(feed.backoff * 2, RECONNECT_MAX_MS);
}
