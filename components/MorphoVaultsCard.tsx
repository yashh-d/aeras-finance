"use client";

// Monad Morpho earn rows. Reads its own live vault data (APY from the indexer,
// positions + USDC balance from Monad RPC) and signs deposits / withdrawals
// with the Privy embedded EVM wallet. A deposit larger than the Monad USDC
// balance funds itself: the shortfall is converted from the wallet's Solana
// USDC through Trustware before the vault deposit runs (lib/morpho/fund.ts).
// It is the one earn surface whose positions live on an EVM chain, not Solana
// (see CLAUDE.md).

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";

import { AssetLogo, VenueMark } from "@/components/AssetLogo";
import { VENUE_LOGOS, curatorLogo } from "@/lib/tokens/logos";
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
import { MONAD_USDC_VAULTS, type MorphoVault } from "@/lib/morpho/vaults";
import type { AccountBalances } from "@/lib/solana/balances";

const USDC_DECIMALS = 6;

function fmtUsd(atomic: string | undefined): string {
  if (!atomic || atomic === "0") return "$0.00";
  return `$${Number(formatUnits(BigInt(atomic), USDC_DECIMALS)).toLocaleString(
    undefined,
    { maximumFractionDigits: 2 },
  )}`;
}

function fmtApy(netApy: number | null): string {
  return netApy == null ? "—" : `${(netApy * 100).toFixed(2)}%`;
}

