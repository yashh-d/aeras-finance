"use client";

// Ondo's mark price over its WebSocket, for the perps chart's live bar.
//
// One socket per selected market. The guide asks for a ping every second,
// which is aggressive enough that this lives in a hook with a real teardown
// rather than a component effect: the interval, the socket and the reconnect
// timer are all cleared together, and a frame that arrives after teardown is
// dropped rather than setting state on an unmounted chart.
//
// Two things about the browser side. The socket connects from the browser
// directly, not through our route handlers, so Ondo's CORS allowlist applies
// here even though it does not to REST; if the origin is not allowlisted the
// handshake fails and the chart simply carries on from the history poll.
// And the stream is an improvement, never a dependency: the chart is correct
// without it, just thirty seconds behind.

import { useEffect, useState } from "react";

import { ONDO_WS_URL } from "./constants";
import {
  parseMarkPriceMessage,
  PING_FRAME,
  PING_INTERVAL_MS,
  subscribeFrame,
} from "./mark-stream";

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function useOndoMarkPriceStream(market: string | null): number | null {
  const [state, setState] = useState<{ market: string; price: number } | null>(null);

  useEffect(() => {
    if (market == null || typeof WebSocket === "undefined") return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = RECONNECT_MIN_MS;

    const stopPing = () => {
      if (ping) clearInterval(ping);
      ping = null;
    };

    const connect = () => {
      if (disposed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(ONDO_WS_URL);
      } catch {
        scheduleReconnect();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        if (disposed) return;
        backoff = RECONNECT_MIN_MS;
        ws.send(subscribeFrame([market]));
        stopPing();
        ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(PING_FRAME);
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        const price = parseMarkPriceMessage(event.data, market);
        if (price != null) setState({ market, price });
      };

      ws.onclose = () => {
        stopPing();
        if (!disposed) scheduleReconnect();
      };

      // onerror is always followed by onclose, which owns the reconnect.
      ws.onerror = () => {};
    };

    const scheduleReconnect = () => {
      if (disposed || retry) return;
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    };

    connect();

    return () => {
      disposed = true;
      stopPing();
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [market]);

  // Keyed on the market so a switch never shows the previous market's tick
  // on the new market's chart while the new socket is still connecting.
  return state && state.market === market ? state.price : null;
}
