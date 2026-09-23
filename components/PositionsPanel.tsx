"use client";

// Positions surface. Single-screen dashboard for a tokenized RWA + lending user.
// Composed of: allocation pie (current holdings), portfolio trendline (current
// holdings carried back along their own price curves), health-factor radial
// gauge per open borrow position, holdings table, and on-chain activity feed.
//
// All numbers come from sources already in the codebase: balances from
// useBalances, prices from Jupiter, position state from @jup-ag/lend, history
// from the existing /api/jupiter/chart proxy. No new server routes.
//
// The wallet side of this panel is NOT computed here. `holdings` is the whole
// account enumerated once by app/app/page.tsx, and the "In wallet" tile is its
// sum, so this panel, the sidebar total and the wallet panel cannot disagree.
// They did: this file priced the Solana side alone, so a user holding USDC on
// Ethereum or margin on Lighter saw a smaller number here than in the sidebar,
// and Net worth understated by the same amount.

import { useEffect, useMemo, useState } from "react";
import { GLASS_SURFACE, INSET_PANEL } from "@/lib/ui/surface";
import {
  STRATEGY_NAME,
  useStrategyRuns,
} from "@/lib/strategies/runs-client";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fetchChartViaProxy } from "@/lib/jupiter/charts";
import {
  combineTrendSeries,
  type CandleSet,
  type TrendPoint,
} from "@/lib/jupiter/portfolio-trend";
import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import { fetchLiveVaultStateViaProxy } from "@/lib/jupiter/borrow";
import { useBorrowSummary } from "@/lib/borrow/use-borrow-summary";
import type { PortfolioHolding } from "@/lib/solana/holdings";
import { getConnection } from "@/lib/solana/balances";

interface Props {
  walletAddress: string;
  // The whole account, enumerated once by the page, one entry per asset per
  // chain. Passed in rather than recomputed here: this panel used to price the
  // Solana side alone and label it "In wallet", which understated the tile by
  // whatever the user held on Ethereum, Base, BNB Chain, Monad or Lighter while
  // the sidebar and the wallet panel showed the full figure. Raw balances and
  // prices are deliberately not props any more, so there is nothing here to
  // recompute a second, disagreeing total from.
  holdings: PortfolioHolding[];
  // Sum of `holdings`, or null before the first balance read lands.
  walletUsd: number | null;
}

export function PositionsPanel({
  walletAddress,
  holdings,
  walletUsd,
}: Props) {
  const allocation = useMemo(() => buildAllocation(holdings), [holdings]);
  const positions = useBorrowPositions(walletAddress);
  // Which Strategies-page run opened a position, by collateral mint, so a
  // ladder's debt reads as "borrowed to buy more" rather than a plain borrow.
  const runs = useStrategyRuns(walletAddress);
  const strategyByMint = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of runs.runs) {
      if (r.status !== "done") continue;
      if (r.data.kind === "ladder") {
        for (const round of r.data.rounds) out.set(round.mint, STRATEGY_NAME.ladder);
      } else {
        out.set(r.mint, STRATEGY_NAME[r.strategy]);
      }
    }
    return out;
  }, [runs.runs]);
  const debtUsd = positions.reduce((sum, p) => sum + p.debtUsd, 0);
  const collateralUsd = positions.reduce((sum, p) => sum + p.collateralUsd, 0);
  const netWorthUsd =
    walletUsd != null ? walletUsd + collateralUsd - debtUsd : null;

  return (
    <div className="space-y-6">
      <Header
        netWorthUsd={netWorthUsd}
        walletUsd={walletUsd}
        debtUsd={debtUsd}
        collateralUsd={collateralUsd}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <AllocationCard allocation={allocation} totalUsd={walletUsd} />
        </Card>
        <Card className="lg:col-span-3">
          <PortfolioTrend holdings={holdings} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <HealthCard positions={positions} strategyByMint={strategyByMint} />
        </Card>
        <Card className="lg:col-span-3">
          <HoldingsTable allocation={allocation} />
        </Card>
      </div>

      <Card>
        <ActivityFeed walletAddress={walletAddress} />
      </Card>
    </div>
  );
}

