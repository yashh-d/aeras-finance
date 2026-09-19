// Price history for the market a hedge actually fills on.
//
// The hedge tab charts Lighter's own candles rather than the xStock's Coingecko
// series, and the difference is not cosmetic. A short is opened, marked and
// liquidated against the perp, so the perp is the line whose shape decides
// whether the hedge worked. It also keeps the proxy routes honest: GLDx hedges
// through XAU at roughly eleven times the ETF price, and charting the ETF would
// draw a curve the position does not track.
//
// Two things about the upstream endpoint are worth knowing before touching this.
//
// The path is `/candles`. Lighter's docs name `/candlesticks`, which does not
// exist and answers 403 from CloudFront the same way any unrouted path does, so
// a wrong path here looks like a geo-block rather than a typo.
//
// The server caps a response at 501 bars and **ignores `count_back` entirely**.
// Asking for a window wider than 501 bars silently returns only the most recent
// 501, so the range table below picks a resolution per range that keeps every
// window under the cap. Getting this wrong does not error, it just quietly
// truncates the left edge of the chart.

// Resolutions the endpoint accepts, per its spec enum. Probed live: 2h, 1w
// and 1M are rejected with code 20001, as are TradingView-style aliases like
// "60" and "D".
export type CandleResolution =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "12h"
  | "1d";

// Which of Lighter's two candle endpoints a series comes from. `/candles` is
// trades: what printed on the book, with volume. `/markPriceCandles` is the
// mark price: what a position is valued and liquidated at, sampled rather
// than traded, so it has a sample count and no volume. Lighter's own chart
// offers both, and a trader watching a liquidation level wants the second.
export type CandleSource = "trades" | "mark";

export const CANDLE_SOURCES: readonly CandleSource[] = ["trades", "mark"];

export function isCandleSource(value: string | null): value is CandleSource {
  return value != null && (CANDLE_SOURCES as readonly string[]).includes(value);
}

export type CandleRange = "1H" | "1D" | "1W" | "1M" | "3M";

export const CANDLE_RANGES: readonly CandleRange[] = [
  "1H",
  "1D",
  "1W",
  "1M",
  "3M",
];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

interface RangeSpec {
  resolution: CandleResolution;
  spanMs: number;
}

// Each range pairs a window with the finest resolution that still fits under the
// 501-bar cap. Bar counts: 60, 288, 168, 180, 90.
const RANGE_SPECS: Record<CandleRange, RangeSpec> = {
  "1H": { resolution: "1m", spanMs: HOUR_MS },
  "1D": { resolution: "5m", spanMs: DAY_MS },
  "1W": { resolution: "1h", spanMs: 7 * DAY_MS },
  "1M": { resolution: "4h", spanMs: 30 * DAY_MS },
  "3M": { resolution: "1d", spanMs: 90 * DAY_MS },
};

const RESOLUTION_MS: Record<CandleResolution, number> = {
  "1m": MINUTE_MS,
  "5m": 5 * MINUTE_MS,
  "15m": 15 * MINUTE_MS,
  "30m": 30 * MINUTE_MS,
  "1h": HOUR_MS,
  "4h": 4 * HOUR_MS,
  "12h": 12 * HOUR_MS,
  "1d": DAY_MS,
};

export interface CandleWindow {
  resolution: CandleResolution;
  startMs: number;
  endMs: number;
  // What the window asks for. The server may return fewer when the market is
  // younger than the range, but never more than LIGHTER_MAX_CANDLES.
  bars: number;
}

// Pure so the bar-count arithmetic can be asserted against the cap without a
// network call.
export function candleWindow(range: CandleRange, nowMs: number): CandleWindow {
  const spec = RANGE_SPECS[range];
  const startMs = nowMs - spec.spanMs;
  return {
    resolution: spec.resolution,
    startMs,
    endMs: nowMs,
    bars: Math.round(spec.spanMs / RESOLUTION_MS[spec.resolution]),
  };
}

export function isCandleRange(value: string | null): value is CandleRange {
  return value != null && (CANDLE_RANGES as readonly string[]).includes(value);
}

// A market id from a query string, or null if it is not one.
//
// Strict digit matching rather than Number(), which maps both null and the
// empty string to 0. Market 0 is a real market, so a request that omitted the
// parameter entirely would otherwise be served a chart of someone else's asset
// instead of being rejected.
export function parseMarketId(raw: string | null): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

