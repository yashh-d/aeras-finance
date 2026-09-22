"use client";

// shMON staking on Monad as a card in the Earn tab, under the Vaults table.
//
// A card rather than a column: the Vaults table is keyed by Solana earn
// assets and every cell is a stablecoin or SOL vault, while this position is
// denominated in MON, has two exit paths with different costs and waits, and
// carries MON price exposure. It reads its own live data through
// lib/shmonad/use-shmonad.ts, stakes from the wallet's Solana USDC through
// Trustware (lib/shmonad/fund.ts), signs the exits with the embedded EVM
// wallet (lib/shmonad/stake.ts), and offers the way home
// (lib/shmonad/unwind.ts). See docs/shmonad-plan.md.
//
// Three surfaces inside, each its own component so the state of one cannot
// leak into another: the Stake form, the Withdraw panel (instant and queued,
// the queued one a small state machine in the shape of the Aave Umbrella
// cooldown), and the Move to Solana form that appears whenever the Monad
// wallet holds MON beyond its gas reserve.

import { useEffect, useState, type CSSProperties } from "react";
import { formatUnits, parseUnits } from "viem";

import { AssetLogo, VenueMark } from "@/components/AssetLogo";
import type { MorphoTxProgress } from "@/lib/morpho/deposit";
import { MONAD_EXPLORER_TX_BASE } from "@/lib/morpho/constants";
import { GAS_FLOOR_WEI } from "@/lib/morpho/fund";
import {
  EPOCH_HOURS_APPROX,
  INSTANT_EXIT_TOLERANCE_BPS,
  MIN_STAKE_USDC_ATOMIC,
  SHMON_SYMBOL,
  STAKE_FEE_WARN_USDC_ATOMIC,
  UNSTAKE_WAIT_COPY,
} from "@/lib/shmonad/constants";
import {
  maxStakeUsdcAtomic,
  planStake,
  stakeFromSolana,
  type StakePlan,
} from "@/lib/shmonad/fund";
import {
  instantCapacityShares,
  unstakePhase,
  withTolerance,
} from "@/lib/shmonad/math";
import { completeUnstake, redeemInstant, requestUnstake } from "@/lib/shmonad/stake";
import {
  maxReturnableMonAtomic,
  quoteMonToSolana,
  sendMonToSolana,
} from "@/lib/shmonad/unwind";
import { useShmonEarn, type ShmonEarn } from "@/lib/shmonad/use-shmonad";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import { GLASS_SURFACE } from "@/lib/ui/surface";

const USDC_DECIMALS = 6;
const SHMON_LOGO = { symbol: SHMON_SYMBOL, name: "shMON", logo: "/logos/shmonad.png" };

// ── formatting ──────────────────────────────────────────────────────────────

