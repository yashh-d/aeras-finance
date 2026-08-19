// Candle verification for the hedge tab charts. Pins the parts of Lighter's
// price-history endpoint that are undocumented or actively wrong in the docs,
// so a chart that silently truncates or draws in 1970 fails here instead.
//
//   npx tsx scripts/lighter-candles-check.mts
//
// Read-only. Signs nothing and submits nothing.

import {
  LIGHTER_API_BASE_URL,
  LIGHTER_API_PREFIX,
  LIGHTER_MAX_CANDLES,
} from "../lib/lighter/constants";
import {
  CANDLE_RANGES,
  candleWindow,
  downsampleCloses,
  isCandleRange,
  parseCandles,
  parseMarketId,
  seriesChangePercent,
  type CandleRange,
  type LighterCandle,
} from "../lib/lighter/candles";
import { buildCatalog, findMarket } from "../lib/lighter/markets";
import { lighterCandles, lighterOrderBookDetails } from "../lib/lighter/server";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  pass  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

const NOW = Date.now();

// ── Window arithmetic ──────────────────────────────────────────────────────

section("Window arithmetic");

for (const range of CANDLE_RANGES) {
  const w = candleWindow(range, NOW);
  check(
    `${range} stays under the ${LIGHTER_MAX_CANDLES}-bar cap`,
    w.bars <= LIGHTER_MAX_CANDLES,
    `${w.bars} bars at ${w.resolution}`,
  );
}

check(
  "every window ends now",
  CANDLE_RANGES.every((r) => candleWindow(r, NOW).endMs === NOW),
);
check(
  "every window starts in the past",
  CANDLE_RANGES.every((r) => candleWindow(r, NOW).startMs < NOW),
);
check("a known range is accepted", isCandleRange("1D"));
check("an unknown range is refused", !isCandleRange("5Y"));
check("a null range is refused", !isCandleRange(null));

// ── Resolution support ─────────────────────────────────────────────────────

section("Resolution support");

async function rawCandles(
  marketId: number,
  resolution: string,
): Promise<{ code: number }> {
  const params = new URLSearchParams({
    market_id: String(marketId),
    resolution,
    start_timestamp: String(NOW - 7 * 24 * 60 * 60 * 1000),
    end_timestamp: String(NOW),
    count_back: "2",
    set_timestamp_to_end: "true",
  });
  const res = await fetch(
    `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/candles?${params}`,
    { headers: { Accept: "application/json" } },
  );
  return (await res.json()) as { code: number };
}

const details = await lighterOrderBookDetails();
const catalog = buildCatalog(details);
const spy = findMarket(catalog, "SPY");

