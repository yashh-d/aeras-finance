// Chart and sparkline data come from Coingecko. xStocks are all listed there
// (platforms.solana -> mint), so we hit their per-coin /market_chart endpoint
// for the main chart and the bulk /coins/markets endpoint (with sparkline=true)
// for the asset grid. Coingecko gives gap-free price snapshots even for thinly
// traded xStocks, where DEX-pool-based feeds (GeckoTerminal) often return empty.
//
// Rate limits (free tier, keyless): ~30 req/min, and in practice a good deal
// less. Measured 2026-09-14 with no key configured, six market_chart calls in
// sequence for one asset were enough: days=1,7,30,90,180 answered 200 and
// days=365 answered 429. That is a user clicking through the timeframe picker
// once, which is what made switching ranges feel broken.
//
// Three things in here exist because of that measurement, and all three are
// worth less than simply setting COINGECKO_API_KEY (see below):
//
//   1. **One circuit for the whole provider**, not one per endpoint. A rate
//      limit is charged against the account, so a 429 on market_chart means
//      the sparkline and native-price calls are about to 429 too. Treating
//      them as independent just spends the recovery window three ways.
//   2. **TTL follows the data's own granularity.** Coingecko returns
//      5-minutely points for days=1, hourly for 2 to 90, and daily past that.
//      Re-fetching a daily series every 60 seconds spends the budget to
//      receive the same bytes, so the long ranges cache far longer.
//   3. **Below Pro, 1Y, 5Y and MAX collapse onto one fetch.** They already
//      return identical data on those plans (see CG_MAX_DAYS_BELOW_PRO below);
//      before this they cost five upstream calls between them, because 5Y and
//      MAX each spent a 401 discovering the cap before retrying at 365.
//
// A Demo key fixes the rate limit and nothing else. It raises the budget to
// ~30/min, which is what makes the timeframe picker usable, and leaves the
// 365-day history cap exactly where it is. Only COINGECKO_API_KEY_TYPE=pro
// moves that, which is why rule 3 tests the plan and not the key.

import {
  circuitCooldownMs,
  dedupe,
  openCircuit,
  retryAfterMs,
  UpstreamError,
} from "@/lib/upstream";
import { coingeckoIdForChartKey } from "./chart-assets";
import { XSTOCKS } from "./xstocks";

// Every Coingecko call shares this, because the rate limit is per account.
const CG_CIRCUIT = "coingecko";

// Whether this deployment can ask for more than a year of history. Keyed to
// the PLAN, not to whether a key is set: a Demo key raises the rate limit and
// leaves the 365-day cap exactly where it was (verified 2026-09-15, see
// CG_MAX_DAYS_BELOW_PRO).
function hasProHistory(): boolean {
  return (
    Boolean(process.env.COINGECKO_API_KEY) &&
    process.env.COINGECKO_API_KEY_TYPE === "pro"
  );
}

// Milliseconds until Coingecko calls are worth making again, for a route that
// wants to put a Retry-After on its response.
export function coingeckoCooldownMs(): number {
  return circuitCooldownMs(CG_CIRCUIT);
}

// Throws if we are inside a cooldown, so a caller fails fast to its own cache
// instead of spending another request on a window that has not reset.
function assertCircuitClosed(what: string): void {
  const wait = circuitCooldownMs(CG_CIRCUIT);
  if (wait > 0) {
    throw new UpstreamError(
      `Coingecko ${what}: rate limited, retrying in ${Math.ceil(wait / 1000)}s`,
      true,
      429,
    );
  }
}

// Records the cooldown from Coingecko's own headers where it sends them.
async function noteRateLimit(res: Response): Promise<never> {
  const wait = await retryAfterMs(res, 60_000);
  openCircuit(CG_CIRCUIT, wait, "rate limited");
  throw new UpstreamError(
    `Coingecko rate limit hit. Set COINGECKO_API_KEY in .env.local, or wait ${Math.ceil(wait / 1000)}s.`,
    false,
    429,
  );
}

