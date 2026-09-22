// Asserts that the account total equals the holding rows the UI draws.
//
// This is a regression check for one bug that has now shipped three times, each
// time in a different surface and each time the same shape: a balance rendered
// as a row while the total next to it was computed by a second walk over the
// inputs that forgot one of them.
//
//   1. Off-Solana USDC rendered in the wallet list, missing from the header.
//   2. Ondo collateral withdrawn to Ethereum, same.
//   3. The Portfolio tab's "In wallet" tile priced the Solana side alone, so it
//      and Net worth understated by everything held on Ethereum, Base, BNB
//      Chain, Monad or Lighter.
//
// The fix was to make totalPortfolioUsd the sum of portfolioHoldings rather than
// its own walk. This script pins that: it builds a wallet holding something on
// every surface the app can see and asserts the two agree, and separately that
// every priced row groupHoldings renders is present in the enumeration.
//
// The second half covers the same failure in the Portfolio tab's trendline,
// which sat under the tile it disagreed with. Its last point must be the "In
// wallet" total exactly, including when a curve fails to load.
//
//   npx tsx scripts/portfolio-total-check.mts

import { SOL_MINT } from "../lib/jupiter/constants";
import type { OhlcCandle } from "../lib/jupiter/charts";
import { combineTrendSeries } from "../lib/jupiter/portfolio-trend";
import { XSTOCKS, xstockByMint } from "../lib/jupiter/xstocks";
import type { JupiterPriceMap } from "../lib/jupiter/prices";
import type { AccountBalances } from "../lib/solana/balances";
import {
  groupHoldings,
  portfolioHoldings,
  sumHoldingsUsd,
  totalPortfolioUsd,
} from "../lib/solana/holdings";
import { SOLANA_EQUIVALENT_TOKENS } from "../lib/solana/equivalent-tokens";
import { EQUIVALENCE } from "../lib/trustware/equivalents";
import type { HeldEquivalent } from "../lib/trustware/planner";
import type { NativeHolding } from "../lib/trustware/native";
import type { StableHolding } from "../lib/trustware/stables";
import type { OndoWalletHolding } from "../lib/trustware/ondo-holdings";

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

// ── Fixture ────────────────────────────────────────────────────────────────
// One holding on every surface, with prices chosen so each contribution is a
// round number and a missing one is obvious in the total.

const TSLA = XSTOCKS.find((x) => x.symbol === "TSLAx");
if (!TSLA) throw new Error("TSLAx missing from the catalog");
// A second equity, so the trend checks below have two curves and deleting one
// still leaves a time axis to draw on.
const NVDA = XSTOCKS.find((x) => x.symbol === "NVDAx");
if (!NVDA) throw new Error("NVDAx missing from the catalog");
const TSLAON = SOLANA_EQUIVALENT_TOKENS.find((t) => t.symbol === "TSLAon");
if (!TSLAON) throw new Error("TSLAon missing from the equivalent registry");

// The two EVM sources the registry lists for Tesla: Ondo's, which has a Solana
// twin, and Backed's, which does not. The second is the one the old total
// dropped.
const tslaSources = EQUIVALENCE.find((e) => e.underlying === "TSLA")!.sources;
const evmOndo = tslaSources.find(
  (s) => s.kind === "evm" && s.symbol === "TSLAon" && s.chain === "1",
);
const evmXStock = tslaSources.find(
  (s) => s.kind === "evm" && s.symbol === "TSLAx" && s.chain === "1",
);
if (!evmOndo || !evmXStock) throw new Error("Tesla EVM sources missing");

const balances: AccountBalances = {
  sol: 2,
  usdc: 100,
  xstocks: { [TSLA.mint]: 3, [NVDA.mint]: 1 },
  equivalents: { [TSLAON.mint]: 4 },
  usdcAtomic: "100000000",
  xstocksAtomic: { [TSLA.mint]: "300000000", [NVDA.mint]: "100000000" },
  equivalentsAtomic: { [TSLAON.mint]: "4000000000" },
};

const prices: JupiterPriceMap = {
  [SOL_MINT]: { usdPrice: 50 },
  [TSLA.mint]: { usdPrice: 10 },
  [NVDA.mint]: { usdPrice: 7 },
  [TSLAON.mint]: { usdPrice: 10 },
} as unknown as JupiterPriceMap;

// 18 decimals on both, per the registry.
const crossChain: HeldEquivalent[] = [
  { source: evmOndo, balanceAtomic: (5n * 10n ** 18n).toString() },
  { source: evmXStock, balanceAtomic: (6n * 10n ** 18n).toString() },
] as unknown as HeldEquivalent[];

const native: NativeHolding[] = [
  {
    chain: "1",
    chainLabel: "Ethereum",
    symbol: "ETH",
    decimals: 18,
    balanceAtomic: (1n * 10n ** 18n).toString(),
    priceId: "ethereum",
  },
];
const nativePrices = { ethereum: 2000, monad: 3 };