export function MorphoVaultsSection({
  walletAddress,
  balances,
  onRefresh,
}: {
  // The user's Solana wallet: funding source for deposits that exceed the
  // Monad USDC balance.
  walletAddress: string | undefined;
  balances: AccountBalances | null;
  // Parent refresh, called after a settle so the Solana USDC spent by a funded
  // deposit disappears from the wallet panel without a reload.
  onRefresh?: () => Promise<void>;
}) {
  const evm = useEmbeddedEvmWallet();
  const sendSolanaTx = useSendSolanaTxBase64();
  const [metrics, setMetrics] = useState<Map<string, MorphoVaultMetric>>(
    new Map(),
  );
  const [positions, setPositions] = useState<Map<string, MorphoPosition>>(
    new Map(),
  );
  const [usdcBalance, setUsdcBalance] = useState<string>("0");
  const [monBalance, setMonBalance] = useState<string>("0");
  const [openAddr, setOpenAddr] = useState<string | null>(null);

  const solanaUsdcAtomic = balances?.usdcAtomic ?? "0";
  const solanaSigner = useMemo<SolanaSigner | undefined>(
    () =>
      walletAddress
        ? { address: walletAddress, signAndSendBase64: sendSolanaTx }
        : undefined,
    [walletAddress, sendSolanaTx],
  );

  const refresh = useCallback(async () => {
    try {
      const m = await fetchMorphoMetrics();
      setMetrics(m);
    } catch (err) {
      console.error("[morpho metrics]", err);
    }
    if (evm.address) {
      try {
        const { positions: p, usdcBalanceAtomic, monBalanceAtomic } =
          await fetchMorphoPositions(evm.address);
        setPositions(p);
        setUsdcBalance(usdcBalanceAtomic);
        setMonBalance(monBalanceAtomic);
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

  const handleSettled = useCallback(async () => {
    await refresh();
    await onRefresh?.();
  }, [refresh, onRefresh]);

  return (
    <>
      {/* Section head inside the shared Vaults table. The Monad rows are a
          different shape from the asset rows above (one row per vault, not per
          asset) so they keep their own column labels, but the right-hand
          "Your deposit" and chevron columns line up across both. */}
      <div className="flex items-baseline justify-between pt-4 pb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          <VenueMark src={VENUE_LOGOS.monad} />
          Monad · Morpho
        </div>
        <div className="text-[11px] text-white/50">Settles on Monad (EVM)</div>
      </div>

      <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        <div className="col-span-5">Vault</div>
        <div className="col-span-2 text-right">Net APY</div>
        <div className="col-span-2 text-right">TVL</div>
        <div className="col-span-2 text-right">Your deposit</div>
        <div className="col-span-1" />
      </div>

        {MONAD_USDC_VAULTS.map((vault) => {
          const key = vault.address.toLowerCase();
          const metric = metrics.get(key);
          const position = positions.get(key);
          const expanded = openAddr === key;
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setOpenAddr(expanded ? null : key)}
                className="grid w-full grid-cols-12 items-center gap-2 py-3 text-left"
              >
                <div className="col-span-5 flex items-center gap-2.5">
                  <AssetLogo
                    xstock={{
                      symbol: vault.curator,
                      name: vault.curator,
                      logo: curatorLogo(vault.curator),
                    }}
                    size={28}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {vault.name}
                    </div>
                    <div className="text-[11px] text-white/50">
                      {vault.curator}
                      {!vault.listed && (
                        <span className="ml-1.5 text-aeras-warning">
                          Not listed by Morpho
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="col-span-2 text-right font-mono text-sm text-aeras-positive">
                  {fmtApy(metric?.netApy ?? null)}
                </div>
                <div className="col-span-2 text-right font-mono text-xs text-white/70">
                  {metric?.tvlUsd != null
                    ? `$${Math.round(metric.tvlUsd).toLocaleString()}`
                    : "—"}
                </div>
                <div className="col-span-2 text-right font-mono text-xs text-white/70">
                  {position && position.assetsAtomic !== "0"
                    ? fmtUsd(position.assetsAtomic)
                    : "—"}
                </div>
                <div className="col-span-1 flex justify-end">
                  <ChevronDown
                    className={`h-4 w-4 text-white/40 transition-transform ${
                      expanded ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>

              {expanded && (
                <MorphoVaultForm
                  vault={vault}
                  position={position}
                  usdcBalanceAtomic={usdcBalance}
                  monBalanceAtomic={monBalance}
                  solanaUsdcAtomic={solanaUsdcAtomic}
                  solanaSigner={solanaSigner}
                  evm={evm}
                  onSettled={handleSettled}
                />
              )}
            </div>
          );
        })}
    </>
  );
}

// ── per-vault deposit / withdraw ─────────────────────────────────────────────

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; txHash: string }
  | { kind: "error"; message: string };

function MorphoVaultForm({
  vault,
  position,
  usdcBalanceAtomic,
  monBalanceAtomic,
  solanaUsdcAtomic,
  solanaSigner,
  evm,
  onSettled,
}: {
  vault: MorphoVault;
  position: MorphoPosition | undefined;
  // Monad USDC in the embedded EVM wallet, 6-decimal atomic.
  usdcBalanceAtomic: string;
  // Native MON for gas, 18-decimal atomic.
  monBalanceAtomic: string;
  // Solana USDC available to fund a shortfall, 6-decimal atomic.
  solanaUsdcAtomic: string;
  solanaSigner: SolanaSigner | undefined;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  onSettled: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
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
    mode === "withdraw" && amountAtomic > 0n && amountAtomic >= BigInt(positionAtomic);

  function switchMode(next: "deposit" | "withdraw") {
    setMode(next);
    setInput("");
    setState({ kind: "idle" });
  }

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
    <div className="space-y-3 pb-4">
      <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex gap-1">
          {(["deposit", "withdraw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                mode === m
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

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
                  {input || "0"}{" "}
                  <span className="text-xs text-white/50">USDC</span>
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
                  setInput(v >= maxUi ? formatUnits(BigInt(maxAtomic), USDC_DECIMALS) : String(v));
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
                  USDC of this comes from your Solana wallet, converted to
                  Monad through Trustware before the deposit.{" "}
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
            Amount is above the {mode === "deposit" ? "wallet balance" : "deposited"} limit.
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
              ? "Deposit USDC"
              : "Withdraw USDC"}
        </button>
      </div>
    </div>
  );
}