if (!spy) {
  failures += 1;
  console.log("  FAIL  SPY is in the catalog");
} else {
  console.log(`        SPY is market ${spy.marketId}, marked ${spy.markPrice}`);

  // Every resolution the range table can emit must actually be accepted. A
  // rejection here is a 20001 body on an HTTP 200, so it is invisible without
  // reading the code.
  for (const resolution of ["1m", "5m", "1h", "4h", "1d"]) {
    const body = await rawCandles(spy.marketId, resolution);
    check(`resolution ${resolution} is accepted`, body.code === 200);
  }

  const rejected = await rawCandles(spy.marketId, "2h");
  check(
    "an unsupported resolution is rejected rather than silently substituted",
    rejected.code !== 200,
    `code ${rejected.code}`,
  );

  // ── The documented path does not exist ───────────────────────────────────

  section("Endpoint path");

  const wrongPath = await fetch(
    `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/candlesticks?market_id=${spy.marketId}&resolution=1h&start_timestamp=${NOW - 3600_000}&end_timestamp=${NOW}&count_back=2&set_timestamp_to_end=true`,
  );
  check(
    "the documented /candlesticks path is still absent",
    wrongPath.status === 403,
    `HTTP ${wrongPath.status}, which reads like a geo-block but is an unrouted path`,
  );

  const bogus = await fetch(
    `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/definitelyNotARoute`,
  );
  check(
    "an unrouted path answers the same way, so 403 never means blocked here",
    bogus.status === wrongPath.status,
  );

  // ── The bar cap ──────────────────────────────────────────────────────────

  section("Bar cap");

  const wideParams = new URLSearchParams({
    market_id: String(spy.marketId),
    resolution: "1h",
    // 30 days of hours is 720 bars, well over the cap.
    start_timestamp: String(NOW - 30 * 24 * 60 * 60 * 1000),
    end_timestamp: String(NOW),
    count_back: "5000",
    set_timestamp_to_end: "true",
  });
  const wide = parseCandles(
    await (
      await fetch(
        `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/candles?${wideParams}`,
      )
    ).json(),
  );
  check(
    "an over-wide window is capped rather than served in full",
    wide.length <= LIGHTER_MAX_CANDLES,
    `${wide.length} bars for a 720-bar request`,
  );
  check(
    "count_back does not raise the cap",
    wide.length <= LIGHTER_MAX_CANDLES,
    "5000 requested",
  );

  // ── Live series ──────────────────────────────────────────────────────────

  section("Live series");

  const byRange = new Map<CandleRange, LighterCandle[]>();
  for (const range of CANDLE_RANGES) {
    const { candles } = await lighterCandles(spy.marketId, range, NOW);
    byRange.set(range, candles);
    check(`${range} returns bars`, candles.length > 0, `${candles.length}`);
  }

  const day = byRange.get("1D") ?? [];

  check(
    "bars are ordered oldest first",
    day.every((c, i) => i === 0 || c.t >= day[i - 1].t),
  );
  check(
    "timestamps are milliseconds, not seconds",
    // A seconds value for a 2026 date is ~1.78e9; milliseconds is ~1.78e12. The
    // Jupiter chart's OhlcCandle is seconds, so this is the field most likely to
    // be mixed up between the two.
    day.length > 0 && day[day.length - 1].t > 1e12,
    String(day[day.length - 1]?.t),
  );
  check(
    "the last bar is recent",
    day.length > 0 && NOW - day[day.length - 1].t < 2 * 60 * 60 * 1000,
  );
  check(
    "high is never below low",
    day.every((c) => c.h >= c.l),
  );
  check(
    "open and close sit inside the high-low range",
    day.every((c) => c.o <= c.h && c.o >= c.l && c.c <= c.h && c.c >= c.l),
  );
  check(
    "no bar is priced at zero, so the series has no gaps to draw through",
    day.every((c) => c.c > 0),
  );

  const traded = day.filter((c) => c.traded);
  check(
    "some bars carry trades",
    traded.length > 0,
    `${traded.length} of ${day.length}`,
  );
  check(
    "quote volume divided by base volume lands near the bar price",
    traded.every((c) => {
      const vwap = c.quoteVolume / c.v;
      return vwap >= c.l * 0.98 && vwap <= c.h * 1.02;
    }),
  );
  check(
    "an untraded bar is flat rather than absent",
    day.filter((c) => !c.traded).every((c) => c.o === c.c && c.h === c.l),
  );

  const change = seriesChangePercent(day);
  check("the day change is measurable", change !== null, `${change?.toFixed(2)}%`);
  check("a one-bar series has no measurable change", seriesChangePercent(day.slice(0, 1)) === null);
  check("an empty series has no measurable change", seriesChangePercent([]) === null);

  // ── Equity markets run around the clock ──────────────────────────────────

  section("Equity coverage");

  const week = byRange.get("1W") ?? [];
  const spanHours = week.length > 1 ? (week[week.length - 1].t - week[0].t) / 3_600_000 : 0;
  check(
    "a week of SPY bars is continuous, matching 24/7 equity perps",
    week.length > 150,
    `${week.length} hourly bars over ${spanHours.toFixed(0)}h`,
  );

  // ── Sparkline thinning ───────────────────────────────────────────────────

  section("Sparkline thinning");

  const thinned = downsampleCloses(day, 40);
  check("thinning respects the point budget", thinned.length <= 40, `${thinned.length}`);
  check("thinning keeps the first close", thinned[0] === day[0].c);
  check(
    "thinning keeps the last close",
    thinned[thinned.length - 1] === day[day.length - 1].c,
  );
  check(
    "every thinned point is a real close, never an average",
    thinned.every((value) => day.some((c) => c.c === value)),
  );
  check(
    "a series shorter than the budget is passed through whole",
    downsampleCloses(day.slice(0, 5), 40).length === Math.min(5, day.length),
  );
}

// ── Proxy routes ─────────────────────────────────────────────────────────

section("Market id parsing");

// Market 0 is a real market, so the two values that Number() quietly turns into
// 0 have to be rejected before they reach it. Both were live: an omitted
// parameter and an empty `markets=` each served market 0's chart instead of a
// 400, which is someone else's asset under your ticker's heading.
check("a missing parameter is not market 0", parseMarketId(null) === null);
check("an empty parameter is not market 0", parseMarketId("") === null);
check("whitespace is not market 0", parseMarketId("   ") === null);
check("a non-numeric id is refused", parseMarketId("abc") === null);
check("a negative id is refused", parseMarketId("-1") === null);
check("a decimal id is refused", parseMarketId("1.5") === null);
check("market 0 is still reachable when asked for by name", parseMarketId("0") === 0);
check("a real market id parses", parseMarketId("128") === 128);
check("surrounding whitespace is tolerated", parseMarketId(" 128 ") === 128);

section("Rejections");

check(
  "a malformed body is reported rather than parsed into an empty chart",
  (() => {
    try {
      parseCandles({ code: 20001, message: "invalid param" });
      return false;
    } catch {
      return true;
    }
  })(),
);

console.log(
  failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