function fmtUnits(atomic: string | bigint, decimals: number, digits: number): string {
  const n = Number(formatUnits(BigInt(atomic), decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function fmtMon(atomic: string | bigint, digits = 2): string {
  return `${fmtUnits(atomic, 18, digits)} MON`;
}
function fmtShares(atomic: string | bigint, digits = 2): string {
  return `${fmtUnits(atomic, 18, digits)} ${SHMON_SYMBOL}`;
}
function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function fmtPct(decimal: number | null | undefined, digits = 2): string {
  return decimal == null ? "—" : `${(decimal * 100).toFixed(digits)}%`;
}
function monUsdValue(atomic: string | bigint, monUsd: number | null): number | null {
  if (monUsd == null) return null;
  return Number(formatUnits(BigInt(atomic), 18)) * monUsd;
}
function parseAtomic(input: string, decimals: number): bigint {
  try {
    return input ? parseUnits(input, decimals) : 0n;
  } catch {
    return 0n;
  }
}

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; message: string; txHash?: string }
  | { kind: "error"; message: string };

const INPUT_CLASS =
  "block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-20 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft";
const BUTTON_CLASS =
  "w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50";

// ── the card ────────────────────────────────────────────────────────────────

export function ShMonadCard({
  walletAddress,
  solanaUsdcAtomic,
  onRefresh,
  className,
}: {
  walletAddress: string | undefined;
  // Solana USDC available to stake from, 6-decimal atomic.
  solanaUsdcAtomic: string;
  onRefresh: () => Promise<void> | void;
  className?: string;
}) {
  const earn = useShmonEarn(walletAddress);
  const { metrics, position, monUsd } = earn;
  const [mode, setMode] = useState<"stake" | "withdraw">("stake");

  const shares = BigInt(position?.sharesAtomic ?? "0");
  const pending = position?.pending;
  const hasPosition = shares > 0n || Boolean(pending);
  const walletMon = BigInt(position?.walletMonAtomic ?? "0");
  const returnable = maxReturnableMonAtomic(position?.walletMonAtomic ?? "0");

  const settled = async () => {
    await earn.refresh();
    await onRefresh();
  };

  const tvlUsd = metrics && monUsd != null ? metrics.tvlMon * monUsd : null;

  return (
    <div className={`${GLASS_SURFACE} p-5 lg:p-6 ${className ?? ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            <VenueMark src={VENUE_LOGOS.shmonad} />
            Staking
            <span className="text-white/30">·</span>
            <VenueMark src={VENUE_LOGOS.monad} />
            Monad
          </div>
          <div className="mt-1 flex items-center gap-2.5">
            <AssetLogo xstock={SHMON_LOGO} size={32} />
            <div>
              <div className="text-sm font-medium tracking-tight text-white">shMON staking</div>
              <div className="text-[11px] text-white/50">
                Stake MON, hold shMON. Rewards compound into the rate every epoch.
              </div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">APY</div>
          <div className="font-mono text-2xl font-light tabular-nums text-aeras-positive">
            {fmtPct(metrics?.apy)}
          </div>
          <div className="text-[10px] text-white/40">
            {metrics?.windowHours != null
              ? `from the rate's last ${Math.round(metrics.windowHours / 24)} days`
              : earn.loading
                ? "reading"
                : "unavailable"}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <Stat
          label="Rate"
          value={metrics ? `1 ${SHMON_SYMBOL} = ${metrics.rateMonPerShare.toFixed(4)} MON` : "—"}
        />
        <Stat
          label="Staked"
          value={
            metrics
              ? tvlUsd != null
                ? fmtUsd(tvlUsd, 0)
                : `${Math.round(metrics.tvlMon).toLocaleString()} MON`
              : "—"
          }
        />
        <Stat
          label="Instant exit fee"
          value={metrics ? `${fmtPct(metrics.feeRate)} now` : "—"}
          hint={metrics ? `${Math.round(metrics.utilization * 100)}% of the pool drawn` : undefined}
        />
        <Stat
          label="Instant capacity"
          value={metrics ? `${Math.round(metrics.poolAvailableMon).toLocaleString()} MON` : "—"}
          hint="queued exits are unlimited"
        />
      </div>

      {position && hasPosition && (
        <PositionBlock position={position} monUsd={monUsd} />
      )}

      {!walletAddress ? (
        <p className="mt-4 text-xs text-white/50">Waiting for the embedded wallet.</p>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ModeButton label="Stake" active={mode === "stake"} onClick={() => setMode("stake")} />
            <ModeButton
              label="Withdraw"
              active={mode === "withdraw"}
              disabled={!hasPosition}
              onClick={() => setMode("withdraw")}
            />
          </div>
          {mode === "stake" ? (
            <StakeForm earn={earn} solanaUsdcAtomic={solanaUsdcAtomic} onSettled={settled} />
          ) : (
            <WithdrawPanel earn={earn} onSettled={settled} />
          )}
          {walletAddress && returnable > 0n && (
            <ReturnForm earn={earn} solanaAddress={walletAddress} onSettled={settled} />
          )}
          {walletAddress && returnable === 0n && walletMon > 0n && (
            <p className="text-[11px] text-white/40">
              {fmtMon(walletMon, 4)} in the Monad wallet is the gas reserve and stays.
            </p>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px] text-white/50">
        shMON is FastLane&apos;s liquid staking token on Monad. Its value follows the price
        of MON. Staking rewards and MEV revenue compound into the exchange rate, and
        FastLane keeps {fmtPct(metrics?.stakingCommission ?? 0.05, 0)} of staking rewards.
        Slashing is inactive on Monad today, with a circuit breaker at a 7% loss of
        protocol equity. Deposits and exits are priced at different rates on purpose, so
        staking and unstaking within the same epoch returns less MON than went in.
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-white">{value}</div>
      {hint && <div className="text-[10px] text-white/40">{hint}</div>}
    </div>
  );
}

function ModeButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-full px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-aeras-blue text-white hover:bg-aeras-blue-medium"
          : "border border-white/15 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

// ── position ────────────────────────────────────────────────────────────────

function PositionBlock({
  position,
  monUsd,
}: {
  position: NonNullable<ShmonEarn["position"]>;
  monUsd: number | null;
}) {
  const shares = BigInt(position.sharesAtomic);
  const phase = unstakePhase(
    {
      amountMon: BigInt(position.pending?.amountMonAtomic ?? "0"),
      completionEpoch: BigInt(position.pending?.completionEpoch ?? "0"),
    },
    position.ready,
  );
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-aeras-positive/25 bg-aeras-positive/10 p-4 text-xs">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Your position" value={fmtShares(shares)} hint={`${fmtMon(position.monAtomic)} at the rate`} />
        <Stat label="Value" value={fmtUsd(monUsdValue(position.monAtomic, monUsd))} />
        <Stat
          label="Instant exit pays"
          value={fmtMon(position.instantNetMonAtomic)}
          hint={`fee ${fmtPct(position.feeRate)}`}
        />
      </div>
      <div className="text-[11px] text-white/60">
        A queued exit locks in {fmtMon(position.queuedMonAtomic)} today and pays it{" "}
        {UNSTAKE_WAIT_COPY} later, with no fee.
        {phase.phase !== "none" && (
          <>
            {" "}
            {fmtMon(phase.amountMon)} is already queued
            {phase.phase === "ready" ? " and ready to complete." : "."}
          </>
        )}
      </div>
    </div>
  );
}

// ── stake ───────────────────────────────────────────────────────────────────

function StakeForm({
  earn,
  solanaUsdcAtomic,
  onSettled,
}: {
  earn: ShmonEarn;
  solanaUsdcAtomic: string;
  onSettled: () => Promise<void>;
}) {
  const { evm, solanaSigner, metrics, position, monUsd } = earn;
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [plan, setPlan] = useState<{ for: bigint; plan: StakePlan } | null>(null);
  const [pricing, setPricing] = useState(false);

  const maxAtomic = BigInt(maxStakeUsdcAtomic(solanaSigner ? solanaUsdcAtomic : "0"));
  const maxUi = Number(formatUnits(maxAtomic, USDC_DECIMALS));
  const amountAtomic = parseAtomic(input, USDC_DECIMALS);
  const overLimit = amountAtomic > maxAtomic;
  const belowMin = amountAtomic > 0n && amountAtomic < MIN_STAKE_USDC_ATOMIC;
  const feeWarn = amountAtomic >= MIN_STAKE_USDC_ATOMIC && amountAtomic < STAKE_FEE_WARN_USDC_ATOMIC;
  const busy = state.kind === "busy";
  const sharesPerMon = metrics?.sharesPerMonAtomic ?? position?.sharesPerMonAtomic ?? "0";
  const walletMon = position?.walletMonAtomic ?? "0";
  const evmAddress = evm.address;
  const solanaAddress = solanaSigner?.address;

  // Price the stake once the amount settles: the preview needs a Trustware
  // quote, and quoting every keystroke would spend the rate budget.
  useEffect(() => {
    if (amountAtomic <= 0n || overLimit || belowMin || !evmAddress || !solanaAddress) {
      const id = setTimeout(() => {
        setPlan(null);
        setPricing(false);
      }, 0);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      setPricing(true);
      const p = await planStake({
        usdcAtomic: amountAtomic,
        solanaUsdcAtomic,
        walletMonAtomic: walletMon,
        sharesPerMonAtomic: sharesPerMon,
        solanaAddress,
        evmAddress,
      });
      if (cancelled) return;
      setPlan({ for: amountAtomic, plan: p });
      setPricing(false);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [amountAtomic, overLimit, belowMin, evmAddress, solanaAddress, solanaUsdcAtomic, walletMon, sharesPerMon]);

  const current = plan && plan.for === amountAtomic ? plan.plan : null;
  const ready = Boolean(evm.ready && evm.address && solanaSigner);
  const disabled =
    busy || amountAtomic <= 0n || overLimit || belowMin || !ready || current?.kind === "blocked";

  const onProgress = (p: MorphoTxProgress) => setState({ kind: "busy", message: p.message });

  async function handleSubmit() {
    if (!evm.address || !solanaSigner) return;
    setState({ kind: "busy", message: "Preparing…" });
    try {
      const r = await stakeFromSolana({
        usdcAtomic: amountAtomic,
        solanaUsdcAtomic,
        walletMonAtomic: walletMon,
        sharesPerMonAtomic: sharesPerMon,
        signer: { address: evm.address, switchChain: evm.switchChain, getProvider: evm.getProvider },
        solana: solanaSigner,
        onProgress,
      });
      setState({
        kind: "done",
        message: `Staked ${fmtMon(r.stakedMonAtomic)}.`,
        txHash: r.txHash,
      });
      setInput("");
      await onSettled();
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <AmountInput
        label="Stake from Solana USDC"
        unit="USDC"
        decimals={USDC_DECIMALS}
        input={input}
        maxAtomic={maxAtomic}
        maxLabel={`${maxUi.toLocaleString(undefined, { maximumFractionDigits: 2 })} available`}
        onChange={(v) => {
          setInput(v);
          if (state.kind !== "idle") setState({ kind: "idle" });
        }}
      />

      {amountAtomic > 0n && !overLimit && !belowMin && (
        <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px]">
          {current?.kind === "fund-then-stake" ? (
            <>
              <Row label="MON delivered, at least" value={fmtMon(current.monDeliveredMinAtomic, 2)} />
              {current.reserveKeptAtomic > 0n && (
                <Row label="Kept in the wallet for gas" value={fmtMon(current.reserveKeptAtomic, 2)} />
              )}
              <Row label="shMON minted, about" value={fmtShares(current.sharesMinAtomic, 2)} />
              <Row
                label="Worth, at the MON price"
                value={fmtUsd(monUsdValue(current.monStakedMinAtomic, monUsd))}
              />
              <Row
                label="Route fees"
                value={current.totalFeesUsd != null ? fmtUsd(current.totalFeesUsd, 3) : "—"}
              />
            </>
          ) : current?.kind === "blocked" ? (
            <div className="text-aeras-negative">{current.reason}</div>
          ) : (
            <div className="text-white/50">{pricing ? "Pricing the conversion…" : "—"}</div>
          )}
        </div>
      )}

      {feeWarn && (
        <p className="text-[11px] text-aeras-warning">
          Under {fmtUnits(STAKE_FEE_WARN_USDC_ATOMIC, USDC_DECIMALS, 0)} USDC the route&apos;s fixed
          fee is a noticeable share of the amount.
        </p>
      )}
      {belowMin && (
        <p className="text-[11px] text-aeras-negative">
          The minimum stake is {fmtUnits(MIN_STAKE_USDC_ATOMIC, USDC_DECIMALS, 0)} USDC.
        </p>
      )}
      {overLimit && (
        <p className="text-[11px] text-aeras-negative">Amount is above your Solana USDC.</p>
      )}
      {!ready && (
        <p className="text-[11px] text-aeras-warning">
          Both embedded wallets are required. They are provisioned on login; try reconnecting
          if this persists.
        </p>
      )}
      <StateLine state={state} />

      <button type="button" disabled={disabled} onClick={handleSubmit} className={BUTTON_CLASS}>
        {busy ? state.message : "Stake"}
      </button>
      <p className="text-[11px] text-white/50">
        Converts USDC to MON through Trustware and stakes it, signed automatically. Keeps{" "}
        {fmtMon(GAS_FLOOR_WEI, 1)} in the Monad wallet for gas. Bridging takes a few minutes.
      </p>
    </div>
  );
}

// ── withdraw ────────────────────────────────────────────────────────────────

function WithdrawPanel({ earn, onSettled }: { earn: ShmonEarn; onSettled: () => Promise<void> }) {
  const { evm, position, metrics } = earn;
  const [tab, setTab] = useState<"instant" | "queue">("instant");
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });

  if (!position) return null;
  const shares = BigInt(position.sharesAtomic);
  const rate = BigInt(position.rateAtomic);
  const poolAvailable = BigInt(position.poolAvailableMonAtomic);
  const walletMon = BigInt(position.walletMonAtomic);
  const phase = unstakePhase(
    {
      amountMon: BigInt(position.pending?.amountMonAtomic ?? "0"),
      completionEpoch: BigInt(position.pending?.completionEpoch ?? "0"),
    },
    position.ready,
  );
  const busy = state.kind === "busy";
  const onProgress = (p: MorphoTxProgress) => setState({ kind: "busy", message: p.message });

  function signer() {
    if (!evm.address) throw new Error("No embedded EVM wallet available.");
    return { address: evm.address, switchChain: evm.switchChain, getProvider: evm.getProvider };
  }

  async function run(label: string, action: () => Promise<string>, doneMessage: string) {
    setState({ kind: "busy", message: label });
    try {
      const txHash = await action();
      setState({ kind: "done", message: doneMessage, txHash });
      setInput("");
      await onSettled();
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Both tabs take shMON. The instant tab is capped by the pool; the queue
  // takes the whole position.
  const instantCap = instantCapacityShares(shares, poolAvailable, rate);
  const maxAtomic = tab === "instant" ? instantCap : shares;
  const amountAtomic = parseAtomic(input, 18);
  const overLimit = amountAtomic > maxAtomic;
  const all = amountAtomic > 0n && amountAtomic >= maxAtomic;
  // Proportional previews: the fee is a rate, so a slice of the position pays
  // the same slice of the whole-position preview. The contract enforces the
  // floor either way.
  const instantNet = shares > 0n ? (BigInt(position.instantNetMonAtomic) * amountAtomic) / shares : 0n;
  const queuedMon = shares > 0n ? (BigInt(position.queuedMonAtomic) * amountAtomic) / shares : 0n;
  const disabled = busy || !evm.ready || amountAtomic <= 0n || overLimit;
  const pooled = instantCap < shares;

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["instant", "Instant", `${fmtPct(position.feeRate)} fee now`],
            ["queue", "Queue", `no fee, ${UNSTAKE_WAIT_COPY}`],
          ] as const
        ).map(([id, label, sub]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setInput("");
              setState({ kind: "idle" });
            }}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${
              tab === id ? "border-aeras-blue bg-aeras-blue/10" : "border-white/10 bg-white/5 hover:border-white/20"
            }`}
          >
            <div className="text-xs font-medium text-white">{label}</div>
            <div className="text-[10px] text-white/50">{sub}</div>
          </button>
        ))}
      </div>

      {tab === "queue" && phase.phase !== "none" && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs">
          <div className="text-white">
            {fmtMon(phase.amountMon)} queued
            {phase.phase === "ready" ? ", ready to complete." : `. Ready ${UNSTAKE_WAIT_COPY} after it was requested.`}
          </div>
          {phase.phase === "pending" && (
            <div className="text-[11px] text-white/50">
              Epochs close about every {EPOCH_HOURS_APPROX} hours; this completes when its epoch
              does. A new request would merge with this one and restart its wait.
            </div>
          )}
          <button
            type="button"
            disabled={busy || !evm.ready || phase.phase !== "ready"}
            onClick={() =>
              run(
                "Completing…",
                () => completeUnstake({ walletMonAtomic: walletMon, signer: signer(), onProgress }),
                "Completed. The MON is in your Monad wallet.",
              )
            }
            className={BUTTON_CLASS}
          >
            {busy ? state.message : phase.phase === "ready" ? "Complete unstake" : "Not ready yet"}
          </button>
        </div>
      )}

      {shares > 0n && (
        <>
          <AmountInput
            label={tab === "instant" ? "Unstake instantly" : "Queue an unstake"}
            unit={SHMON_SYMBOL}
            decimals={18}
            input={input}
            maxAtomic={maxAtomic}
            maxLabel={`${fmtUnits(maxAtomic, 18, 4)} ${tab === "instant" && pooled ? "payable now" : "staked"}`}
            onChange={(v) => {
              setInput(v);
              if (state.kind !== "idle") setState({ kind: "idle" });
            }}
          />
          {amountAtomic > 0n && !overLimit && (
            <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px]">
              {tab === "instant" ? (
                <>
                  <Row label="MON out, about" value={fmtMon(instantNet, 4)} />
                  <Row label="Fee" value={fmtPct(position.feeRate)} />
                  <Row label="Floor sent to the contract" value={fmtMon(withTolerance(instantNet, INSTANT_EXIT_TOLERANCE_BPS), 4)} />
                </>
              ) : (
                <>
                  <Row label="MON locked in at today's rate" value={fmtMon(queuedMon, 4)} />
                  <Row label="Arrives" value={UNSTAKE_WAIT_COPY} />
                  <Row label="Fee" value="none" />
                </>
              )}
            </div>
          )}
          {tab === "instant" && pooled && (
            <p className="text-[11px] text-aeras-warning">
              The instant pool can pay {fmtMon(poolAvailable, 0)} right now
              {metrics ? `, ${Math.round(metrics.utilization * 100)}% drawn` : ""}. The rest of the
              position can leave through the queue.
            </p>
          )}
          {tab === "queue" && phase.phase !== "none" && amountAtomic > 0n && (
            <p className="text-[11px] text-aeras-warning">
              A request is already queued. This one merges into it and restarts the wait for
              both.
            </p>
          )}
          {tab === "queue" && (
            <p className="text-[11px] text-white/50">
              The rate locks now and the shares earn nothing while queued. One request per
              wallet at a time.
            </p>
          )}
          {overLimit && (
            <p className="text-[11px] text-aeras-negative">
              Amount is above what can be {tab === "instant" ? "paid instantly" : "unstaked"}.
            </p>
          )}
          <StateLine state={state} />
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              tab === "instant"
                ? run(
                    "Unstaking…",
                    () =>
                      redeemInstant({
                        sharesAtomic: all ? maxAtomic : amountAtomic,
                        minMonAtomic: withTolerance(instantNet, INSTANT_EXIT_TOLERANCE_BPS),
                        walletMonAtomic: walletMon,
                        signer: signer(),
                        onProgress,
                      }),
                    "Unstaked. The MON is in your Monad wallet.",
                  )
                : run(
                    "Queueing…",
                    () =>
                      requestUnstake({
                        sharesAtomic: all ? shares : amountAtomic,
                        walletMonAtomic: walletMon,
                        signer: signer(),
                        onProgress,
                      }),
                    "Queued. Come back in about a day to complete it.",
                  )
            }
            className={BUTTON_CLASS}
          >
            {busy ? state.message : tab === "instant" ? "Unstake instantly" : "Request unstake"}
          </button>
        </>
      )}
      {shares === 0n && phase.phase === "none" && (
        <p className="text-[11px] text-white/50">Nothing staked.</p>
      )}
    </div>
  );
}

// ── the way home ────────────────────────────────────────────────────────────

function ReturnForm({
  earn,
  solanaAddress,
  onSettled,
}: {
  earn: ShmonEarn;
  solanaAddress: string;
  onSettled: () => Promise<void>;
}) {
  const { evm, position, monUsd } = earn;
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [quote, setQuote] = useState<{ for: bigint; minUsdc: bigint; feesUsd: number | null } | null>(null);
  const walletMon = position?.walletMonAtomic ?? "0";
  const maxAtomic = maxReturnableMonAtomic(walletMon);
  const amountAtomic = parseAtomic(input, 18);
  const overLimit = amountAtomic > maxAtomic;
  const busy = state.kind === "busy";
  const evmAddress = evm.address;

  useEffect(() => {
    if (amountAtomic <= 0n || overLimit || !evmAddress) {
      const id = setTimeout(() => setQuote(null), 0);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const q = await quoteMonToSolana({ monAtomic: amountAtomic, evmAddress, solanaAddress });
        if (cancelled) return;
        setQuote({ for: amountAtomic, minUsdc: BigInt(q.toAmountMinAtomic), feesUsd: q.totalFeesUsd });
      } catch {
        if (!cancelled) setQuote(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [amountAtomic, overLimit, evmAddress, solanaAddress]);

  const current = quote && quote.for === amountAtomic ? quote : null;
  const disabled = busy || !evm.ready || amountAtomic <= 0n || overLimit;

  async function handleSubmit() {
    if (!evm.address) return;
    setState({ kind: "busy", message: "Preparing…" });
    try {
      const r = await sendMonToSolana({
        monAtomic: amountAtomic,
        walletMonAtomic: walletMon,
        evm: { address: evm.address, switchChain: evm.switchChain, getProvider: evm.getProvider },
        solanaAddress,
        minUsdcAtomic: current?.minUsdc,
        onProgress: (p) => setState({ kind: "busy", message: p.message }),
      });
      setState({
        kind: "done",
        message: r.deliveredAtomic
          ? `${fmtUnits(r.deliveredAtomic, USDC_DECIMALS, 2)} USDC arrived on Solana.`
          : "USDC arrived on Solana.",
      });
      setInput("");
      await onSettled();
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        MON in your Monad wallet
      </div>
      <p className="text-xs text-white/60">
        {fmtMon(walletMon, 4)}
        {monUsd != null && <> ({fmtUsd(monUsdValue(walletMon, monUsd))})</>}. Send it home to
        Solana as USDC; the gas reserve stays.
      </p>
      <AmountInput
        label="Move to Solana"
        unit="MON"
        decimals={18}
        input={input}
        maxAtomic={maxAtomic}
        maxLabel={`${fmtUnits(maxAtomic, 18, 4)} sendable`}
        onChange={(v) => {
          setInput(v);
          if (state.kind !== "idle") setState({ kind: "idle" });
        }}
      />
      {amountAtomic > 0n && !overLimit && (
        <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px]">
          <Row
            label="USDC on Solana, at least"
            value={current ? `${fmtUnits(current.minUsdc, USDC_DECIMALS, 2)} USDC` : "pricing…"}
          />
          <Row label="Route fees" value={current?.feesUsd != null ? fmtUsd(current.feesUsd, 3) : "—"} />
        </div>
      )}
      {overLimit && (
        <p className="text-[11px] text-aeras-negative">Amount is above what the wallet can send.</p>
      )}
      <StateLine state={state} />
      <button type="button" disabled={disabled} onClick={handleSubmit} className={BUTTON_CLASS}>
        {busy ? state.message : "Move to Solana as USDC"}
      </button>
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────

function AmountInput({
  label,
  unit,
  decimals,
  input,
  maxAtomic,
  maxLabel,
  onChange,
}: {
  label: string;
  unit: string;
  decimals: number;
  input: string;
  maxAtomic: bigint;
  maxLabel: string;
  onChange: (value: string) => void;
}) {
  const maxUi = Number(formatUnits(maxAtomic, decimals));
  const useSlider = maxUi > 0;
  const setMax = () => onChange(formatUnits(maxAtomic, decimals));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          {label}
        </label>
        <span className="font-mono text-[11px] text-white/50">
          {maxLabel}
          <button
            type="button"
            onClick={setMax}
            className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
          >
            Max
          </button>
        </span>
      </div>
      {useSlider ? (
        <div className="space-y-2 rounded-lg border border-white/15 bg-white/5 px-3 py-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-lg tabular-nums text-white">
              {input || "0"} <span className="text-xs text-white/50">{unit}</span>
            </span>
            <span className="font-mono text-[11px] text-white/50">
              {`${Math.round(((Number(input) || 0) / maxUi) * 100)}%`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={maxUi}
            step={Math.max(maxUi / 100, 1e-6)}
            value={Math.min(Number(input) || 0, maxUi)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= maxUi) setMax();
              else onChange(String(v));
            }}
            style={
              {
                "--range-progress": Math.min(1, Math.max(0, (Number(input) || 0) / maxUi)),
              } as CSSProperties
            }
            className="aeras-range"
          />
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLASS}
            aria-label={`${label} amount`}
          />
        </div>
      ) : (
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLASS}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
            {unit}
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-white/50">{label}</span>
      <span className="font-mono tabular-nums text-white">{value}</span>
    </div>
  );
}

function StateLine({ state }: { state: FormState }) {
  if (state.kind === "error") {
    return (
      <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
        {state.message}
      </p>
    );
  }
  if (state.kind === "done") {
    const body = (
      <>
        <div className="font-medium text-aeras-positive">{state.message}</div>
        {state.txHash && (
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">{state.txHash}</div>
        )}
      </>
    );
    return state.txHash ? (
      <a
        href={`${MONAD_EXPLORER_TX_BASE}${state.txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
      >
        {body}
      </a>
    ) : (
      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">{body}</div>
    );
  }
  return null;
}

// The hook, re-exported so the Earn tab can hold the venue's data at page
// level later if a column ever needs it, the way it holds Morpho's.
export { useShmonEarn };
