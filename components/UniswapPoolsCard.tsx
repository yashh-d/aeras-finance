"use client";

// Uniswap liquidity pools as a card in the Earn tab, under the Vaults table.
//
// A card rather than a column: an LP position holds both tokens of a pair,
// its value moves with both, it suffers impermanent loss against holding
// them, and its rate is a trailing fee rate that changes daily, none of which
// fits a USDC-keyed row. Twelve pools on four chains (lib/uniswap/pools.ts),
// grouped by chain, each row the pool's fee tier, TVL, 24h volume, 7-day fee
// APR and the user's position; an expanded row shows the price, the band a
// new position takes, every open position with its range state and fees,
// and the deposit form. It reads through lib/uniswap/use-uniswap.ts, funds a
// deposit from the wallet's Solana USDC through Trustware, and signs on the
// pool's chain with the embedded EVM wallet. See docs/uniswap-lp-plan.md.

import { useState } from "react";
import { formatUnits } from "viem";

import { AssetLogo, VenueMark } from "@/components/AssetLogo";
import { GLASS_SURFACE } from "@/lib/ui/surface";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import { BAND_BPS } from "@/lib/uniswap/constants";
import type { UniswapPoolMetric, UniswapPositionView } from "@/lib/uniswap/client";
import { bandTicks, getSqrtRatioAtTick, priceToken1PerToken0 } from "@/lib/uniswap/math";
import {
  POOL_GROUP_LABELS,
  UNISWAP_CHAINS,
  UNISWAP_POOLS,
  baseToken,
  isDepositable,
  quoteToken,
  type PoolGroup,
  type UniswapPool,
} from "@/lib/uniswap/pools";
import { useUniswapEarn, type UniswapEarn } from "@/lib/uniswap/use-uniswap";

const GROUP_ORDER: PoolGroup[] = ["stocks", "monad", "ethereum", "base"];

