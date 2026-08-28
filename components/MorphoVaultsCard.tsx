"use client";

// Monad Morpho as a venue inside the shared Earn Vaults table, beside Jupiter
// Lend and Kamino. It reads its own live data (APY from the Morpho indexer,
// positions and Monad USDC/MON balances from Monad RPC) and signs deposits and
// withdrawals with the Privy embedded EVM wallet. A deposit larger than the
// Monad USDC balance funds itself: the shortfall is converted from the wallet's
// Solana USDC through Trustware before the vault deposit runs
// (lib/morpho/fund.ts). It is the one earn venue whose positions live on an EVM
// chain rather than on Solana (see CLAUDE.md).
//
// Shape note: Jupiter Lend and Kamino each expose one vault per asset, so their
// venue cells resolve to a single rate. Morpho exposes several curator vaults
// for the same asset, so the table cell shows the best of them and the choice
// between them moves into the expanded row (MorphoVenuePanel). The table stays
// one row per asset either way.

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";

import { AssetLogo } from "@/components/AssetLogo";
import { curatorLogo } from "@/lib/tokens/logos";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import { MONAD_EXPLORER_TX_BASE } from "@/lib/morpho/constants";
import {
  fetchMorphoMetrics,
  fetchMorphoPositions,
  type MorphoPosition,
  type MorphoVaultMetric,
} from "@/lib/morpho/client";
import {
  withdrawFromMorphoVault,
  type MorphoTxProgress,
} from "@/lib/morpho/deposit";
import {
  depositUsdcWithFunding,
  maxFundableDepositAtomic,
  needsMonadGas,
  type SolanaSigner,
} from "@/lib/morpho/fund";
import { type MorphoVault } from "@/lib/morpho/vaults";

const USDC_DECIMALS = 6;

function fmtUsd(atomic: string | bigint | undefined): string {
  if (atomic == null || atomic === "0" || atomic === 0n) return "$0.00";
  return `$${Number(formatUnits(BigInt(atomic), USDC_DECIMALS)).toLocaleString(
    undefined,
    { maximumFractionDigits: 2 },
  )}`;
}

// ── Live data ───────────────────────────────────────────────────────────────

export interface MorphoEarn {
  metrics: Map<string, MorphoVaultMetric>;
  positions: Map<string, MorphoPosition>;
  // Monad USDC in the embedded EVM wallet, 6-decimal atomic.
  usdcBalanceAtomic: string;
  // Native MON for gas, 18-decimal atomic.
  monBalanceAtomic: string;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  // The Solana wallet, as a signer for the Trustware funding leg.
  solanaSigner: SolanaSigner | undefined;
  refresh: () => Promise<void>;
}

// Owned by the Vaults table rather than by a Morpho component, because the
// table needs the rates to draw the Morpho column whether or not any row is
// expanded.
export function useMorphoEarn(walletAddress: string | undefined): MorphoEarn {
  const evm = useEmbeddedEvmWallet();
  const sendSolanaTx = useSendSolanaTxBase64();
  const [metrics, setMetrics] = useState<Map<string, MorphoVaultMetric>>(
    new Map(),
  );
  const [positions, setPositions] = useState<Map<string, MorphoPosition>>(
    new Map(),
  );
  const [usdcBalanceAtomic, setUsdcBalance] = useState("0");
  const [monBalanceAtomic, setMonBalance] = useState("0");

  const solanaSigner = useMemo<SolanaSigner | undefined>(
    () =>
      walletAddress
        ? { address: walletAddress, signAndSendBase64: sendSolanaTx }
        : undefined,
    [walletAddress, sendSolanaTx],
  );

  const refresh = useCallback(async () => {
    try {
      setMetrics(await fetchMorphoMetrics());
    } catch (err) {
      console.error("[morpho metrics]", err);
    }
    if (evm.address) {
      try {
        const { positions: p, usdcBalanceAtomic: u, monBalanceAtomic: m } =
          await fetchMorphoPositions(evm.address);
        setPositions(p);
        setUsdcBalance(u);
        setMonBalance(m);
      } catch (err) {
        console.error("[morpho positions]", err);
      }
    }
  }, [evm.address]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cancelled) await refresh();
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return {
    metrics,
    positions,
    usdcBalanceAtomic,
    monBalanceAtomic,
    evm,
    solanaSigner,
    refresh,
  };
}

// The vault whose rate the venue column shows: the best-paying of the curated
// set. Falls back to the first vault so the cell can still name a venue while
// the indexer read is in flight.
export function morphoBestVault(
  vaults: readonly MorphoVault[],
  metrics: Map<string, MorphoVaultMetric>,
): { vault: MorphoVault; metric: MorphoVaultMetric | undefined } | null {
  if (vaults.length === 0) return null;
  let best = vaults[0];
  let bestApy = -Infinity;
  for (const v of vaults) {
    const apy = metrics.get(v.address.toLowerCase())?.netApy;
    if (apy != null && apy > bestApy) {
      bestApy = apy;
      best = v;
    }
  }
  return { vault: best, metric: metrics.get(best.address.toLowerCase()) };
}

