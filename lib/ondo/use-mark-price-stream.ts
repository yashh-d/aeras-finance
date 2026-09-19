"use client";

// Ondo's mark price as it ticks, for a component. The socket itself is the
// shared, reference-counted feed in mark-socket.ts, so a component and the
// TradingView datafeed watching the same market hold one connection.

import { useEffect, useState } from "react";

import { subscribeMarkPrice } from "./mark-socket";

export function useOndoMarkPriceStream(market: string | null): number | null {
  const [state, setState] = useState<{ market: string; price: number } | null>(null);

  useEffect(() => {
    if (market == null) return;
    return subscribeMarkPrice(market, (price) => setState({ market, price }));
  }, [market]);

  // Keyed on the market so a switch never shows the previous market's tick
  // on the new market's chart while the new socket is still connecting.
  return state && state.market === market ? state.price : null;
}
