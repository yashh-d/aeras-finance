"use client";

// Positions surface. Single-screen dashboard for a tokenized RWA + lending user.
// Composed of: allocation pie (current holdings), portfolio trendline
// (current xStock holdings priced against 1M history), health-factor radial
// gauge per open borrow position, holdings table, and on-chain activity feed.
//
// All numbers come from sources already in the codebase: balances from
// useBalances, prices from Jupiter, position state from @jup-ag/lend, history
// from the existing /api/jupiter/chart proxy. No new server routes.

import { useEffect, useMemo, useState } from "react";
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

import { fetchChartViaProxy, type OhlcCandle } from "@/lib/jupiter/charts";
import { SOLSCAN_TX_BASE, SOL_MINT } from "@/lib/jupiter/constants";
import {
  XSTOCK_BORROW_VAULTS,
  fetchLiveVaultStateViaProxy,
  fetchPositionState,
  findExistingNftId,
  fromAtomicBN,
  type LiveVaultState,
  type UserPositionState,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import {
  getConnection,
  totalAccountUsd,
  type AccountBalances,
} from "@/lib/solana/balances";

interface Props {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
}

export function PositionsPanel({ walletAddress, balances, prices }: Props) {
  const totalUsd = totalAccountUsd(balances, prices);
  const allocation = useMemo(
    () => buildAllocation(balances, prices),
    [balances, prices],
  );
  const positions = useBorrowPositions(walletAddress);
  const debtUsd = positions.reduce((sum, p) => sum + p.debtUsd, 0);
  const collateralUsd = positions.reduce((sum, p) => sum + p.collateralUsd, 0);
  const netWorthUsd = totalUsd != null ? totalUsd + collateralUsd - debtUsd : null;

  return (
    <div className="space-y-6">
      <Header
        netWorthUsd={netWorthUsd}
        walletUsd={totalUsd}
        debtUsd={debtUsd}
        collateralUsd={collateralUsd}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <AllocationCard allocation={allocation} totalUsd={totalUsd} />
        </Card>
        <Card className="lg:col-span-3">
          <PortfolioTrend balances={balances} prices={prices} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <HealthCard positions={positions} />
        </Card>
        <Card className="lg:col-span-3">
          <HoldingsTable
            balances={balances}
            prices={prices}
            allocation={allocation}
          />
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
      className={`rounded-2xl border border-aeras-border bg-white p-5 lg:p-6 ${className ?? ""}`}
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
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Positions
        </div>
        <h2 className="font-light text-2xl tracking-tight text-aeras-900">
          Portfolio overview
        </h2>
        <p className="text-sm text-aeras-300">
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
  let valueClass = "font-mono tabular-nums text-aeras-900";
  if (accent === "primary") valueClass = "font-mono tabular-nums text-aeras-blue";
  if (accent === "warning")
    valueClass = "font-mono tabular-nums text-aeras-warning";

  return (
    <div className="rounded-xl border border-aeras-border bg-white px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-light ${valueClass}`}>{value}</div>
    </div>
  );
}

// ── Allocation pie ─────────────────────────────────────────────────────────

interface AllocationSlice {
  name: string;
  symbol: string;
  usd: number;
  amount: number;
  color: string;
  kind: "stable" | "native" | "stock";
}

// Distinct palette per kind so stables/native/stocks group visually.
const STABLE_COLOR = "#1a73e8";
const NATIVE_COLOR = "#9c5cd6";
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

function buildAllocation(
  balances: AccountBalances | null,
  prices: JupiterPriceMap | null,
): AllocationSlice[] {
  if (!balances) return [];
  const slices: AllocationSlice[] = [];

  if (balances.usdc > 0) {
    slices.push({
      name: "US Dollar",
      symbol: "USDC",
      usd: balances.usdc,
      amount: balances.usdc,
      color: STABLE_COLOR,
      kind: "stable",
    });
  }

  const solPrice = prices?.[SOL_MINT]?.usdPrice;
  if (solPrice && balances.sol > 0) {
    slices.push({
      name: "Solana",
      symbol: "SOL",
      usd: balances.sol * solPrice,
      amount: balances.sol,
      color: NATIVE_COLOR,
      kind: "native",
    });
  }

  let stockIdx = 0;
  for (const x of XSTOCKS) {
    const amt = balances.xstocks[x.mint] ?? 0;
    const px = prices?.[x.mint]?.usdPrice;
    if (amt > 0 && px) {
      slices.push({
        name: x.name,
        symbol: x.symbol,
        usd: amt * px,
        amount: amt,
        color: STOCK_PALETTE[stockIdx % STOCK_PALETTE.length],
        kind: "stock",
      });
      stockIdx += 1;
    }
  }

  return slices.sort((a, b) => b.usd - a.usd);
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
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Allocation
        </div>
        <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
          By asset
        </div>
      </div>

      {allocation.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-xs text-aeras-300">
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
                    <Cell key={a.symbol} fill={a.color} />
                  ))}
                </Pie>
                <Tooltip content={<AllocationTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[10px] uppercase tracking-[0.12em] text-aeras-300">
                Total
              </div>
              <div className="font-mono text-base tabular-nums text-aeras-900">
                {fmtUsd(totalUsd)}
              </div>
            </div>
          </div>

          <ul className="space-y-1.5">
            {allocation.map((a) => {
              const pct = total > 0 ? (a.usd / total) * 100 : 0;
              return (
                <li
                  key={a.symbol}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block size-2 rounded-full flex-shrink-0"
                      style={{ background: a.color }}
                    />
                    <span className="font-medium text-aeras-900 truncate">
                      {a.symbol}
                    </span>
                    <span className="text-aeras-300 truncate">{a.name}</span>
                  </span>
                  <span className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-aeras-900">${a.usd.toFixed(2)}</span>
                    <span className="text-aeras-300">{pct.toFixed(1)}%</span>
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
    <div className="rounded-md border border-aeras-border bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-aeras-900">
        {slice.symbol} <span className="text-aeras-300">· {slice.name}</span>
      </div>
      <div className="font-mono tabular-nums text-aeras-900">
        ${slice.usd.toFixed(2)} · {pct.toFixed(1)}%
      </div>
    </div>
  );
}

// ── Portfolio trendline ────────────────────────────────────────────────────

interface TrendPoint {
  t: number;
  v: number;
}

const TREND_RANGES = ["1W", "1M", "3M"] as const;
type TrendRange = (typeof TREND_RANGES)[number];

function PortfolioTrend({
  balances,
  prices,
}: {
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
}) {
  const [range, setRange] = useState<TrendRange>("1M");
  const [series, setSeries] = useState<TrendPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const heldXStocks = useMemo(() => {
    if (!balances) return [];
    return XSTOCKS.filter((x) => (balances.xstocks[x.mint] ?? 0) > 0);
  }, [balances]);

  // Flat baseline from stables + SOL at current price. We don't fetch SOL
  // history (out of curated chart proxy scope), so treat it as constant. Make
  // the title state that this is an indicative line for current holdings.
  const flatBaseline = useMemo(() => {
    if (!balances) return 0;
    const solUsd = (prices?.[SOL_MINT]?.usdPrice ?? 0) * balances.sol;
    return balances.usdc + solUsd;
  }, [balances, prices]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSeries(null);

    if (heldXStocks.length === 0) {
      setLoading(false);
      return;
    }

    Promise.all(
      heldXStocks.map((x) =>
        fetchChartViaProxy(x.mint, range).then(
          (candles) =>
            [x.mint, candles] as const,
        ),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        const combined = combineSeries(entries, balances, flatBaseline);
        setSeries(combined);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [heldXStocks, range, balances, flatBaseline]);

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
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            Portfolio value · indicative
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-2xl font-light tracking-tight text-aeras-900 tabular-nums">
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
          <div className="mt-1 text-[11px] text-aeras-300">
            Current holdings priced against the historical xStock curve.
          </div>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-aeras-border p-0.5">
          {TREND_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                r === range
                  ? "bg-aeras-900 text-white"
                  : "text-aeras-300 hover:text-aeras-900"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-48 w-full">
        {heldXStocks.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-aeras-300">
            Buy an xStock to see your portfolio trend.
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-aeras-500">
            {/rate limit/i.test(error)
              ? "Price history rate-limited"
              : "Price history unavailable"}
          </div>
        ) : loading || !series || series.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-aeras-300">
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

function combineSeries(
  entries: ReadonlyArray<readonly [string, OhlcCandle[]]>,
  balances: AccountBalances | null,
  flatBaseline: number,
): TrendPoint[] {
  if (entries.length === 0 || !balances) return [];

  // Pick the longest candle series as the time axis. Snap every other series
  // onto these timestamps via nearest-prior interpolation.
  const longest = entries.reduce((acc, e) =>
    e[1].length > acc[1].length ? e : acc,
  );
  const timestamps = longest[1].map((c) => c.t);

  const prices: Record<string, number[]> = {};
  for (const [mint, candles] of entries) {
    prices[mint] = snapToTimestamps(timestamps, candles);
  }

  return timestamps.map((t, i) => {
    let v = flatBaseline;
    for (const [mint] of entries) {
      const held = balances.xstocks[mint] ?? 0;
      const px = prices[mint][i];
      v += held * px;
    }
    return { t, v };
  });
}

function snapToTimestamps(
  timestamps: number[],
  candles: OhlcCandle[],
): number[] {
  if (candles.length === 0) return timestamps.map(() => 0);
  const out: number[] = new Array(timestamps.length);
  let j = 0;
  let last = candles[0].c;
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    while (j < candles.length && candles[j].t <= t) {
      last = candles[j].c;
      j++;
    }
    out[i] = last;
  }
  return out;
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
    <div className="rounded-md border border-aeras-border bg-white px-2 py-1.5 text-xs shadow-sm">
      <div className="font-mono tabular-nums text-aeras-900">
        ${p.v.toFixed(2)}
      </div>
      <div className="text-aeras-300">
        {new Date(p.t * 1000).toLocaleDateString()}
      </div>
    </div>
  );
}

// ── Health card ────────────────────────────────────────────────────────────

interface AggregatePosition {
  vault: XStockBorrowVault;
  position: UserPositionState;
  live: LiveVaultState | null;
  collateralUi: number;
  debtUi: number;
  collateralUsd: number;
  debtUsd: number;
  ltvPct: number;
  liquidationPct: number;
  healthFactor: number;
  liquidationPrice: number | null;
}

function useBorrowPositions(walletAddress: string): AggregatePosition[] {
  const [positions, setPositions] = useState<AggregatePosition[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const connection = getConnection();
        const results = await Promise.all(
          XSTOCK_BORROW_VAULTS.map(async (vault) => {
            const nftId = await findExistingNftId(
              walletAddress,
              vault,
              connection,
            );
            if (nftId == null) return null;
            const [position, live] = await Promise.all([
              fetchPositionState(vault, nftId, connection),
              fetchLiveVaultStateViaProxy(vault.vaultId).catch(() => null),
            ]);
            if (!position) return null;
            if (
              position.collateralAtomic.isZero() &&
              position.debtAtomic.isZero()
            )
              return null;

            const collateralUi = fromAtomicBN(
              position.collateralAtomic,
              vault.collateralDecimals,
            );
            const debtUi = fromAtomicBN(
              position.debtAtomic,
              vault.borrowDecimals,
            );
            const price = live?.oraclePriceUsd ?? 0;
            const collateralUsd = collateralUi * price;
            const debtUsd = debtUi; // USDC, $1
            const ltvPct =
              collateralUsd > 0 ? (debtUsd / collateralUsd) * 100 : 0;
            const liquidationPct = vault.liquidationThreshold / 10;
            const healthFactor =
              ltvPct > 0 ? liquidationPct / ltvPct : Infinity;
            const liquidationPrice =
              collateralUi > 0 && debtUi > 0
                ? debtUi / (collateralUi * (vault.liquidationThreshold / 1000))
                : null;

            return {
              vault,
              position,
              live,
              collateralUi,
              debtUi,
              collateralUsd,
              debtUsd,
              ltvPct,
              liquidationPct,
              healthFactor,
              liquidationPrice,
            } as AggregatePosition;
          }),
        );
        if (!cancelled) {
          setPositions(results.filter((r): r is AggregatePosition => r != null));
        }
      } catch (err) {
        console.error("[useBorrowPositions]", err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return positions;
}

function HealthCard({ positions }: { positions: AggregatePosition[] }) {
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
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Health factor
        </div>
        <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
          Across borrow positions
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center text-center">
          <span className="text-xs text-aeras-300">No open borrow positions</span>
          <span className="mt-1 text-[11px] text-aeras-300">
            Pledge an xStock to start tracking health here.
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
              <div className="font-mono text-3xl font-light tabular-nums text-aeras-900">
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
              <PositionHealthRow key={p.vault.vaultId} pos={p} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2">
      <div className="text-[11px] text-aeras-300">{label}</div>
      <div className="mt-0.5 font-mono tabular-nums text-sm text-aeras-900">
        {value}
      </div>
    </div>
  );
}

function PositionHealthRow({ pos }: { pos: AggregatePosition }) {
  const safe = pos.healthFactor >= 1.5;
  const caution = pos.healthFactor >= 1.1 && pos.healthFactor < 1.5;
  const color = safe ? "#119b62" : caution ? "#e8a13a" : "#d93232";
  const ratio = Math.min(pos.ltvPct / pos.liquidationPct, 1);
  return (
    <li className="flex items-center justify-between gap-3 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <span className="font-medium text-aeras-900">
            {pos.vault.collateralSymbol} → {pos.vault.borrowSymbol}
          </span>
          <span className="font-mono tabular-nums" style={{ color }}>
            {Number.isFinite(pos.healthFactor)
              ? `${pos.healthFactor.toFixed(2)}×`
              : "∞"}
          </span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-aeras-surface">
          <div
            className="h-full rounded-full"
            style={{ width: `${ratio * 100}%`, background: color }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-aeras-300">
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

function HoldingsTable({
  balances,
  prices,
  allocation,
}: {
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  allocation: AllocationSlice[];
}) {
  void balances;
  void prices;
  const total = allocation.reduce((s, a) => s + a.usd, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            Holdings
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
            Detail
          </div>
        </div>
        <span className="text-xs text-aeras-300">
          {allocation.length} asset{allocation.length === 1 ? "" : "s"}
        </span>
      </div>

      {allocation.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-aeras-300">
          No balances yet. Fund USDC or buy an xStock to populate this table.
        </div>
      ) : (
        <div className="divide-y divide-aeras-border">
          <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
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
                key={a.symbol}
                className="grid grid-cols-12 items-center gap-2 py-2.5 text-sm"
              >
                <div className="col-span-4 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-2 rounded-full flex-shrink-0"
                      style={{ background: a.color }}
                    />
                    <span className="font-medium tracking-tight text-aeras-900 truncate">
                      {a.symbol}
                    </span>
                  </div>
                  <div className="text-[11px] text-aeras-300 truncate">
                    {a.name}
                  </div>
                </div>
                <div className="col-span-3 text-right font-mono tabular-nums text-aeras-900">
                  {a.amount.toLocaleString(undefined, {
                    maximumFractionDigits: decimals,
                  })}
                </div>
                <div className="col-span-3 text-right font-mono tabular-nums text-aeras-900">
                  ${a.usd.toFixed(2)}
                </div>
                <div className="col-span-2 text-right font-mono tabular-nums text-aeras-300">
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
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            Activity
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
            On-chain transactions
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
        <p className="rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2 text-xs text-aeras-500">
          Activity unavailable. {error}
        </p>
      ) : rows == null ? (
        <div className="flex h-32 items-center justify-center text-xs text-aeras-300">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-xs text-aeras-300">
          No transactions yet.
        </div>
      ) : (
        <ul className="divide-y divide-aeras-border">
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
          <span className="font-mono text-xs text-aeras-500 truncate">
            {row.signature.slice(0, 8)}…{row.signature.slice(-8)}
          </span>
        </div>
        {row.memo && (
          <div className="mt-0.5 text-[11px] text-aeras-300 truncate">
            {row.memo}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-aeras-300 whitespace-nowrap">{when}</span>
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