// ── Card wrapper ───────────────────────────────────────────────────────────

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`${GLASS_SURFACE} p-5 lg:p-6 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header({
  netWorthUsd,
  walletUsd,
  debtUsd,
  collateralUsd,
}: {
  netWorthUsd: number | null;
  walletUsd: number | null;
  debtUsd: number;
  collateralUsd: number;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
          Portfolio
        </div>
        <h2 className="font-light text-2xl tracking-tight text-white">
          Portfolio overview
        </h2>
        <p className="text-sm text-white/45">
          Allocation, exposure, and lending health across your tokenized stocks
          and stables.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Net worth"
          value={fmtUsd(netWorthUsd)}
          accent="primary"
        />
        <StatTile label="In wallet" value={fmtUsd(walletUsd)} />
        <StatTile label="Collateral" value={fmtUsd(collateralUsd)} />
        <StatTile
          label="Borrowed"
          value={fmtUsd(debtUsd)}
          accent={debtUsd > 0 ? "warning" : undefined}
        />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "primary" | "warning";
}) {
  let valueClass = "font-mono tabular-nums text-white";
  // Brand blue at full strength disappears into a dark ground; the medium stop
  // is the one design.md pairs with the night canvas.
  if (accent === "primary")
    valueClass = "font-mono tabular-nums text-aeras-blue-medium";
  if (accent === "warning")
    valueClass = "font-mono tabular-nums text-aeras-warning";

  return (
    <div className={`${INSET_PANEL} px-4 py-3`}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-light ${valueClass}`}>{value}</div>
    </div>
  );
}

// ── Allocation pie ─────────────────────────────────────────────────────────

interface AllocationSlice extends PortfolioHolding {
  color: string;
}

// Distinct palette per kind so stables/native/stocks group visually. Each kind
// carries a ramp rather than one colour, because the same asset is genuinely
// held on several chains now: three USDC rows all drawn in one blue read as a
// single slice cut into pieces by nothing.
const STABLE_PALETTE = ["#1a73e8", "#4e8df2", "#8ab4f8"];
const NATIVE_PALETTE = ["#9c5cd6", "#b784e3", "#d2adf0"];
const STOCK_PALETTE = [
  "#119b62",
  "#e8a13a",
  "#d93232",
  "#4e8df2",
  "#c33ea4",
  "#1fa4a4",
  "#7b66e3",
  "#e87a2c",
  "#3c8a5a",
  "#a13a8b",
];

const PALETTES: Record<PortfolioHolding["kind"], string[]> = {
  stable: STABLE_PALETTE,
  native: NATIVE_PALETTE,
  stock: STOCK_PALETTE,
};

// Colour is assigned after sorting so the largest slice of each kind always
// gets that kind's strongest stop.
function buildAllocation(holdings: PortfolioHolding[]): AllocationSlice[] {
  const seen: Record<PortfolioHolding["kind"], number> = {
    stable: 0,
    native: 0,
    stock: 0,
  };
  return [...holdings]
    .sort((a, b) => b.usd - a.usd)
    .map((h) => {
      const palette = PALETTES[h.kind];
      const color = palette[seen[h.kind] % palette.length];
      seen[h.kind] += 1;
      return { ...h, color };
    });
}

