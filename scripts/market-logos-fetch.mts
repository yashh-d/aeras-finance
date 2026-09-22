// Fetches a mark for every tradeable Lighter market that has none, into
// public/logos/markets, and prints the registry lines for
// lib/tokens/market-logos.ts. Run when Lighter lists markets the registry
// does not know; the marks are self-hosted on purpose (see the note at the
// top of lib/tokens/logos.ts), so this is the only place a remote image is
// ever read.
//
//   npx tsx scripts/market-logos-fetch.mts            # fetch what is missing
//   npx tsx scripts/market-logos-fetch.mts --list     # only list what is missing
//
// Crypto marks come from CoinGecko, matched by symbol. Symbols collide there
// (a dozen coins call themselves AI), so among the candidates the one with the
// largest market cap is taken, which is the one a perps venue lists. The
// "1000X" markets are the coin X. Equities try a stock-logo source by ticker.
// Anything unresolved is printed as a badge line: FX pairs, commodities,
// indices and private companies have no mark anywhere, and the venue itself
// draws those as lettered badges.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildCatalog, tradeableMarkets } from "../lib/lighter/markets";
import { lighterOrderBookDetails } from "../lib/lighter/server";
import { MARKET_BADGE_TICKERS, marketLogo } from "../lib/tokens/market-logos";

const OUT_DIR = join(process.cwd(), "public", "logos", "markets");
const CACHE = join(process.cwd(), ".next", "coingecko-coins-list.json");
const LIST_ONLY = process.argv.includes("--list");
const UA = "Mozilla/5.0 (compatible; AerasFinance/0.1)";

// Symbols whose CoinGecko name differs from the market symbol.
const CRYPTO_ALIAS: Record<string, string> = {
  "1000PEPE": "PEPE",
  "1000SHIB": "SHIB",
  "1000BONK": "BONK",
  "1000FLOKI": "FLOKI",
  "1000NOT": "NOT",
  ETHFI: "ETHFI",
};

// Markets that are not coins and not listed equities: badges, not fetches.
const NOT_A_COIN = new Set([
  "USDJPY", "EURUSD", "USDCHF", "USDCAD", "GBPUSD", "USDKRW", "AUDUSD", "NZDUSD", "USDHKD",
  "XPT", "XPD", "XCU", "WHEAT", "BRENTOIL", "US10Y",
  "ANTHROPIC", "OPENAI", "SKHYNIXUSD", "SAMSUNGUSD", "HYUNDAIUSD", "KIOXIA", "XIAOMI",
  "TENCENT", "BYD", "POPMART", "SMIC", "ZHIPU", "MINIMAX", "UNITREE", "SHEIN", "H100",
]);

// Listed equities and ETFs: tried against the stock-logo source first.
const EQUITIES = new Set([
  "SNDK", "META", "MSFT", "GOOGL", "SPCX", "MU", "NVDA", "QQQ", "SPY", "HOOD", "AAPL",
  "NBIS", "MSTR", "SKHY", "TSLA", "DRAM", "CRCL", "COIN", "SOXL", "MRNA", "INTC", "ORCL",
  "CBRS", "AMZN", "AMD", "LITE", "TSM", "STRC", "BMNR", "MRVL", "PLTR", "DELL", "BABA",
  "RKLB", "EWY", "URA", "BB", "IWM", "NOW", "IBM", "ASML", "CRWV", "BOTZ", "AVGO", "ARM",
  "AXTI", "GEV", "AAOI", "SOXS", "NOK", "GME", "WEN", "TTWO", "WDC", "QCOM", "ADI", "BE",
  "KORU", "GLW", "NFLX",
]);

interface CoinRow {
  id: string;
  symbol: string;
  name: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function download(url: string, file: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return false;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 200) return false;
    writeFileSync(file, bytes);
    return true;
  } catch {
    return false;
  }
}

const details = await lighterOrderBookDetails();
const markets = tradeableMarkets(buildCatalog(details)).sort(
  (a, b) => b.dailyQuoteVolume - a.dailyQuoteVolume,
);
const missing = markets.filter(
  (m) => !marketLogo(m.symbol) && !(MARKET_BADGE_TICKERS as readonly string[]).includes(m.symbol),
);
console.log(`${markets.length} tradeable markets, ${missing.length} without a mark`);
console.log(missing.map((m) => m.symbol).join(" "));
if (LIST_ONLY) process.exit(0);

mkdirSync(OUT_DIR, { recursive: true });

// CoinGecko's full list, cached on disk: it is 15,000 rows and never the
// thing that changes between runs.
let coins: CoinRow[];
if (existsSync(CACHE)) {
  coins = JSON.parse(readFileSync(CACHE, "utf8")) as CoinRow[];
} else {
  coins = await getJson<CoinRow[]>("https://api.coingecko.com/api/v3/coins/list");
  writeFileSync(CACHE, JSON.stringify(coins));
}
const bySymbol = new Map<string, CoinRow[]>();
for (const c of coins) {
  const key = c.symbol.toLowerCase();
  const list = bySymbol.get(key);
  if (list) list.push(c);
  else bySymbol.set(key, [c]);
}

const fetched: string[] = [];
const badges: string[] = [];
const cryptoTargets: { symbol: string; candidates: CoinRow[] }[] = [];

for (const m of missing) {
  if (NOT_A_COIN.has(m.symbol)) {
    badges.push(m.symbol);
    continue;
  }
  if (EQUITIES.has(m.symbol)) {
    const file = join(OUT_DIR, `${m.symbol}.png`);
    const ok = await download(`https://assets.parqet.com/logos/symbol/${m.symbol}?format=png`, file);
    if (ok) fetched.push(m.symbol);
    else badges.push(m.symbol);
    continue;
  }
  const key = (CRYPTO_ALIAS[m.symbol] ?? m.symbol).toLowerCase();
  const candidates = bySymbol.get(key) ?? [];
  if (candidates.length === 0) badges.push(m.symbol);
  else cryptoTargets.push({ symbol: m.symbol, candidates });
}

// One markets call per 250 candidate ids gives market cap and the image URL
// for every candidate at once, which is what picks the real coin among the
// namesakes.
const ids = [...new Set(cryptoTargets.flatMap((t) => t.candidates.map((c) => c.id)))];
interface MarketRow { id: string; symbol: string; market_cap: number | null; image: string }
const rows = new Map<string, MarketRow>();
for (let i = 0; i < ids.length; i += 250) {
  const batch = ids.slice(i, i + 250);
  const page = await getJson<MarketRow[]>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&ids=${batch.join(",")}`,
  );
  for (const r of page) rows.set(r.id, r);
  // Well inside the keyless limit.
  await new Promise((r) => setTimeout(r, 2500));
}

for (const t of cryptoTargets) {
  const best = t.candidates
    .map((c) => rows.get(c.id))
    .filter((r): r is MarketRow => r != null)
    .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))[0];
  if (!best) {
    badges.push(t.symbol);
    continue;
  }
  const file = join(OUT_DIR, `${t.symbol}.png`);
  const ok = await download(best.image.replace("/small/", "/large/"), file);
  if (ok) {
    fetched.push(t.symbol);
    console.log(`  ${t.symbol.padEnd(12)} ${best.id}`);
  } else {
    badges.push(t.symbol);
  }
  await new Promise((r) => setTimeout(r, 150));
}

console.log(`\nFetched ${fetched.length}. Add to FILES in lib/tokens/market-logos.ts:`);
console.log(fetched.sort().map((s) => `      ["${s}", "png"],`).join("\n"));
console.log(`\nNo mark for ${badges.length}; badge them in BADGES:`);
console.log(badges.sort().join(" "));