// ── formatting ──────────────────────────────────────────────────────────────

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export function fmtLargeUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
export function fmtPct(decimal: number | null | undefined, digits = 1): string {
  return decimal == null || !Number.isFinite(decimal) ? "—" : `${(decimal * 100).toFixed(digits)}%`;
}
export function fmtAmount(atomic: string | bigint, decimals: number, digits = 4): string {
  const n = Number(formatUnits(BigInt(atomic), decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
export function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(4);
}
function feeTierLabel(fee: number): string {
  return `${(fee / 10_000).toFixed(2).replace(/0$/, "")}%`;
}

// The band a new position would take, in dollars per the non-dollar side.
export function bandPrices(pool: UniswapPool, tick: number): { lower: number; upper: number; tickLower: number; tickUpper: number } | null {
  const { tickLower, tickUpper } = bandTicks(tick, pool.bandBps ?? BAND_BPS, pool.tickSpacing);
  const p = (t: number) => priceToken1PerToken0(getSqrtRatioAtTick(t), pool.token0.decimals, pool.token1.decimals);
  if (pool.quoteSide === 0) return { lower: 1 / p(tickUpper), upper: 1 / p(tickLower), tickLower, tickUpper };
  if (pool.quoteSide === 1) return { lower: p(tickLower), upper: p(tickUpper), tickLower, tickUpper };
  return { lower: p(tickLower), upper: p(tickUpper), tickLower, tickUpper };
}

const GRID =
  "grid grid-cols-[minmax(0,2.6fr)_repeat(4,minmax(0,1.3fr))_1.25rem] items-center gap-2";

// ── the card ────────────────────────────────────────────────────────────────

export function UniswapPoolsCard({
  walletAddress,
  solanaUsdcAtomic,
  onRefresh,
  className,
}: {
  walletAddress: string | undefined;
  // Solana USDC available to deposit from, 6-decimal atomic.
  solanaUsdcAtomic: string;
  onRefresh: () => Promise<void> | void;
  className?: string;
}) {
  const earn = useUniswapEarn(walletAddress);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const metricsById = new Map((earn.pools?.pools ?? []).map((m) => [`${m.chainId}:${m.id.toLowerCase()}`, m]));
  const positions = earn.positions?.positions ?? [];
  const totalUsd = positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0);
  const feesUsd = positions.reduce((s, p) => s + (p.feesUsd ?? 0), 0);

  return (
    <div className={`${GLASS_SURFACE} p-5 lg:p-6 ${className ?? ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            <VenueMark src={VENUE_LOGOS.uniswap} />
            Liquidity pools
            <span className="text-white/30">·</span>
            Uniswap
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-white">
            Provide both sides of a pair, earn its trading fees
          </div>
          <div className="text-[11px] text-white/50">
            Tokenized stocks on Robinhood Chain, the deepest pools on Monad, and USDC/WETH on Ethereum and Base.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">Your positions</div>
          <div className="font-mono text-2xl font-light tabular-nums text-white">
            {positions.length > 0 ? fmtUsd(totalUsd, 0) : "—"}
          </div>
          <div className="text-[10px] text-white/40">
            {positions.length > 0
              ? `${positions.length} position${positions.length === 1 ? "" : "s"} · ${fmtUsd(feesUsd)} fees to claim`
              : earn.positionsError
                ? "positions unavailable"
                : walletAddress
                  ? "none open"
                  : "waiting for wallet"}
          </div>
        </div>
      </div>

      <div className="mt-5 divide-y divide-white/10">
        <div className={`${GRID} pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50`}>
          <div>Pool</div>
          <div className="text-right">TVL</div>
          <div className="text-right">24h volume</div>
          <div className="text-right">7d fee APR</div>
          <div className="text-right">Your position</div>
          <div />
        </div>
        {GROUP_ORDER.map((group) => {
          const pools = UNISWAP_POOLS.filter((p) => p.group === group);
          if (pools.length === 0) return null;
          const chain = UNISWAP_CHAINS[pools[0].chainId];
          return (
            <div key={group}>
              <div className="flex items-center gap-1.5 pt-3 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
                <VenueMark src={chain.logo} />
                {POOL_GROUP_LABELS[group]}
              </div>
              {pools.map((pool) => {
                const key = `${pool.chainId}:${pool.id.toLowerCase()}`;
                return (
                  <PoolRow
                    key={key}
                    pool={pool}
                    metric={metricsById.get(key)}
                    positions={positions.filter((p) => p.chainId === pool.chainId && p.poolId.toLowerCase() === pool.id.toLowerCase())}
                    earn={earn}
                    solanaUsdcAtomic={solanaUsdcAtomic}
                    open={openKey === key}
                    onToggle={() => setOpenKey((cur) => (cur === key ? null : key))}
                    onSettled={async () => {
                      await earn.refresh();
                      await onRefresh();
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] text-white/50">
        A liquidity position holds both tokens of the pair and earns the pool&apos;s trading fees
        while the price stays inside its range. Its value moves with both tokens and can be less
        than holding them (impermanent loss). Outside the range it holds one token and earns
        nothing until it is reopened. The rate shown is the pool&apos;s fees over the last seven
        days, annualised, not a guaranteed return. Robinhood Chain stock tokens are Robinhood&apos;s
        tokenized representations and carry no shareholder rights.
      </p>
    </div>
  );
}

// ── a row ───────────────────────────────────────────────────────────────────

function PoolRow({
  pool,
  metric,
  positions,
  earn,
  solanaUsdcAtomic,
  open,
  onToggle,
  onSettled,
}: {
  pool: UniswapPool;
  metric: UniswapPoolMetric | undefined;
  positions: UniswapPositionView[];
  earn: UniswapEarn;
  solanaUsdcAtomic: string;
  open: boolean;
  onToggle: () => void;
  onSettled: () => Promise<void>;
}) {
  const valueUsd = positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0);
  const anyOut = positions.some((p) => !p.inRange);
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `Close ${pool.label}` : `Open ${pool.label}`}
        className={`group w-full ${GRID} py-2.5 text-left text-sm transition-colors ${open ? "bg-white/[0.03]" : "hover:bg-white/5"}`}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-2">
            <AssetLogo xstock={pool.token0} size={28} />
            <AssetLogo xstock={pool.token1} size={28} />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium tracking-tight text-white">{pool.label}</div>
            <div className="truncate text-[11px] text-white/50">
              {pool.protocol.toLowerCase()} · {feeTierLabel(pool.fee)} fee
            </div>
          </div>
        </div>
        <div className="text-right font-mono text-xs tabular-nums text-white/70">{fmtLargeUsd(metric?.tvlUsd)}</div>
        <div className="text-right font-mono text-xs tabular-nums text-white/70">{fmtLargeUsd(metric?.volume24hUsd)}</div>
        <div className="text-right">
          <span className={`font-mono tabular-nums ${metric?.feeApr7d == null ? "text-white/30" : "text-aeras-positive"}`}>
            {fmtPct(metric?.feeApr7d)}
          </span>
          <div className="font-mono text-[10px] tabular-nums text-white/40">{metric?.feeApr24h == null ? "" : `${fmtPct(metric.feeApr24h)} over 24h`}</div>
        </div>
        <div className="text-right font-mono text-xs tabular-nums text-white">
          {positions.length > 0 ? (
            <>
              {fmtUsd(valueUsd, 0)}
              <div className={`text-[10px] ${anyOut ? "text-aeras-warning" : "text-white/50"}`}>
                {anyOut ? "out of range" : positions.length === 1 ? "in range" : `${positions.length} positions`}
              </div>
            </>
          ) : (
            <span className="text-white/40">—</span>
          )}
        </div>
        <div className="flex justify-end">
          <svg viewBox="0 0 16 16" className={`size-4 text-white/40 transition-transform group-hover:text-white/70 ${open ? "rotate-180" : ""}`} aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>
      {open && (
        <PoolDetail pool={pool} metric={metric} positions={positions} earn={earn} solanaUsdcAtomic={solanaUsdcAtomic} onSettled={onSettled} />
      )}
    </div>
  );
}

// ── the expanded row ────────────────────────────────────────────────────────

function PoolDetail({
  pool,
  metric,
  positions,
  earn,
  solanaUsdcAtomic,
  onSettled,
}: {
  pool: UniswapPool;
  metric: UniswapPoolMetric | undefined;
  positions: UniswapPositionView[];
  earn: UniswapEarn;
  solanaUsdcAtomic: string;
  onSettled: () => Promise<void>;
}) {
  const chain = UNISWAP_CHAINS[pool.chainId];
  const base = baseToken(pool);
  const quote = quoteToken(pool);
  const band = metric?.tick != null ? bandPrices(pool, metric.tick) : null;
  const priceLine =
    base && quote && metric?.baseUsd != null
      ? `1 ${base.symbol} = ${fmtPrice(metric.baseUsd)} ${quote.symbol}`
      : metric?.price != null
        ? `1 ${pool.token0.symbol} = ${fmtPrice(metric.price)} ${pool.token1.symbol}`
        : "price unavailable";
  const bandLine = band
    ? base && quote
      ? `${fmtPrice(band.lower)} to ${fmtPrice(band.upper)} ${quote.symbol}`
      : `${fmtPrice(band.lower)} to ${fmtPrice(band.upper)} ${pool.token1.symbol} per ${pool.token0.symbol}`
    : "—";
  void earn;
  void solanaUsdcAtomic;
  void onSettled;

  return (
    <div className="space-y-4 pb-4 pt-1">
      <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <Stat label="Price" value={priceLine} />
        <Stat label={`New position range (±${(pool.bandBps ?? BAND_BPS) / 100}%)`} value={bandLine} hint={band ? `ticks ${band.tickLower} to ${band.tickUpper}` : undefined} />
        <Stat label="7d volume" value={fmtLargeUsd(metric?.volume7dUsd)} hint={metric?.source === "geckoterminal" ? "TVL and 24h volume from GeckoTerminal" : undefined} />
        <Stat
          label="Chain"
          value={chain.label}
          hint={
            <a href={pool.explorerUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              View on Uniswap
            </a>
          }
        />
      </div>

      {positions.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">Your positions</div>
          {positions.map((p) => (
            <PositionBlock key={p.key} pool={pool} position={p} />
          ))}
        </div>
      )}

      {!isDepositable(pool) && (
        <p className="text-[11px] text-white/50">
          No route delivers {pool.token0.source === "none" ? pool.token0.symbol : pool.token1.symbol} to {chain.label} today, so deposits into this pool are not offered. Positions here can still be claimed and withdrawn.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-white">{value}</div>
      {hint && <div className="text-[10px] text-white/40">{hint}</div>}
    </div>
  );
}

export function PositionBlock({ pool, position }: { pool: UniswapPool; position: UniswapPositionView }) {
  const chain = UNISWAP_CHAINS[pool.chainId];
  const base = baseToken(pool);
  const quote = quoteToken(pool);
  const lower = priceToken1PerToken0(getSqrtRatioAtTick(position.tickLower), pool.token0.decimals, pool.token1.decimals);
  const upper = priceToken1PerToken0(getSqrtRatioAtTick(position.tickUpper), pool.token0.decimals, pool.token1.decimals);
  const range =
    pool.quoteSide === 0
      ? `${fmtPrice(1 / upper)} to ${fmtPrice(1 / lower)} ${quote?.symbol}`
      : pool.quoteSide === 1
        ? `${fmtPrice(lower)} to ${fmtPrice(upper)} ${quote?.symbol}`
        : `${fmtPrice(lower)} to ${fmtPrice(upper)} ${pool.token1.symbol} per ${pool.token0.symbol}`;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-lg tabular-nums text-white">{fmtUsd(position.valueUsd)}</div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            position.inRange ? "bg-aeras-positive/15 text-aeras-positive" : "bg-aeras-warning/15 text-aeras-warning"
          }`}
        >
          {position.inRange ? "In range" : "Out of range"}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] text-white/60 md:grid-cols-2">
        <div>
          {fmtAmount(position.amount0, pool.token0.decimals)} {pool.token0.symbol} + {fmtAmount(position.amount1, pool.token1.decimals)} {pool.token1.symbol}
        </div>
        <div>Range {range}{base ? ` per ${base.symbol}` : ""}</div>
        <div>
          Fees to claim: {fmtAmount(position.fees0, pool.token0.decimals)} {pool.token0.symbol} + {fmtAmount(position.fees1, pool.token1.decimals)} {pool.token1.symbol}
          {position.feesUsd != null ? ` (${fmtUsd(position.feesUsd)})` : ""}
        </div>
        <div>
          {position.protocol.toLowerCase()} position #{position.tokenId} on {chain.label}
          {position.txHash && (
            <>
              {" · "}
              <a href={`${chain.explorerTxBase}${position.txHash}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                mint
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