function AllocationCard({
  allocation,
  totalUsd,
}: {
  allocation: AllocationSlice[];
  totalUsd: number | null;
}) {
  const total = allocation.reduce((s, a) => s + a.usd, 0);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Allocation
        </div>
        <div className="mt-1 text-sm font-medium tracking-tight text-white">
          By asset and chain
        </div>
      </div>

      {allocation.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-xs text-white/50">
          No balances yet
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="relative h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={allocation}
                  dataKey="usd"
                  nameKey="symbol"
                  innerRadius={62}
                  outerRadius={92}
                  paddingAngle={1}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {allocation.map((a) => (
                    <Cell key={a.key} fill={a.color} />
                  ))}
                </Pie>
                <Tooltip content={<AllocationTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">
                Total
              </div>
              <div className="font-mono text-base tabular-nums text-white">
                {fmtUsd(totalUsd)}
              </div>
            </div>
          </div>

          <ul className="space-y-1.5">
            {allocation.map((a) => {
              const pct = total > 0 ? (a.usd / total) * 100 : 0;
              return (
                <li
                  key={a.key}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block size-2 rounded-full flex-shrink-0"
                      style={{ background: a.color }}
                    />
                    <span className="font-medium text-white truncate">
                      {a.name}
                    </span>
                    <span className="text-white/50 truncate">
                      {a.symbol}
                      {a.chainLabel !== "Solana" ? ` · ${a.chainLabel}` : ""}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-white">${a.usd.toFixed(2)}</span>
                    <span className="text-white/50">{pct.toFixed(1)}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function AllocationTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ payload: AllocationSlice }>;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload;
  const pct = total > 0 ? (slice.usd / total) * 100 : 0;
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-white">
        {slice.name}{" "}
        <span className="text-white/50">
          · {slice.symbol} · {slice.chainLabel}
        </span>
      </div>
      <div className="font-mono tabular-nums text-white">
        ${slice.usd.toFixed(2)} · {pct.toFixed(1)}%
      </div>
    </div>
  );
}

// ── Portfolio trendline ────────────────────────────────────────────────────

// Every range Coingecko's keyless tier can actually tell apart, plus MAX.
//
// MAX is here knowing it draws the 1Y line today. That tier refuses a window
// past a year and lib/jupiter/charts.ts retries at the limit, so 1Y and MAX
// come back as the same 364-day series. It is not dead code: the data exists
// upstream, and MAX starts meaning what it says the day COINGECKO_API_KEY is
// set. 5Y is left out because it would be a second copy of the same line with
// no such payoff. 1D is left out at the other end: the trendline prices today's
// holdings against a historical curve, and over one day that is a slower, more
// caveated version of the live balance already shown above it.
const TREND_RANGES = ["1W", "1M", "3M", "6M", "YTD", "1Y", "MAX"] as const;
type TrendRange = (typeof TREND_RANGES)[number];

function PortfolioTrend({ holdings }: { holdings: PortfolioHolding[] }) {
  const [range, setRange] = useState<TrendRange>("1M");
  // Stamped with the request it answers, so loading and staleness are derived
  // rather than set. The effect then touches state only in its async callback,
  // which is what keeps a range switch from cascading renders.
  const [fetched, setFetched] = useState<{
    key: string;
    candles: CandleSet | null;
    error: string | null;
  } | null>(null);

  // Today's value per chartable mint, summed. Two holdings can share a curve:
  // TSLAx on Solana and TSLAx on Ethereum are one Tesla position moving on one
  // price, and TSLAon rides the same curve because it tracks it one for one.
  const chartable = useMemo(() => {
    const byMint = new Map<string, number>();
    for (const h of holdings) {
      if (!h.chartMint) continue;
      byMint.set(h.chartMint, (byMint.get(h.chartMint) ?? 0) + h.usd);
    }
    return byMint;
  }, [holdings]);

  // Everything with no price history, held at today's value. USDC and Lighter
  // margin are dollar denominated so flat is exactly right. SOL, ETH, BNB and
  // MON are not: /api/jupiter/chart serves the curated xStock catalog only, so
  // there is no curve to put them on and the line understates their movement.
  // The caption says so rather than letting the number imply otherwise.
  const flatUsd = useMemo(
    () =>
      holdings.reduce((sum, h) => (h.chartMint ? sum : sum + h.usd), 0),
    [holdings],
  );

  const mints = useMemo(() => [...chartable.keys()].sort(), [chartable]);
  // Joined so the effect compares by value: a fresh array of the same mints
  // every balance poll would otherwise refetch every chart every 60 seconds.
  const mintKey = mints.join(",");
  const requestKey = `${mintKey}|${range}`;

  // History is fetched on the mint list and the range alone. The series is
  // derived from it below, so a price tick or a balance poll re-levels the line
  // without refetching a month of candles every sixty seconds.
  useEffect(() => {
    const wanted = mintKey ? mintKey.split(",") : [];
    if (wanted.length === 0) return;
    let cancelled = false;

    // Settled, not all: one mint the proxy rate-limits used to blank the whole
    // card. A failed curve now falls back to flat at today's value, so the line
    // degrades by the share it could not chart instead of disappearing.
    Promise.allSettled(
      wanted.map((mint) =>
        fetchChartViaProxy(mint, range).then(
          (rows) => [mint, rows] as const,
        ),
      ),
    ).then((results) => {
      if (cancelled) return;
      const loaded: CandleSet = {};
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const [mint, rows] = r.value;
        if (rows.length > 0) loaded[mint] = rows;
      }
      const rejected = results.find((r) => r.status === "rejected");
      setFetched({
        key: requestKey,
        candles: Object.keys(loaded).length > 0 ? loaded : null,
        error:
          Object.keys(loaded).length > 0
            ? null
            : rejected && rejected.status === "rejected"
              ? String(rejected.reason)
              : "No price history",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [mintKey, range, requestKey]);

  // Only the response to the request currently on screen counts. A stale one
  // from the previous range reads as still loading rather than being drawn.
  const current = fetched?.key === requestKey ? fetched : null;
  const loading = mints.length > 0 && current == null;
  const error = current?.error ?? null;

  const series = useMemo(
    () =>
      current?.candles
        ? combineTrendSeries(current.candles, chartable, flatUsd)
        : null,
    [current, chartable, flatUsd],
  );

  const first = series?.[0]?.v;
  const last = series?.[series.length - 1]?.v;
  const change =
    first != null && last != null && first !== 0
      ? ((last - first) / first) * 100
      : null;
  const positive = change == null ? null : change >= 0;
  const stroke =
    positive == null ? "#6f7174" : positive ? "#119b62" : "#d93232";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Portfolio value · indicative
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-2xl font-light tracking-tight text-white tabular-nums">
              {last != null ? `$${last.toFixed(2)}` : "—"}
            </span>
            {change != null && (
              <span
                className={`font-mono text-xs tabular-nums ${
                  positive ? "text-aeras-positive" : "text-aeras-negative"
                }`}
              >
                {positive ? "+" : ""}
                {change.toFixed(2)}% · {range}
              </span>
            )}
          </div>
          {/* Says which part of the number is real movement. Without it a
              wallet that is mostly USDC reads as a portfolio that barely moved,
              when what actually happened is that most of it cannot move. */}
          <div className="mt-1 text-[11px] text-white/50">
            Current holdings priced against the historical price curve.
            {flatUsd > 0 && (
              <>
                {" "}
                {fmtUsd(flatUsd)} in dollar balances and gas is held flat.
              </>
            )}
          </div>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-white/10 p-0.5">
          {TREND_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                r === range
                  ? "bg-aeras-blue text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-48 w-full">
        {mints.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-white/50">
            Buy a tokenized asset to see your portfolio trend. Dollar balances
            have no curve to draw.
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-white/60">
            {/rate limit/i.test(error)
              ? "Price history rate-limited"
              : "Price history unavailable"}
          </div>
        ) : loading || !series || series.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-white/50">
            {loading ? "Loading…" : "No data"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={series}
              margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis dataKey="v" domain={["dataMin", "dataMax"]} hide />
              <Tooltip content={<TrendTooltip />} />
              <Area
                type="monotone"
                dataKey="v"
                stroke={stroke}
                strokeWidth={1.4}
                fill="url(#trendFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs shadow-sm">
      <div className="font-mono tabular-nums text-white">
        ${p.v.toFixed(2)}
      </div>
      <div className="text-white/50">
        {new Date(p.t * 1000).toLocaleDateString()}
      </div>
    </div>
  );
}

// ── Health card ────────────────────────────────────────────────────────────

interface AggregatePosition {
  // Stable identity across venues. `vaultId` was the key while this read
  // Jupiter alone; a Kamino obligation has no vault id.
  key: string;
  venueLabel: string;
  collateralSymbol: string;
  collateralMint: string;
  borrowSymbol: string;
  collateralUi: number;
  debtUi: number;
  collateralUsd: number;
  debtUsd: number;
  ltvPct: number;
  liquidationPct: number;
  healthFactor: number;
  liquidationPrice: number | null;
  // False when the collateral is posted with nothing drawn against it. Such a
  // position has no LTV, no health and nothing to liquidate, so the figures
  // above are all zero or infinite and the row says so instead of drawing them.
  hasLoan: boolean;
}

// Every open borrow the account holds, at every venue, with the numbers this
// panel draws health and net worth from.
//
// This used to scan XSTOCK_BORROW_VAULTS directly and read Jupiter Lend alone,
// which is why a Kamino borrow showed up here as no position, no health factor,
// and a net worth that counted neither the posted collateral nor the debt. It
// also loaded exactly once per mount, with no refresh and no polling, so a
// position closed elsewhere in the app stayed on screen until a page reload.
//
// Both are fixed by reading the shared snapshot instead: useBorrowSummary
// already covers both venues, already settles after an action rather than
// committing the first (possibly pre-settlement) read, and is cached across
// consumers, so this costs no extra chain reads on a page that has already
// mounted the borrow panel.
//
// Collateral posted with no loan against it is included. A user who deposits
// stock and then does not borrow -- or whose borrow leg failed after the
// deposit leg landed -- has watched that stock leave their wallet, and this is
// the surface that has to account for it. Its net worth counts it too.
function useBorrowPositions(walletAddress: string): AggregatePosition[] {
  const summary = useBorrowSummary({
    walletAddress,
    // Only the position lists are read here. Capacity is the borrow panel's
    // headline, and computing it needs prices and balances this panel
    // deliberately no longer takes as props.
    prices: null,
    balances: null,
    equivalents: [],
  });

  // The Jupiter side's oracle price, which the summary does not carry. Read per
  // position rather than per vault: an account with nothing at Jupiter makes no
  // calls at all. Kamino's obligation already reports its own USD figures.
  const summaryPositions = summary.positions;
  const summaryCollateralOnly = summary.collateralOnly;
  const open = useMemo(
    () => [...summaryPositions, ...summaryCollateralOnly],
    [summaryPositions, summaryCollateralOnly],
  );
  const [oraclePriceUsd, setOraclePriceUsd] = useState<Record<string, number>>(
    {},
  );

  useEffect(() => {
    const jupiter = open.filter((p) => p.ref.venue === "jupiter");
    if (jupiter.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        jupiter.map(async (p) => {
          if (p.ref.venue !== "jupiter") return null;
          try {
            const live = await fetchLiveVaultStateViaProxy(p.ref.vault.vaultId);
            return [p.key, live.oraclePriceUsd] as const;
          } catch (err) {
            console.error("[positions borrow vault]", err);
            return null;
          }
        }),
      );
      if (cancelled) return;
      setOraclePriceUsd(
        Object.fromEntries(entries.filter((e): e is [string, number] => e != null)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return useMemo(
    () =>
      open.map((p): AggregatePosition => {
        const base = {
          key: p.key,
          venueLabel: p.venueLabel,
          collateralSymbol: p.collateralSymbol,
          collateralMint: p.collateralMint,
          borrowSymbol: p.debtSymbol,
          collateralUi: p.collateralUi,
          debtUi: p.debtUi,
          // USDC on both venues, marked at $1.
          debtUsd: p.debtUi,
          hasLoan: p.debtUi > 0,
        };

        if (p.ref.venue === "kamino") {
          // Kamino reports LTV and its liquidation ceiling on the obligation
          // itself, at the oracle price liquidation is actually judged on, so
          // nothing here is re-derived from a price map.
          const pos = p.ref.position;
          const liquidationPct = pos.liquidationLtvPct;
          return {
            ...base,
            collateralUsd: pos.collateralUsd,
            ltvPct: pos.ltvPct,
            liquidationPct,
            healthFactor: pos.ltvPct > 0 ? liquidationPct / pos.ltvPct : Infinity,
            liquidationPrice:
              p.collateralUi > 0 && p.debtUi > 0 && liquidationPct > 0
                ? p.debtUi / (p.collateralUi * (liquidationPct / 100))
                : null,
          };
        }

        // Jupiter Lend. liquidationThreshold is in tenths of a percent.
        const vault = p.ref.vault;
        const price = oraclePriceUsd[p.key] ?? 0;
        const collateralUsd = p.collateralUi * price;
        const ltvPct = collateralUsd > 0 ? (p.debtUi / collateralUsd) * 100 : 0;
        const liquidationPct = vault.liquidationThreshold / 10;
        return {
          ...base,
          collateralUsd,
          ltvPct,
          liquidationPct,
          healthFactor: ltvPct > 0 ? liquidationPct / ltvPct : Infinity,
          liquidationPrice:
            p.collateralUi > 0 && p.debtUi > 0
              ? p.debtUi / (p.collateralUi * (vault.liquidationThreshold / 1000))
              : null,
        };
      }),
    [open, oraclePriceUsd],
  );
}

function HealthCard({
  positions,
  strategyByMint,
}: {
  positions: AggregatePosition[];
  strategyByMint: Map<string, string>;
}) {
  // Portfolio-wide health: weighted by collateral USD across all open positions.
  const totalCollateral = positions.reduce((s, p) => s + p.collateralUsd, 0);
  const totalDebt = positions.reduce((s, p) => s + p.debtUsd, 0);
  // Weighted average of liquidation thresholds, weighted by each collateral USD.
  const weightedLT =
    totalCollateral > 0
      ? positions.reduce(
          (s, p) => s + p.liquidationPct * (p.collateralUsd / totalCollateral),
          0,
        )
      : 0;
  const portfolioLtv =
    totalCollateral > 0 ? (totalDebt / totalCollateral) * 100 : 0;
  const portfolioHealth =
    portfolioLtv > 0 ? weightedLT / portfolioLtv : Infinity;

  const safe = portfolioHealth >= 1.5;
  const caution = portfolioHealth >= 1.1 && portfolioHealth < 1.5;
  const danger = portfolioHealth < 1.1;

  let color = "#9aa0a6";
  if (totalDebt > 0) {
    if (safe) color = "#119b62";
    else if (caution) color = "#e8a13a";
    else if (danger) color = "#d93232";
  }

  // RadialBar expects 0-100; map health 0..3+ onto 0..100, clamp at 100.
  const healthDisplay = Math.min(portfolioHealth, 3);
  const gaugeData = [
    {
      name: "health",
      value: Number.isFinite(healthDisplay)
        ? (healthDisplay / 3) * 100
        : 100,
      fill: color,
    },
  ];

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Health factor
        </div>
        <div className="mt-1 text-sm font-medium tracking-tight text-white">
          Across borrow positions
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center text-center">
          <span className="text-xs text-white/50">No open borrow positions</span>
          <span className="mt-1 text-[11px] text-white/50">
            Pledge a tokenized stock to start tracking health here.
          </span>
        </div>
      ) : (
        <>
          <div className="relative h-44">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="70%"
                outerRadius="100%"
                barSize={14}
                data={gaugeData}
                startAngle={210}
                endAngle={-30}
              >
                <PolarAngleAxis
                  type="number"
                  domain={[0, 100]}
                  angleAxisId={0}
                  tick={false}
                />
                <RadialBar
                  background={{ fill: "#f1f2f3" }}
                  dataKey="value"
                  cornerRadius={6}
                  isAnimationActive={false}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-mono text-3xl font-light tabular-nums text-white">
                {Number.isFinite(portfolioHealth)
                  ? `${portfolioHealth.toFixed(2)}×`
                  : "∞"}
              </div>
              <div
                className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em]"
                style={{ color }}
              >
                {danger ? "At risk" : caution ? "Watch" : "Healthy"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <MiniStat
              label="Portfolio LTV"
              value={`${portfolioLtv.toFixed(1)}%`}
            />
            <MiniStat
              label="Weighted LT"
              value={`${weightedLT.toFixed(1)}%`}
            />
          </div>

          <ul className="space-y-1.5 pt-1">
            {positions.map((p) => (
              <PositionHealthRow
                key={p.key}
                pos={p}
                strategy={strategyByMint.get(p.collateralMint) ?? null}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className="mt-0.5 font-mono tabular-nums text-sm text-white">
        {value}
      </div>
    </div>
  );
}

function PositionHealthRow({
  pos,
  strategy,
}: {
  pos: AggregatePosition;
  // Name of the Strategies-page strategy that opened this, if one did.
  strategy: string | null;
}) {
  const safe = pos.healthFactor >= 1.5;
  const caution = pos.healthFactor >= 1.1 && pos.healthFactor < 1.5;
  const color = safe ? "#119b62" : caution ? "#e8a13a" : "#d93232";
  const ratio = Math.min(pos.ltvPct / pos.liquidationPct, 1);

  // Posted with nothing drawn against it. There is no health to report and no
  // bar to fill, so the row says where the collateral is and what it is worth
  // rather than drawing an empty gauge and a 0.0% LTV that reads as a fault.
  if (!pos.hasLoan) {
    return (
      <li className="flex items-center justify-between gap-3 text-xs">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 font-medium text-white">
              {pos.collateralSymbol}
              <span className="text-[10px] font-normal text-white/40">
                {pos.venueLabel}
              </span>
              {strategy && (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                  {strategy}
                </span>
              )}
            </span>
            <span className="font-mono tabular-nums text-white/70">
              {fmtUsd(pos.collateralUsd)}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-white/50">
            {pos.collateralUi.toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })}{" "}
            posted as collateral. Nothing borrowed against it.
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1.5 font-medium text-white">
            {pos.collateralSymbol} → {pos.borrowSymbol}
            {/* Both venues take the same collateral, so a user borrowing
                against the same stock at each would otherwise see two
                identical rows. */}
            <span className="text-[10px] font-normal text-white/40">
              {pos.venueLabel}
            </span>
            {strategy && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60">
                {strategy}
              </span>
            )}
          </span>
          <span className="font-mono tabular-nums" style={{ color }}>
            {Number.isFinite(pos.healthFactor)
              ? `${pos.healthFactor.toFixed(2)}×`
              : "∞"}
          </span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full"
            style={{ width: `${ratio * 100}%`, background: color }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-white/50">
          <span>
            LTV {pos.ltvPct.toFixed(1)}% / LT{" "}
            {pos.liquidationPct.toFixed(0)}%
          </span>
          {pos.liquidationPrice != null && (
            <span className="font-mono tabular-nums">
              Liq. ${pos.liquidationPrice.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Holdings table ─────────────────────────────────────────────────────────

function HoldingsTable({ allocation }: { allocation: AllocationSlice[] }) {
  const total = allocation.reduce((s, a) => s + a.usd, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Holdings
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-white">
            Detail
          </div>
        </div>
        <span className="text-xs text-white/50">
          {allocation.length} asset{allocation.length === 1 ? "" : "s"}
        </span>
      </div>

      {allocation.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-white/50">
          No balances yet. Fund USDC or buy a tokenized stock to populate this table.
        </div>
      ) : (
        <div className="divide-y divide-white/10">
          <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            <div className="col-span-4">Asset</div>
            <div className="col-span-3 text-right">Amount</div>
            <div className="col-span-3 text-right">Value</div>
            <div className="col-span-2 text-right">Share</div>
          </div>
          {allocation.map((a) => {
            const pct = total > 0 ? (a.usd / total) * 100 : 0;
            const decimals = a.kind === "stock" ? 4 : a.kind === "native" ? 4 : 2;
            return (
              <div
                key={a.key}
                className="grid grid-cols-12 items-center gap-2 py-2.5 text-sm"
              >
                <div className="col-span-4 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-2 rounded-full flex-shrink-0"
                      style={{ background: a.color }}
                    />
                    <span className="font-medium tracking-tight text-white truncate">
                      {a.symbol}
                    </span>
                  </div>
                  {/* Chain, not just the asset name: the same symbol can occupy
                      several rows, and without it two USDC lines read as a
                      duplicate rather than as one holding in two places. Left
                      off when the name already is the chain, so SOL does not
                      read "Solana · Solana". */}
                  <div className="text-[11px] text-white/50 truncate">
                    {a.name}
                    {a.name !== a.chainLabel ? ` · ${a.chainLabel}` : ""}
                  </div>
                </div>
                <div className="col-span-3 text-right font-mono tabular-nums text-white">
                  {a.amount.toLocaleString(undefined, {
                    maximumFractionDigits: decimals,
                  })}
                </div>
                <div className="col-span-3 text-right font-mono tabular-nums text-white">
                  ${a.usd.toFixed(2)}
                </div>
                <div className="col-span-2 text-right font-mono tabular-nums text-white/50">
                  {pct.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Activity feed ──────────────────────────────────────────────────────────

interface ActivityRow {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  memo: string | null;
}

function ActivityFeed({ walletAddress }: { walletAddress: string }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const conn = getConnection();
        const { PublicKey } = await import("@solana/web3.js");
        const owner = new PublicKey(walletAddress);
        const sigs = await conn.getSignaturesForAddress(owner, { limit: 15 });
        if (!cancelled) {
          setRows(
            sigs.map((s) => ({
              signature: s.signature,
              slot: s.slot,
              blockTime: s.blockTime ?? null,
              err: s.err,
              memo: s.memo ?? null,
            })),
          );
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Activity
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-white">
            Onchain transactions
          </div>
        </div>
        <a
          href={`https://solscan.io/account/${walletAddress}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-aeras-blue underline-offset-2 hover:underline"
        >
          View on Solscan
        </a>
      </div>

      {error ? (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
          Activity unavailable. {error}
        </p>
      ) : rows == null ? (
        <div className="flex h-32 items-center justify-center text-xs text-white/50">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-xs text-white/50">
          No transactions yet.
        </div>
      ) : (
        <ul className="divide-y divide-white/10">
          {rows.map((r) => (
            <ActivityRowView key={r.signature} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityRowView({ row }: { row: ActivityRow }) {
  const status = row.err ? "Failed" : "Confirmed";
  const statusColor = row.err ? "text-aeras-negative" : "text-aeras-positive";
  const when = row.blockTime
    ? new Date(row.blockTime * 1000).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : `slot ${row.slot}`;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className={`text-[10px] font-medium uppercase tracking-wider ${statusColor}`}>
            {status}
          </span>
          <span className="font-mono text-xs text-white/60 truncate">
            {row.signature.slice(0, 8)}…{row.signature.slice(-8)}
          </span>
        </div>
        {row.memo && (
          <div className="mt-0.5 text-[11px] text-white/50 truncate">
            {row.memo}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-white/50 whitespace-nowrap">{when}</span>
        <a
          href={`${SOLSCAN_TX_BASE}${row.signature}`}
          target="_blank"
          rel="noreferrer"
          className="text-aeras-blue underline-offset-2 hover:underline"
        >
          View
        </a>
      </div>
    </li>
  );
}

// ── Format helpers ─────────────────────────────────────────────────────────

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