// If you hit Coingecko rate limits on free/keyless calls, sign up for a free
// Demo key (https://www.coingecko.com/en/api/pricing) and set COINGECKO_API_KEY
// in .env.local. Demo plan = 30 req/min, sent via x-cg-demo-api-key header.
// Pro keys are auto-detected and sent via x-cg-pro-api-key.
const CG_PUBLIC_BASE = "https://api.coingecko.com/api/v3";
const CG_PRO_BASE = "https://pro-api.coingecko.com/api/v3";

// Exported so every Coingecko caller goes through the same key handling. The
// native price route used to build its own public URL by hand, which meant a
// configured COINGECKO_API_KEY raised the limit for sparklines and charts and
// silently did nothing for ETH, BNB and MON.
export function cgFetch(
  path: string,
  params: Record<string, string>,
): Promise<Response> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const apiKeyType = process.env.COINGECKO_API_KEY_TYPE ?? "demo";
  const base = apiKey && apiKeyType === "pro" ? CG_PRO_BASE : CG_PUBLIC_BASE;
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers[apiKeyType === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = apiKey;
  }
  return fetch(url.toString(), { cache: "no-store", headers });
}

export type ChartRange =
  | "1D"
  | "1W"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1Y"
  | "5Y"
  | "MAX";

export const CHART_RANGES: readonly ChartRange[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "5Y",
  "MAX",
];

export function isChartRange(value: string | null): value is ChartRange {
  return value != null && (CHART_RANGES as readonly string[]).includes(value);
}

// Coingecko serves at most a year of history below the Pro plan. Asking past
// it answers 401 with this code rather than a shorter series, so fetchChart
// retries at the limit and the chart says where its data starts.
//
// **The cap follows the plan, not the presence of a key**, and getting that
// backwards is easy because the rate limit does follow the key. Measured live
// on AAPLx 2026-09-15 with a Demo key configured: days=365 returned 366 points,
// and days=1825 and days=max both still answered 401/10012, exactly as they do
// keyless. A Demo key raises the rate limit to ~30/min and changes the history
// cap not at all.
//
// The consequence is worth stating plainly, because it is invisible from the
// outside: on any non-Pro plan, 1Y, 5Y and MAX are the SAME 364-day series.
// Every range up to and including 1Y is genuinely distinct; anything past it is
// 1Y wearing a different label until a PRO key is configured, which means
// COINGECKO_API_KEY together with COINGECKO_API_KEY_TYPE=pro.
const CG_TIME_RANGE_EXCEEDED = 10012;
const CG_MAX_DAYS_BELOW_PRO = 365;

