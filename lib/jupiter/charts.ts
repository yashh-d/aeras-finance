// Chart and sparkline data come from Coingecko. xStocks are all listed there
// (platforms.solana -> mint), so we hit their per-coin /market_chart endpoint
// for the main chart and the bulk /coins/markets endpoint (with sparkline=true)
// for the asset grid. Coingecko gives gap-free price snapshots even for thinly
// traded xStocks, where DEX-pool-based feeds (GeckoTerminal) often return empty.
//
// Rate limits (free tier, keyless): ~30 req/min. We cache aggressively (15s for
// sparklines, 30s for the active range) so steady-state traffic per ticker is
// well under the limit.

import { xstockByMint, XSTOCKS } from "./xstocks";

// If you hit Coingecko rate limits on free/keyless calls, sign up for a free
// Demo key (https://www.coingecko.com/en/api/pricing) and set COINGECKO_API_KEY
// in .env.local. Demo plan = 30 req/min, sent via x-cg-demo-api-key header.
// Pro keys are auto-detected and sent via x-cg-pro-api-key.
const CG_PUBLIC_BASE = "https://api.coingecko.com/api/v3";
const CG_PRO_BASE = "https://pro-api.coingecko.com/api/v3";

function cgFetch(path: string, params: Record<string, string>): Promise<Response> {
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

export type ChartRange = "1D" | "1W" | "1M" | "3M";

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

// Coingecko free-tier limit is ~10–30 req/min. The chart endpoint isn't real-
// time critical (xStocks track real equities that price-snapshot intraday), so
// we cache for 60s on charts and 60s on sparklines.
const CHART_TTL_MS = 60 * 1000;
const SPARKLINE_TTL_MS = 60 * 1000;

function rangeToDays(range: ChartRange): number {
  switch (range) {
    case "1D":
      return 1;
    case "1W":
      return 7;
    case "1M":
      return 30;
    case "3M":
      return 90;
  }
}

export async function fetchChart(
  mint: string,
  range: ChartRange,
): Promise<OhlcCandle[]> {
  const xstock = xstockByMint(mint);
  if (!xstock) {
    throw new Error(`No curated xStock for mint ${mint}`);
  }

  const cacheKey = `${xstock.coingeckoId}:${range}`;
  const cached = chartCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const res = await cgFetch(`/coins/${xstock.coingeckoId}/market_chart`, {
    vs_currency: "usd",
    days: String(rangeToDays(range)),
  });
  if (res.status === 429) {
    throw new Error(
      "Coingecko rate limit hit. Set COINGECKO_API_KEY in .env.local or wait ~1 minute.",
    );
  }
  if (!res.ok) {
    throw new Error(
      `Coingecko /market_chart ${xstock.coingeckoId} ${range}: ${res.status}`,
    );
  }
  const json = (await res.json()) as CGMarketChart;
  const prices = json.prices ?? [];
  if (prices.length === 0) {
    throw new Error(`Coingecko returned no prices for ${xstock.coingeckoId} ${range}`);
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
    expiresAt: Date.now() + CHART_TTL_MS,
  });
  return candles;
}

// One round trip pulls 24h sparklines for every curated xStock. Coingecko's
// /coins/markets endpoint includes `sparkline_in_7d` per coin when sparkline=true.
// We trim each coin's sparkline to the last 24 hours of points for compactness.
export async function fetchAllSparklines(): Promise<Record<string, number[]>> {
  if (Date.now() < sparklineCache.expiresAt) return sparklineCache.data;

  const ids = XSTOCKS.map((x) => x.coingeckoId).join(",");
  const res = await cgFetch("/coins/markets", {
    vs_currency: "usd",
    ids,
    sparkline: "true",
    price_change_percentage: "24h",
  });
  if (res.status === 429) {
    throw new Error(
      "Coingecko rate limit hit. Set COINGECKO_API_KEY in .env.local or wait ~1 minute.",
    );
  }
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
}

// Client-side helpers --------------------------------------------------------

export type SparklinesResponse = Record<string, number[]>;

export async function fetchSparklines(): Promise<SparklinesResponse> {
  const res = await fetch("/api/jupiter/sparklines", { cache: "no-store" });
  if (!res.ok) throw new Error(`Sparklines fetch failed: ${res.status}`);
  return (await res.json()) as SparklinesResponse;
}

export async function fetchChartViaProxy(
  mint: string,
  range: ChartRange,
): Promise<OhlcCandle[]> {
  const res = await fetch(
    `/api/jupiter/chart?mint=${mint}&range=${range}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Chart fetch failed: ${res.status}`);
  return (await res.json()) as OhlcCandle[];
}
