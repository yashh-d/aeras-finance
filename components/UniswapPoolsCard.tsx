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

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatUnits, parseUnits } from "viem";

import { AssetLogo, VenueMark } from "@/components/AssetLogo";
import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import type { EvmSigner, MorphoTxProgress } from "@/lib/morpho/deposit";
import { GLASS_SURFACE } from "@/lib/ui/surface";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import { BAND_BPS, MIN_DEPOSIT_USDC_ATOMIC } from "@/lib/uniswap/constants";
import type { UniswapPoolMetric, UniswapPositionView, WalletBalances } from "@/lib/uniswap/client";
import {
  depositFromSolana,
  gasFloorWei,
  maxDepositUsdcAtomic,
  planDeposit,
  type DepositPlan,
} from "@/lib/uniswap/fund";
import { bandTicks, getSqrtRatioAtTick, priceToken1PerToken0 } from "@/lib/uniswap/math";
import {
  POOL_GROUP_LABELS,
  UNISWAP_CHAINS,
  UNISWAP_POOLS,
  baseToken,
  isDepositable,
  quoteToken,
  type PoolGroup,
  type PoolToken,
  type UniswapPool,
} from "@/lib/uniswap/pools";
import { useUniswapEarn, type UniswapEarn } from "@/lib/uniswap/use-uniswap";
import { claimFees, moveTokenToSolana, reopenPosition, withdrawPosition } from "@/lib/uniswap/withdraw";

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
  const signer: EvmSigner | null = earn.evm.address
    ? { address: earn.evm.address, switchChain: earn.evm.switchChain, getProvider: earn.evm.getProvider }
    : null;
  const prices = earn.positions?.prices ?? earn.pools?.prices ?? {};
  const balances = earn.positions?.balances[pool.chainId] ?? null;
  const gasPriceWei = earn.pools?.gasPriceWei?.[pool.chainId];

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
            <PositionBlock key={p.key} pool={pool} position={p}>
              {signer && (
                <PositionActions pool={pool} position={p} signer={signer} prices={prices} onSettled={onSettled} />
              )}
            </PositionBlock>
          ))}
        </div>
      )}

      {!isDepositable(pool) && (
        <p className="text-[11px] text-white/50">
          No route delivers {pool.token0.source === "none" ? pool.token0.symbol : pool.token1.symbol} to {chain.label} today, so deposits into this pool are not offered. Positions here can still be claimed and withdrawn.
        </p>
      )}

      {!signer || !earn.solanaSigner ? (
        <p className="text-[11px] text-white/50">Waiting for the embedded wallets.</p>
      ) : (
        <>
          {isDepositable(pool) && (
            <DepositForm
              pool={pool}
              signer={signer}
              solana={earn.solanaSigner}
              solanaUsdcAtomic={solanaUsdcAtomic}
              balances={balances}
              prices={prices}
              gasPriceWei={gasPriceWei}
              onSettled={onSettled}
            />
          )}
          <MoveHome pool={pool} signer={signer} solanaAddress={earn.solanaSigner.address} balances={balances} prices={prices} onSettled={onSettled} />
        </>
      )}
    </div>
  );
}

// ── shared form state ───────────────────────────────────────────────────────

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string; txHash?: string }
  | { kind: "done"; message: string; txHash?: string }
  | { kind: "error"; message: string };

const INPUT_CLASS =
  "block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-20 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft";
const BUTTON_CLASS =
  "rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_BUTTON_CLASS =
  "rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/80 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

function readableError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/user rejected|denied|cancelled/i.test(msg)) return "The signature was declined. Nothing moved.";
  return msg.length > 240 ? `${msg.slice(0, 240)}…` : msg;
}

