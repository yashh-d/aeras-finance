// Ranges for the Ondo perps chart, and the request each one makes.
//
// Ondo's history endpoint takes a resolution and a countback rather than a
// window, so a range here is a pair rather than a span. Three things about the
// upstream shaped this table, all measured live 2026-09-10 and none of them
// documented.
//
// **Resolution "30" does not exist.** Ondo answers it with HTTP 400 while every
// other resolution in its own advertised set works. It is absent below and from
// the route's allow-list for that reason, not by preference.
//
// **A short series is front-padded with all-zero bars.** Ask for 500 daily bars
// on a market with 68 days of history and 432 bars come back with open, high,
// low, close and volume all zero, contiguous at the front. They are not gaps in
// trading, they are filler. Feeding them to a candlestick chart anchors the
// price axis at zero and flattens the real action into a line, which is why the
// route trims them off rather than each consumer remembering to.
//
// **The history itself is short.** BTC holds 68 days and SPY 32, against 601
// days for BTC on Lighter. So this set stops at MAX rather than mirroring the
// perps tab's Lighter ranges: a 3M button would draw the same two months as MAX
// on every market, and 6M, YTD and 1Y would too.

export type OndoCandleRange = "1H" | "1D" | "1W" | "1M" | "MAX";

export const ONDO_CANDLE_RANGES: readonly OndoCandleRange[] = [
  "1H",
  "1D",
  "1W",
  "1M",
  "MAX",
];

export interface OndoCandleRequest {
  // What the endpoint is sent. Ondo's own vocabulary: minutes as a bare number,
  // days as "1D".
  resolution: string;
  countback: number;
  // How that reads in the footer, in the same vocabulary the Lighter chart uses
  // so the two venues' footers say the same kind of thing.
  label: string;
}

// Each range asks for exactly the bars it needs, except MAX, which asks for the
// route's ceiling and takes whatever real history comes back after trimming.
const REQUESTS: Record<OndoCandleRange, OndoCandleRequest> = {
  "1H": { resolution: "1", countback: 60, label: "1m" },
  "1D": { resolution: "5", countback: 288, label: "5m" },
  "1W": { resolution: "60", countback: 168, label: "1h" },
  "1M": { resolution: "240", countback: 180, label: "4h" },
  MAX: { resolution: "1D", countback: 500, label: "1d" },
};

export function ondoCandleRequest(range: OndoCandleRange): OndoCandleRequest {
  return REQUESTS[range];
}