// Everything the wallet holds across the asset's Morpho vaults, in USDC atomic.
export function morphoTotalPositionAtomic(
  vaults: readonly MorphoVault[],
  positions: Map<string, MorphoPosition>,
): bigint {
  let total = 0n;
  for (const v of vaults) {
    const p = positions.get(v.address.toLowerCase());
    if (p) total += BigInt(p.assetsAtomic);
  }
  return total;
}

export function morphoPositionAtomic(
  vault: MorphoVault,
  positions: Map<string, MorphoPosition>,
): string {
  return positions.get(vault.address.toLowerCase())?.assetsAtomic ?? "0";
}

// ── Venue panel ─────────────────────────────────────────────────────────────

// What the expanded row shows once Morpho is the selected venue: which curator
// vault, then the form for it. Jupiter Lend and Kamino need no equivalent
// because there is only ever one vault to be in.
export function MorphoVenuePanel({
  vaults,
  earn,
  selected,
  onSelect,
  mode,
  solanaUsdcAtomic,
  onSettled,
}: {
  vaults: readonly MorphoVault[];
  earn: MorphoEarn;
  selected: MorphoVault;
  onSelect: (vault: MorphoVault) => void;
  mode: "deposit" | "withdraw";
  // Solana USDC available to fund a shortfall, 6-decimal atomic.
  solanaUsdcAtomic: string;
  onSettled: () => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      {vaults.length > 1 && (
        <div className="space-y-1.5">
          {vaults.map((v) => {
            const metric = earn.metrics.get(v.address.toLowerCase());
            const held = BigInt(morphoPositionAtomic(v, earn.positions));
            const active = v.address === selected.address;
            return (
              <button
                key={v.address}
                type="button"
                onClick={() => onSelect(v)}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-aeras-blue bg-aeras-blue/10"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                <AssetLogo
                  xstock={{
                    symbol: v.curator,
                    name: v.curator,
                    logo: curatorLogo(v.curator),
                  }}
                  size={26}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-white">
                    {v.name}
                  </div>
                  <div className="truncate text-[11px] text-white/50">
                    {v.curator}
                    {!v.listed && (
                      <span className="ml-1.5 text-aeras-warning">
                        Not listed by Morpho
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm tabular-nums text-white">
                    {metric?.netApy == null
                      ? "—"
                      : `${(metric.netApy * 100).toFixed(2)}%`}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-white/50">
                    {held > 0n
                      ? `${fmtUsd(held)} deposited`
                      : metric?.tvlUsd != null
                        ? `$${Math.round(metric.tvlUsd).toLocaleString()} TVL`
                        : "—"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <MorphoVaultForm
        key={`${selected.address}-${mode}`}
        mode={mode}
        vault={selected}
        position={earn.positions.get(selected.address.toLowerCase())}
        usdcBalanceAtomic={earn.usdcBalanceAtomic}
        monBalanceAtomic={earn.monBalanceAtomic}
        solanaUsdcAtomic={solanaUsdcAtomic}
        solanaSigner={earn.solanaSigner}
        evm={earn.evm}
        onSettled={onSettled}
      />
    </div>
  );
}

// ── per-vault deposit / withdraw ─────────────────────────────────────────────

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; txHash: string }
  | { kind: "error"; message: string };

function MorphoVaultForm({
  mode,
  vault,
  position,
  usdcBalanceAtomic,
  monBalanceAtomic,
  solanaUsdcAtomic,
  solanaSigner,
  evm,
  onSettled,
}: {
  // Driven by the shared deposit/withdraw switch on the expanded row, the same
  // one the Jupiter Lend and Kamino forms answer to. Remounted on a change, so
  // there is no stale amount to clear.
  mode: "deposit" | "withdraw";
  vault: MorphoVault;
  position: MorphoPosition | undefined;
  usdcBalanceAtomic: string;
  monBalanceAtomic: string;
  solanaUsdcAtomic: string;
  solanaSigner: SolanaSigner | undefined;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  onSettled: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });

  const positionAtomic = position?.assetsAtomic ?? "0";
  // Deposits can draw on the Solana balance through the Trustware funding leg,
  // so the ceiling is not just what already sits on Monad.
  const maxAtomic =
    mode === "deposit"
      ? maxFundableDepositAtomic(
          usdcBalanceAtomic,
          solanaSigner ? solanaUsdcAtomic : "0",
          monBalanceAtomic,
        )
      : positionAtomic;
  const maxUi = Number(formatUnits(BigInt(maxAtomic), USDC_DECIMALS));
  // Slider for both directions whenever there is a balance to slide over;
  // an empty ceiling falls back to the plain input (which is disabled anyway).
  const useSlider = maxUi > 0;

  const amountAtomic = (() => {
    try {
      return input ? parseUnits(input, USDC_DECIMALS) : 0n;
    } catch {
      return 0n;
    }
  })();
  // The part of the deposit that has to come from Solana.
  const shortfallAtomic =
    mode === "deposit" && amountAtomic > BigInt(usdcBalanceAtomic)
      ? amountAtomic - BigInt(usdcBalanceAtomic)
      : 0n;
  const overLimit = amountAtomic > BigInt(maxAtomic);
  const busy = state.kind === "busy";
  const disabled = busy || amountAtomic <= 0n || overLimit || !evm.ready;
  // A full withdrawal redeems shares directly, avoiding asset-rounding dust.
  const redeemAll =
    mode === "withdraw" &&
    amountAtomic > 0n &&
    amountAtomic >= BigInt(positionAtomic);

  const onProgress = (p: MorphoTxProgress) =>
    setState({ kind: "busy", message: p.message });

  async function handleSubmit() {
    if (!evm.address) {
      setState({ kind: "error", message: "No embedded EVM wallet available." });
      return;
    }
    setState({ kind: "busy", message: "Preparing…" });
    try {
      const signer = {
        address: evm.address,
        switchChain: evm.switchChain,
        getProvider: evm.getProvider,
      };
      const txHash =
        mode === "deposit"
          ? (
              await depositUsdcWithFunding({
                vault,
                amountAtomic,
                monadUsdcAtomic: usdcBalanceAtomic,
                solanaUsdcAtomic,
                monBalanceAtomic,
                signer,
                solana: solanaSigner,
                onProgress,
              })
            ).txHash
          : await withdrawFromMorphoVault({
              vault,
              amountAtomic,
              redeemAll,
              signer,
              onProgress,
            });
      setState({ kind: "done", txHash });
      setInput("");
      await onSettled();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            {mode === "deposit" ? "Deposit" : "Withdraw"} USDC
          </label>
          <span className="font-mono text-[11px] text-white/50">
            {maxUi.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            {mode === "deposit" ? "available" : "deposited"}
            <button
              type="button"
              onClick={() => {
                setInput(formatUnits(BigInt(maxAtomic), USDC_DECIMALS));
                if (state.kind !== "idle") setState({ kind: "idle" });
              }}
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
                {input || "0"} <span className="text-xs text-white/50">USDC</span>
              </span>
              <span className="font-mono text-[11px] text-white/50">
                {maxUi > 0
                  ? `${Math.round(((Number(input) || 0) / maxUi) * 100)}%`
                  : "0%"}
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
                setInput(
                  v >= maxUi
                    ? formatUnits(BigInt(maxAtomic), USDC_DECIMALS)
                    : String(v),
                );
                if (state.kind !== "idle") setState({ kind: "idle" });
              }}
              className="w-full accent-aeras-blue"
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
              onChange={(e) => {
                setInput(e.target.value);
                if (state.kind !== "idle") setState({ kind: "idle" });
              }}
              className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
              USDC
            </span>
          </div>
        )}
      </div>

      {mode === "deposit" &&
        amountAtomic > 0n &&
        !overLimit &&
        (shortfallAtomic > 0n || needsMonadGas(monBalanceAtomic)) && (
          <p className="text-[11px] text-white/60">
            {shortfallAtomic > 0n && (
              <>
                {Number(
                  formatUnits(shortfallAtomic, USDC_DECIMALS),
                ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                USDC of this comes from your Solana wallet, converted to Monad
                through Trustware before the deposit.{" "}
              </>
            )}
            {needsMonadGas(monBalanceAtomic) && (
              <>
                A one-time 0.50 USDC from your Solana wallet buys MON to pay
                Monad gas.{" "}
              </>
            )}
            Bridging takes a few minutes.
          </p>
        )}
      {!evm.ready && (
        <p className="text-[11px] text-aeras-warning">
          An embedded EVM wallet is required. It is provisioned on login; try
          reconnecting if this persists.
        </p>
      )}
      {overLimit && (
        <p className="text-[11px] text-aeras-negative">
          Amount is above the{" "}
          {mode === "deposit" ? "wallet balance" : "deposited"} limit.
        </p>
      )}
      {state.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {state.message}
        </p>
      )}
      {state.kind === "done" && (
        <a
          href={`${MONAD_EXPLORER_TX_BASE}${state.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">
            {mode === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed"}
          </div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
            {state.txHash}
          </div>
        </a>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={handleSubmit}
        className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy
          ? state.message
          : mode === "deposit"
            ? `Deposit into ${vault.name}`
            : "Withdraw USDC"}
      </button>

      <p className="text-[11px] text-white/50">
        {vault.name} is a Morpho Vaults V2 vault on Monad, managed by{" "}
        {vault.curator}. This position settles on Monad, not on Solana: the
        shares sit in your embedded EVM wallet. The rate is variable and net of
        the curator&rsquo;s fee.
      </p>
    </div>
  );
}