function StateLine({ state, chainId }: { state: FormState; chainId: UniswapPool["chainId"] }) {
  const chain = UNISWAP_CHAINS[chainId];
  if (state.kind === "idle") return null;
  const tone = state.kind === "error" ? "text-aeras-negative" : state.kind === "done" ? "text-aeras-positive" : "text-white/60";
  const txHash = "txHash" in state ? state.txHash : undefined;
  return (
    <p className={`text-[11px] ${tone}`}>
      {state.message}
      {txHash && (
        <>
          {" "}
          <a href={`${chain.explorerTxBase}${txHash}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            View transaction
          </a>
        </>
      )}
    </p>
  );
}

function progressToState(p: MorphoTxProgress): FormState {
  return p.stage === "done" ? { kind: "done", message: p.message, txHash: p.txHash } : { kind: "busy", message: p.message, txHash: p.txHash };
}

// ── deposit ─────────────────────────────────────────────────────────────────

function DepositForm({
  pool,
  signer,
  solana,
  solanaUsdcAtomic,
  balances,
  prices,
  gasPriceWei,
  onSettled,
}: {
  pool: UniswapPool;
  signer: EvmSigner;
  solana: { address: string; signAndSendBase64: (tx: string) => Promise<string> };
  solanaUsdcAtomic: string;
  balances: WalletBalances | null;
  prices: Record<string, number>;
  gasPriceWei: string | undefined;
  onSettled: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [plan, setPlan] = useState<DepositPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const chain = UNISWAP_CHAINS[pool.chainId];
  const maxAtomic = BigInt(maxDepositUsdcAtomic(solanaUsdcAtomic));
  const amountAtomic = useMemo(() => {
    try {
      return input ? parseUnits(input, USDC_DECIMALS) : 0n;
    } catch {
      return 0n;
    }
  }, [input]);
  const busy = state.kind === "busy";

  // Price the legs as the amount settles, so the fees and the gas top-up
  // are on screen before the button is pressed.
  useEffect(() => {
    if (amountAtomic < MIN_DEPOSIT_USDC_ATOMIC || busy) {
      const clear = setTimeout(() => setPlan(null), 0);
      return () => clearTimeout(clear);
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      setPlanning(true);
      try {
        const p = await planDeposit({
          pool,
          usdcAtomic: amountAtomic,
          balances,
          prices,
          solanaUsdcAtomic,
          solanaAddress: solana.address,
          evmAddress: signer.address,
          gasPriceWei,
        });
        if (!cancelled) setPlan(p);
      } catch (err) {
        if (!cancelled) setPlan({ kind: "blocked", reason: readableError(err) });
      } finally {
        if (!cancelled) setPlanning(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [amountAtomic, pool, balances, prices, solanaUsdcAtomic, solana.address, signer.address, gasPriceWei, busy]);

  async function submit() {
    setState({ kind: "busy", message: "Starting." });
    try {
      const result = await depositFromSolana({
        pool,
        usdcAtomic: amountAtomic,
        solanaUsdcAtomic,
        prices,
        gasPriceWei,
        signer,
        solana,
        onProgress: (p) => setState(progressToState(p)),
      });
      setState({ kind: "done", message: `Position opened in ${pool.label}.`, txHash: result.txHash });
      setInput("");
      await onSettled();
    } catch (err) {
      console.error("[uniswap deposit]", err);
      setState({ kind: "error", message: readableError(err) });
    }
  }

  const disabled = busy || planning || amountAtomic < MIN_DEPOSIT_USDC_ATOMIC || amountAtomic > maxAtomic || plan?.kind !== "ok";

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Deposit into {pool.label}
          </label>
          <span className="font-mono text-[11px] text-white/50">
            {fmtAmount(solanaUsdcAtomic, USDC_DECIMALS, 2)} USDC on Solana
            <button
              type="button"
              onClick={() => {
                setInput(formatUnits(maxAtomic, USDC_DECIMALS));
                if (state.kind !== "idle" && state.kind !== "busy") setState({ kind: "idle" });
              }}
              className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
            >
              Max
            </button>
          </span>
        </div>
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={input}
            disabled={busy}
            onChange={(e) => {
              setInput(e.target.value);
              if (state.kind !== "idle" && state.kind !== "busy") setState({ kind: "idle" });
            }}
            className={INPUT_CLASS}
            style={{ "--range-progress": 0 } as CSSProperties}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
            USDC
          </span>
        </div>
      </div>

      {plan?.kind === "ok" && (
        <div className="space-y-1 text-[11px] text-white/60">
          {plan.legs.map((l, i) => (
            <div key={i} className="flex justify-between">
              <span>
                {fmtAmount(l.leg.sourceAmountAtomic, USDC_DECIMALS, 2)} USDC → {l.token ? l.token.symbol : `${chain.nativeSymbol} for gas`} on {chain.label}
              </span>
              <span className="font-mono tabular-nums">
                {l.token ? `≥ ${fmtAmount(l.leg.toAmountMinAtomic, l.token.decimals, l.token.decimals > 8 ? 5 : 6)} ${l.token.symbol}` : "one-time"}
              </span>
            </div>
          ))}
          {plan.swap && (
            <div className="flex justify-between">
              <span>Then swap half the {plan.swap.from.symbol} for {plan.swap.to.symbol} on {chain.label}</span>
            </div>
          )}
          {(plan.counted[0] > 0n || plan.counted[1] > 0n) && (
            <div>
              Uses {plan.counted[0] > 0n ? `${fmtAmount(plan.counted[0], pool.token0.decimals)} ${pool.token0.symbol}` : ""}
              {plan.counted[0] > 0n && plan.counted[1] > 0n ? " and " : ""}
              {plan.counted[1] > 0n ? `${fmtAmount(plan.counted[1], pool.token1.decimals)} ${pool.token1.symbol}` : ""} already in the wallet.
            </div>
          )}
          <div className="flex justify-between">
            <span>Bridge fees</span>
            <span className="font-mono tabular-nums">{plan.totalFeesUsd == null ? "—" : fmtUsd(plan.totalFeesUsd, 3)}</span>
          </div>
          <div>Range ±{(pool.bandBps ?? BAND_BPS) / 100}% around the price at the mint; keeps {UNISWAP_CHAINS[pool.chainId].nativeSymbol} back for gas.</div>
          {plan.warn && <div className="text-aeras-warning">{plan.warn}</div>}
        </div>
      )}
      {plan?.kind === "blocked" && <p className="text-[11px] text-aeras-warning">{plan.reason}</p>}
      {planning && <p className="text-[11px] text-white/40">Pricing the legs.</p>}

      <button type="button" onClick={submit} disabled={disabled} className={`${BUTTON_CLASS} w-full`}>
        {busy ? state.message : "Deposit"}
      </button>
      <StateLine state={state} chainId={pool.chainId} />
    </div>
  );
}

// ── position actions ────────────────────────────────────────────────────────

function PositionActions({
  pool,
  position,
  signer,
  prices,
  onSettled,
}: {
  pool: UniswapPool;
  position: UniswapPositionView;
  signer: EvmSigner;
  prices: Record<string, number>;
  onSettled: () => Promise<void>;
}) {
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const busy = state.kind === "busy";
  const canClaim = position.feesUsd != null ? position.feesUsd >= 0.01 : BigInt(position.fees0) > 0n || BigInt(position.fees1) > 0n;

  async function run(work: () => Promise<unknown>, doneMessage: string) {
    setState({ kind: "busy", message: "Starting." });
    try {
      const result = await work();
      const txHash = typeof result === "string" ? result : (result as { txHash?: string })?.txHash;
      setState({ kind: "done", message: doneMessage, txHash });
      await onSettled();
    } catch (err) {
      console.error("[uniswap position action]", err);
      setState({ kind: "error", message: readableError(err) });
    }
  }
  const report = (p: MorphoTxProgress) => setState(progressToState(p));

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canClaim}
          className={SMALL_BUTTON_CLASS}
          onClick={() => run(() => claimFees({ pool, position, signer, onProgress: report }), "Fees claimed into your wallet.")}
        >
          Claim fees
        </button>
        <button
          type="button"
          disabled={busy}
          className={SMALL_BUTTON_CLASS}
          onClick={() => run(() => withdrawPosition({ pool, position, signer, onProgress: report }), "Withdrawn into your wallet. Move to Solana below.")}
        >
          Withdraw
        </button>
        {!position.inRange && (
          <button
            type="button"
            disabled={busy}
            className={SMALL_BUTTON_CLASS}
            onClick={() => run(() => reopenPosition({ pool, position, signer, prices, onProgress: report }), "Reopened around the current price.")}
          >
            Reopen around the current price
          </button>
        )}
      </div>
      <StateLine state={state} chainId={pool.chainId} />
    </div>
  );
}

// ── the way home ────────────────────────────────────────────────────────────

function MoveHome({
  pool,
  signer,
  solanaAddress,
  balances,
  prices,
  onSettled,
}: {
  pool: UniswapPool;
  signer: EvmSigner;
  solanaAddress: string;
  balances: WalletBalances | null;
  prices: Record<string, number>;
  onSettled: () => Promise<void>;
}) {
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const chain = UNISWAP_CHAINS[pool.chainId];
  const tokens: PoolToken[] = [pool.token0, pool.token1];
  if (!tokens.some((t) => t.address.toLowerCase() === chain.dollar.address.toLowerCase())) tokens.push(chain.dollar);
  const rows = tokens
    .map((t) => {
      const native = Boolean(t.native) || t.address.toLowerCase() === "0x0000000000000000000000000000000000000000";
      let atomic = BigInt((native ? balances?.native : balances?.[t.address.toLowerCase()]) ?? "0");
      if (native) atomic = atomic > gasFloorWei(pool.chainId) ? atomic - gasFloorWei(pool.chainId) : 0n;
      const usd = (Number(formatUnits(atomic, t.decimals)) || 0) * (prices[`${pool.chainId}:${t.address.toLowerCase()}`] ?? 0);
      return { t, atomic, usd };
    })
    .filter((r) => r.atomic > 0n && r.usd >= 0.5);
  if (rows.length === 0) return null;
  const busy = state.kind === "busy";

  async function move(t: PoolToken, atomic: bigint) {
    setState({ kind: "busy", message: `Moving ${t.symbol} to Solana.` });
    try {
      await moveTokenToSolana({
        chainId: pool.chainId,
        token: t,
        amountAtomic: atomic,
        balances,
        evm: signer,
        solanaAddress,
        onProgress: (p) => setState(progressToState(p)),
      });
      setState({ kind: "done", message: `${t.symbol} arrived on Solana as USDC.` });
      await onSettled();
    } catch (err) {
      console.error("[uniswap move home]", err);
      setState({ kind: "error", message: readableError(err) });
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">In your {chain.label} wallet</div>
      {rows.map(({ t, atomic, usd }) => (
        <div key={t.address} className="flex items-center justify-between gap-2 text-[11px] text-white/70">
          <span>
            {fmtAmount(atomic, t.decimals, t.decimals > 8 ? 5 : 6)} {t.symbol} ({fmtUsd(usd)})
          </span>
          <button type="button" disabled={busy} className={SMALL_BUTTON_CLASS} onClick={() => move(t, atomic)}>
            Move to Solana
          </button>
        </div>
      ))}
      <StateLine state={state} chainId={pool.chainId} />
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

export function PositionBlock({
  pool,
  position,
  children,
}: {
  pool: UniswapPool;
  position: UniswapPositionView;
  children?: React.ReactNode;
}) {
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
      {children}
    </div>
  );
}