const stables: StableHolding[] = [
  {
    chain: "1",
    chainLabel: "Ethereum",
    symbol: "USDC",
    decimals: 6,
    balanceAtomic: "25000000",
    contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
];

// Ondo margin tokens have no Solana twin in the equivalence registry; they are
// priced through unwindTargetFor. An empty list still exercises the loop, and a
// populated one needs a live route table, so this stays empty on purpose.
const ondo: OndoWalletHolding[] = [];

const args = [
  balances,
  prices,
  crossChain,
  native,
  nativePrices,
  ondo,
  stables,
] as const;

// ── Checks ─────────────────────────────────────────────────────────────────

console.log("\nPortfolio total vs. holding rows\n");

const rows = portfolioHoldings(...args);
const total = totalPortfolioUsd(...args);

check(
  "totalPortfolioUsd is exactly the sum of portfolioHoldings",
  total != null && near(total, sumHoldingsUsd(rows)),
  `total=${total} rows=${sumHoldingsUsd(rows)}`,
);

// SOL 100 + USDC 100 + TSLAx 30 + NVDAx 7 + TSLAon 40 + EVM TSLAon 50
// + EVM TSLAx 60 + ETH 2000 + Ethereum USDC 25
const EXPECTED = 100 + 100 + 30 + 7 + 40 + 50 + 60 + 2000 + 25;
check(
  `every surface is counted (expected $${EXPECTED})`,
  total != null && near(total, EXPECTED),
  `got ${total}`,
);

check(
  "an EVM-held xStock is priced off its Solana mint, not dropped",
  rows.some(
    (r) => r.symbol === "TSLAx" && r.chainLabel === "Ethereum" && r.usd === 60,
  ),
  rows.map((r) => `${r.symbol}@${r.chainLabel}=${r.usd}`).join(" "),
);

check(
  "keys are unique, so the same symbol on two chains is two rows",
  new Set(rows.map((r) => r.key)).size === rows.length,
  rows.map((r) => r.key).join(" "),
);

check(
  "null balances read as null, not as zero",
  totalPortfolioUsd(null, prices, crossChain, native, nativePrices) === null,
);

// The recurring failure, stated directly: the wallet panel draws its equity
// rows from groupHoldings, so anything priced there has to be in the total.
const groups = groupHoldings(balances, prices, crossChain);
const missing: string[] = [];
for (const group of groups) {
  for (const part of group.parts) {
    if (part.usd == null) continue;
    const found = rows.find(
      (r) =>
        r.symbol === part.symbol &&
        r.chainLabel === part.chainLabel &&
        near(r.usd, part.usd ?? 0),
    );
    if (!found) missing.push(`${part.symbol}@${part.chainLabel} $${part.usd}`);
  }
}
check(
  "every priced groupHoldings row appears in the total",
  missing.length === 0,
  missing.join(", "),
);

// ── Trendline ──────────────────────────────────────────────────────────────
// The card sits directly under the "In wallet" tile, so its last point has to
// be that same number. It was not: it priced Solana xStock balances at the last
// candle close and pinned everything else flat, which both excluded the
// off-Solana holdings and left the level a cent under the tile.

console.log("\nTrendline vs. the In wallet tile\n");

check(
  "every chartMint is a curated mint /api/jupiter/chart will serve",
  rows.every((r) => !r.chartMint || xstockByMint(r.chartMint) != null),
  rows
    .filter((r) => r.chartMint && !xstockByMint(r.chartMint))
    .map((r) => `${r.symbol}->${r.chartMint}`)
    .join(" "),
);

const chartable = new Map<string, number>();
for (const r of rows) {
  if (!r.chartMint) continue;
  chartable.set(r.chartMint, (chartable.get(r.chartMint) ?? 0) + r.usd);
}
const flatUsd = rows.reduce((s, r) => (r.chartMint ? s : s + r.usd), 0);

check(
  "the Ondo mints and the EVM holdings all ride a curve, not the baseline",
  chartable.get(TSLA.mint) != null && chartable.get(TSLA.mint)! > 0,
  `chartable=${[...chartable].map(([m, v]) => `${m}=${v}`).join(" ")}`,
);

// A curve that halves and recovers, so a correct series starts below the
// current level and ends exactly on it.
function curve(closes: number[]): OhlcCandle[] {
  return closes.map((c, i) => ({
    t: 1_700_000_000 + i * 86_400,
    o: c,
    h: c,
    l: c,
    c,
  })) as OhlcCandle[];
}
const candles = Object.fromEntries(
  [...chartable.keys()].map((mint) => [mint, curve([5, 7, 10])]),
);

const series = combineTrendSeries(candles, chartable, flatUsd);
const lastPoint = series[series.length - 1]?.v;
check(
  "the last point is exactly the In wallet total",
  lastPoint != null && total != null && near(lastPoint, total),
  `last=${lastPoint} inWallet=${total}`,
);

// Half price on the charted share, all of the flat share.
const chartedUsd = [...chartable.values()].reduce((s, v) => s + v, 0);
check(
  "the first point moves only the charted share",
  near(series[0].v, flatUsd + chartedUsd * 0.5),
  `first=${series[0].v} expected=${flatUsd + chartedUsd * 0.5}`,
);

// The failure that used to blank the card: one mint's history missing.
const partial = { ...candles };
delete partial[TSLA.mint];
const degraded = combineTrendSeries(partial, chartable, flatUsd);
check(
  "a missing curve is held flat, so the level survives a failed fetch",
  degraded.length > 0 &&
    near(degraded[degraded.length - 1].v, total ?? 0),
  `last=${degraded[degraded.length - 1]?.v} inWallet=${total}`,
);

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