// We keep the OhlcCandle name and shape for the existing chart UI. /market_chart
// only returns close prices, so o=h=l=c. (Recharts is rendering a line, so the
// other fields are unused.)
export type OhlcCandle = {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

interface CGMarketChart {
  prices: [number, number][]; // [ms, price]
  market_caps: [number, number][];
  total_volumes: [number, number][];
}

// Module-scoped caches. Survive across requests in the same server instance.
const chartCache = new Map<
  string,
  { data: OhlcCandle[]; expiresAt: number }
>();
const sparklineCache: {
  data: Record<string, number[]>;
  expiresAt: number;
} = { data: {}, expiresAt: 0 };

const SPARKLINE_TTL_MS = 60 * 1000;

// How long a range's series is worth holding, keyed to how often Coingecko can
// possibly produce a new point for it. days=1 is 5-minutely, 2 to 90 is
// hourly, past 90 is daily. A 5Y chart re-fetched every minute spends 60
// requests an hour to receive a series that gains one point a day.
function chartTtlMs(range: ChartRange): number {
  switch (range) {
    case "1D":
      return 60 * 1000;
    case "1W":
    case "1M":
    case "3M":
      return 5 * 60 * 1000;
    default:
      return 30 * 60 * 1000;
  }
}

// Below Pro, Coingecko serves at most a year, so 1Y, 5Y and MAX are the same
// series (see CG_MAX_DAYS_BELOW_PRO). Collapsing them onto one cache entry
// means the picker's three longest buttons cost one upstream call between them
// rather than five: without this, 5Y and MAX each spend a 401 discovering the
// cap before retrying at 365, for bytes 1Y already has.
//
// This tests the plan rather than the key on purpose. Keying it off "is a key
// set" would quietly stop collapsing the moment a Demo key was added, which
// raises the rate limit but not the cap, and would have spent four requests an
// hour per asset on data already in the cache.
function effectiveRange(range: ChartRange): ChartRange {
  if (hasProHistory()) return range;
  return range === "5Y" || range === "MAX" ? "1Y" : range;
}

// The `days` parameter for a range. A string because "max" is one of the
// values Coingecko accepts.
function rangeToDays(range: ChartRange, now = new Date()): string {
  switch (range) {
    case "1D":
      return "1";
    case "1W":
      return "7";
    case "1M":
      return "30";
    case "3M":
      return "90";
    case "6M":
      return "180";
    case "YTD": {
      const jan1 = Date.UTC(now.getUTCFullYear(), 0, 1);
      const days = Math.ceil((now.getTime() - jan1) / 86_400_000);
      return String(Math.max(1, days));
    }
    case "1Y":
      return "365";
    case "5Y":
      return "1825";
    case "MAX":
      return "max";
  }
}

function exceedsHistoryCap(days: string): boolean {
  return days === "max" || Number(days) > CG_MAX_DAYS_BELOW_PRO;
}

// `key` is a curated xStock mint or a chart-only key from chart-assets.ts.
// Nothing else resolves, so this cannot be pointed at an arbitrary coin.
export async function fetchChart(
  key: string,
  range: ChartRange,
): Promise<OhlcCandle[]> {
  const coingeckoId = coingeckoIdForChartKey(key);
  if (!coingeckoId) {
    throw new Error(`No curated chart asset for key ${key}`);
  }

  // 5Y and MAX resolve to 1Y on the keyless tier, so they share its entry.
  const wanted = effectiveRange(range);
  const cacheKey = `${coingeckoId}:${wanted}`;
  const cached = chartCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // Two panels asking for the same series at once make one call, not two.
  return dedupe(cacheKey, () => loadChart(coingeckoId, wanted, cacheKey, cached));
}

async function loadChart(
  coingeckoId: string,
  range: ChartRange,
  cacheKey: string,
  cached: { data: OhlcCandle[]; expiresAt: number } | undefined,
): Promise<OhlcCandle[]> {
  try {
    assertCircuitClosed(`chart ${coingeckoId}`);
    const days = rangeToDays(range);
    let res = await cgFetch(`/coins/${coingeckoId}/market_chart`, {
      vs_currency: "usd",
      days,
    });
    // Keyless tier refusing a window past a year. Serve the year it allows:
    // the series then starts later than asked and the chart labels that,
    // which is better than an error panel behind a range that a demo key
    // would fill in.
    if (res.status === 401 && exceedsHistoryCap(days)) {
      const body = (await res.json().catch(() => null)) as {
        error?: { status?: { error_code?: number } };
      } | null;
      if (body?.error?.status?.error_code === CG_TIME_RANGE_EXCEEDED) {
        res = await cgFetch(`/coins/${coingeckoId}/market_chart`, {
          vs_currency: "usd",
          days: String(CG_MAX_DAYS_BELOW_PRO),
        });
      }
    }
    if (res.status === 429) await noteRateLimit(res);
    if (!res.ok) {
      throw new Error(
        `Coingecko /market_chart ${coingeckoId} ${range}: ${res.status}`,
      );
    }
    const json = (await res.json()) as CGMarketChart;
    const prices = json.prices ?? [];
    if (prices.length === 0) {
      throw new Error(`Coingecko returned no prices for ${coingeckoId} ${range}`);
    }

    const candles: OhlcCandle[] = prices.map(([ms, price]) => ({
      t: Math.floor(ms / 1000),
      o: price,
      h: price,
      l: price,
      c: price,
      v: 0,
    }));

    chartCache.set(cacheKey, {
      data: candles,
      expiresAt: Date.now() + chartTtlMs(range),
    });
    return candles;
  } catch (err) {
    // Upstream blip (429, 5xx, network). Serve the last good candles if we ever
    // fetched them so a transient Coingecko failure doesn't blank a chart that
    // loaded fine moments ago. Freshness resumes on the next successful call.
    if (cached) return cached.data;
    throw err;
  }
}

// One round trip pulls 24h sparklines for every curated xStock. Coingecko's
// /coins/markets endpoint includes `sparkline_in_7d` per coin when sparkline=true.
// We trim each coin's sparkline to the last 24 hours of points for compactness.
export async function fetchAllSparklines(): Promise<Record<string, number[]>> {
  if (Date.now() < sparklineCache.expiresAt) return sparklineCache.data;
  // True only after at least one successful fetch — distinguishes "stale" from
  // "never loaded" so we don't serve the empty backfill as if it were real data.
  const hasPriorData = sparklineCache.expiresAt > 0;

  try {
    assertCircuitClosed("sparklines");
    const ids = XSTOCKS.map((x) => x.coingeckoId).join(",");
    const res = await cgFetch("/coins/markets", {
      vs_currency: "usd",
      ids,
      sparkline: "true",
      price_change_percentage: "24h",
    });
    if (res.status === 429) await noteRateLimit(res);
    if (!res.ok) {
      throw new Error(`Coingecko /coins/markets: ${res.status}`);
    }
    const json = (await res.json()) as Array<{
      id: string;
      sparkline_in_7d?: { price?: number[] };
    }>;

    const idToMint = new Map(XSTOCKS.map((x) => [x.coingeckoId, x.mint]));
    const map: Record<string, number[]> = {};
    for (const coin of json) {
      const mint = idToMint.get(coin.id);
      if (!mint) continue;
      const points = coin.sparkline_in_7d?.price ?? [];
      // Coingecko's 7d sparkline is hourly (~168 points). Keep the last 24 for a
      // 24h sparkline.
      map[mint] = points.slice(-24);
    }
    // Backfill empties for any xStock Coingecko didn't return so the client UI
    // sees a stable shape.
    for (const x of XSTOCKS) {
      if (!(x.mint in map)) map[x.mint] = [];
    }

    sparklineCache.data = map;
    sparklineCache.expiresAt = Date.now() + SPARKLINE_TTL_MS;
    return map;
  } catch (err) {
    // Serve the last good sparklines on a transient upstream failure rather than
    // wiping every asset-grid chart to empty.
    if (hasPriorData) return sparklineCache.data;
    throw err;
  }
}

// Client-side helpers --------------------------------------------------------

export type SparklinesResponse = Record<string, number[]>;

export async function fetchSparklines(): Promise<SparklinesResponse> {
  const res = await fetch("/api/jupiter/sparklines", { cache: "no-store" });
  if (!res.ok) throw new Error(`Sparklines fetch failed: ${res.status}`);
  return (await res.json()) as SparklinesResponse;
}

// `key` as for fetchChart: a catalog mint or a chart-only key.
export async function fetchChartViaProxy(
  key: string,
  range: ChartRange,
  opts?: { retries?: number },
): Promise<OhlcCandle[]> {
  // Retry transient failures (a 502 from an upstream blip, a network hiccup)
  // with backoff so one stumble doesn't leave the chart stuck on an error.
  //
  // A 503 is NOT retried. The route sends it only for a rate limit, and it
  // carries a Retry-After. This used to retry everything twice at 500ms and
  // 1s, which meant one rate-limited range turned into three requests against
  // the window that was already exhausted, and clicking through the timeframe
  // picker could put the whole provider into a cooldown it then kept
  // refreshing. Reported as "switching timeframes is broken", which it was.
  const retries = opts?.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `/api/jupiter/chart?key=${encodeURIComponent(key)}&range=${range}`,
        { cache: "no-store" },
      );
      if (res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after")) || 60;
        throw new ChartRateLimitError(
          `Chart data is rate limited. Try again in ${retryAfter}s.`,
          retryAfter,
        );
      }
      if (!res.ok) throw new Error(`Chart fetch failed: ${res.status}`);
      return (await res.json()) as OhlcCandle[];
    } catch (err) {
      if (err instanceof ChartRateLimitError) throw err;
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

// Distinguishes "wait" from "this broke" for a caller that wants to say so.
export class ChartRateLimitError extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(message);
    this.name = "ChartRateLimitError";
  }
}