// One bar. `t` is unix **milliseconds**, unlike the Jupiter chart's OhlcCandle,
// which is seconds. Mixing them draws a chart in 1970.
export interface LighterCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  // Base volume, in contracts. `quoteVolume` is the USD figure.
  v: number;
  quoteVolume: number;
  // False when no trade printed in the bar. Lighter still emits a flat bar so
  // the series has no gaps, which is why volume rather than price tells them
  // apart. Equity perps run 24/7, so overnight bars are flat rather than absent.
  traded: boolean;
}

// The spec says "zero values are omitted from the response", so every
// numeric field is optional on the wire and an untraded bar arrives with no
// `v` at all. Reading it as undefined would hand the chart a bar with no
// volume value, which Lightweight Charts rejects; it is a zero.
interface RawCandle {
  t: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
  V?: number;
}

interface RawMarkPriceCandle {
  t: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  // sample_count
  sc?: number;
}

interface RawCandlesResponse<C> {
  code: number;
  message?: string;
  r?: string;
  c?: C[];
}

function unwrap<C>(body: unknown, what: string): C[] {
  const res = body as RawCandlesResponse<C>;
  if (res?.code !== 200) {
    throw new Error(res?.message?.trim() || `Lighter ${what} code ${res?.code}`);
  }
  return res.c ?? [];
}

const zero = (value: number | undefined): number => value ?? 0;

export function parseCandles(body: unknown): LighterCandle[] {
  return unwrap<RawCandle>(body, "candles").map((raw) => {
    const v = zero(raw.v);
    return {
      t: raw.t,
      o: zero(raw.o),
      h: zero(raw.h),
      l: zero(raw.l),
      c: zero(raw.c),
      v,
      quoteVolume: zero(raw.V),
      traded: v > 0,
    };
  });
}

// Mark price candles in the same shape, so everything downstream of the
// fetch is shared. There is no volume to carry; `traded` records whether the
// bar had any samples, which is the nearest thing to "this bar is real".
export function parseMarkPriceCandles(body: unknown): LighterCandle[] {
  return unwrap<RawMarkPriceCandle>(body, "markPriceCandles").map((raw) => ({
    t: raw.t,
    o: zero(raw.o),
    h: zero(raw.h),
    l: zero(raw.l),
    c: zero(raw.c),
    v: 0,
    quoteVolume: 0,
    traded: zero(raw.sc) > 0,
  }));
}

// GET /marketPriceCharts: the last 24 hourly mark prices for every perp in
// one call, as strings. Exactly what a row sparkline needs, and one request
// for the whole catalog where /candles is one per market.
interface RawMarketPriceCharts {
  code: number;
  message?: string;
  resolution?: string;
  price_charts?: { market_id: number; prices?: string[] }[];
}

export function parseMarketPriceCharts(body: unknown): Record<number, number[]> {
  const res = body as RawMarketPriceCharts;
  if (res?.code !== 200) {
    throw new Error(res?.message?.trim() || `Lighter marketPriceCharts code ${res?.code}`);
  }
  const out: Record<number, number[]> = {};
  for (const chart of res.price_charts ?? []) {
    const prices = (chart.prices ?? [])
      .map(Number)
      .filter((p) => Number.isFinite(p) && p > 0);
    if (prices.length > 0) out[chart.market_id] = prices;
  }
  return out;
}

export interface CandleSeries {
  marketId: number;
  symbol: string;
  range: CandleRange;
  resolution: CandleResolution;
  source: CandleSource;
  candles: LighterCandle[];
}

// Percentage move across the series, close to close. Null rather than zero when
// there is nothing to measure, so the UI can omit the figure instead of
// asserting a flat market.
export function seriesChangePercent(candles: LighterCandle[]): number | null {
  if (candles.length < 2) return null;
  const first = candles[0].o;
  const last = candles[candles.length - 1].c;
  if (!first) return null;
  return ((last - first) / first) * 100;
}

export async function fetchCandlesViaProxy(
  marketId: number,
  range: CandleRange,
  source: CandleSource = "trades",
): Promise<CandleSeries> {
  const response = await fetch(
    `/api/lighter/candles?market=${marketId}&range=${range}&source=${source}`,
    { cache: "no-store" },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? `Candles failed: ${response.status}`);
  }
  return body as CandleSeries;
}

// Hourly mark prices over the last day, one short series per market, for the
// row sparklines.
export type SparklineMap = Record<string, number[]>;

export async function fetchSparklinesViaProxy(
  marketIds: number[],
): Promise<SparklineMap> {
  if (marketIds.length === 0) return {};
  const response = await fetch(
    `/api/lighter/sparklines?markets=${marketIds.join(",")}`,
    { cache: "no-store" },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error ?? `Sparklines failed: ${response.status}`);
  }
  return body as SparklineMap;
}
