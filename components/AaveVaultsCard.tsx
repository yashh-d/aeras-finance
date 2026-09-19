"use client";

// Aave on Ethereum as a venue inside the shared Earn Vaults table, beside
// Jupiter Lend, Kamino and Morpho. It reads its own live data (rates from the
// Aave Pool and Umbrella's emission schedule, positions and Ethereum balances,
// all via our API routes) and signs with the Privy embedded EVM wallet. A
// deposit larger than the Ethereum balance funds itself: the shortfall is
// converted from the wallet's Solana USDC through Trustware, with an ETH gas
// purchase when the wallet cannot pay for its own transactions
// (lib/aave/fund.ts). Positions live on Ethereum, not Solana (see CLAUDE.md).
//
// Shape note: like Morpho, Aave offers more than one vault per asset, so the
// table cell shows the best of them and the choice moves into the expanded
// row (AaveVenuePanel). Unlike Morpho, the two vaults differ in kind rather
// than in curator, and the difference is what the panel has to make plain:
// the Umbrella vault pays more because the deposit backstops Aave's bad debt
// and takes about three weeks to leave. The form therefore changes shape with
// the vault: an instant withdraw for the supply vault, a cooldown state
// machine for Umbrella.

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";

import { AssetLogo } from "@/components/AssetLogo";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import {
  fetchAaveMetrics,
  fetchAavePositions,
  type AavePosition,
  type AaveVaultMetric,
} from "@/lib/aave/client";
import { ETHEREUM_EXPLORER_TX_BASE } from "@/lib/aave/constants";
import {
  claimUmbrellaRewards,
  redeemFromUmbrella,
  startUmbrellaCooldown,
  withdrawFromAaveSupply,
  type AaveTxProgress,
} from "@/lib/aave/deposit";
import {
  depositWithFunding,
  maxFundableDepositAtomic,
  needsEthGas,
  sendAaveAssetToSolana,
  type SolanaSigner,
} from "@/lib/aave/fund";
import { cooldownPhase, formatDuration } from "@/lib/aave/math";
import type { AaveVault } from "@/lib/aave/vaults";

function fmtAmount(atomic: string | bigint | undefined, decimals = 6, digits = 2): string {
  if (atomic == null) return "0";
  return Number(formatUnits(BigInt(atomic), decimals)).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function fmtPct(rate: number | null | undefined): string {
  return rate == null ? "—" : `${(rate * 100).toFixed(2)}%`;
}

// ── Live data ───────────────────────────────────────────────────────────────

export interface AaveWalletState {
  usdcBalanceAtomic: string;
  usdtBalanceAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
  blockTimestamp: number;
}

export interface AaveEarn {
  metrics: Map<string, AaveVaultMetric>;
  positions: Map<string, AavePosition>;
  wallet: AaveWalletState;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  // The Solana wallet, as a signer for the Trustware funding legs.
  solanaSigner: SolanaSigner | undefined;
  refresh: () => Promise<void>;
}

const EMPTY_WALLET: AaveWalletState = {
  usdcBalanceAtomic: "0",
  usdtBalanceAtomic: "0",
  ethBalanceAtomic: "0",
  gasPriceWei: "0",
  blockTimestamp: 0,
};

// Owned by the Vaults table rather than by an Aave component, because the
// table needs the rates to draw the Aave column whether or not any row is
// expanded.
export function useAaveEarn(walletAddress: string | undefined): AaveEarn {
  const evm = useEmbeddedEvmWallet();
  const sendSolanaTx = useSendSolanaTxBase64();
  const [metrics, setMetrics] = useState<Map<string, AaveVaultMetric>>(new Map());
  const [positions, setPositions] = useState<Map<string, AavePosition>>(new Map());
  const [wallet, setWallet] = useState<AaveWalletState>(EMPTY_WALLET);

  const solanaSigner = useMemo<SolanaSigner | undefined>(
    () =>
      walletAddress
        ? { address: walletAddress, signAndSendBase64: sendSolanaTx }
        : undefined,
    [walletAddress, sendSolanaTx],
  );

  const refresh = useCallback(async () => {
    try {
      setMetrics(await fetchAaveMetrics());
    } catch (err) {
      console.error("[aave metrics]", err);
    }
    if (evm.address) {
      try {
        const res = await fetchAavePositions(evm.address);
        setPositions(res.positions);
        setWallet({
          usdcBalanceAtomic: res.usdcBalanceAtomic,
          usdtBalanceAtomic: res.usdtBalanceAtomic,
          ethBalanceAtomic: res.ethBalanceAtomic,
          gasPriceWei: res.gasPriceWei,
          blockTimestamp: res.blockTimestamp,
        });
      } catch (err) {
        console.error("[aave positions]", err);
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

  return { metrics, positions, wallet, evm, solanaSigner, refresh };
}

// The vault whose rate the venue column shows: the best-paying of the set.
// Falls back to the first vault so the cell can still name a venue while the
// read is in flight. A paused Umbrella vault is skipped: it takes no deposits,
// so its rate is not one the user can get.
export function aaveBestVault(
  vaults: readonly AaveVault[],
  metrics: Map<string, AaveVaultMetric>,
): { vault: AaveVault; metric: AaveVaultMetric | undefined } | null {
  if (vaults.length === 0) return null;
  let best = vaults[0];
  let bestApy = -Infinity;
  for (const v of vaults) {
    const m = metrics.get(v.address.toLowerCase());
    if (!m || m.paused) continue;
    if (m.totalApy > bestApy) {
      bestApy = m.totalApy;
      best = v;
    }
  }
  return { vault: best, metric: metrics.get(best.address.toLowerCase()) };
}

// Everything the wallet holds across the asset's Aave vaults, in asset atomic.
export function aaveTotalPositionAtomic(
  vaults: readonly AaveVault[],
  positions: Map<string, AavePosition>,
): bigint {
  let total = 0n;
  for (const v of vaults) {
    const p = positions.get(v.address.toLowerCase());
    if (p) total += BigInt(p.assetsAtomic);
  }
  return total;
}

export function aavePositionAtomic(
  vault: AaveVault,
  positions: Map<string, AavePosition>,
): string {
  return positions.get(vault.address.toLowerCase())?.assetsAtomic ?? "0";
}

export function aaveVaultApy(
  vault: AaveVault,
  metrics: Map<string, AaveVaultMetric>,
): number | null {
  return metrics.get(vault.address.toLowerCase())?.totalApy ?? null;
}

function walletAssetAtomic(vault: AaveVault, wallet: AaveWalletState): string {
  return vault.asset.symbol === "USDT" ? wallet.usdtBalanceAtomic : wallet.usdcBalanceAtomic;
}

// ── Venue panel ─────────────────────────────────────────────────────────────

// What the expanded row shows once Aave is the selected venue: which vault,
// then the form for it.
export function AaveVenuePanel({
  vaults,
  earn,
  selected,
  onSelect,
  mode,
  solanaUsdcAtomic,
  solanaAddress,
  onSettled,
}: {
  vaults: readonly AaveVault[];
  earn: AaveEarn;
  selected: AaveVault;
  onSelect: (vault: AaveVault) => void;
  mode: "deposit" | "withdraw";
  // Solana USDC available to fund a shortfall, 6-decimal atomic.
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  onSettled: () => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {vaults.map((v) => {
          const metric = earn.metrics.get(v.address.toLowerCase());
          const held = BigInt(aavePositionAtomic(v, earn.positions));
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
                xstock={{ symbol: "AAVE", name: "Aave", logo: VENUE_LOGOS.aave }}
                size={26}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-white">{v.name}</div>
                <div className="truncate text-[11px] text-white/50">
                  {v.kind === "umbrella"
                    ? `Staked, ${
                        metric ? formatDuration(metric.cooldownSeconds) : "20 day"
                      } cooldown to exit`
                    : "Withdraw any time"}
                  {metric?.paused && (
                    <span className="ml-1.5 text-aeras-warning">Paused by Aave</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm tabular-nums text-white">
                  {fmtPct(metric?.totalApy)}
                </div>
                <div className="font-mono text-[10px] tabular-nums text-white/50">
                  {held > 0n
                    ? `${fmtAmount(held)} deposited`
                    : metric?.tvlUsd != null
                      ? `$${Math.round(metric.tvlUsd).toLocaleString()} TVL`
                      : "—"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <AaveVaultForm
        key={`${selected.address}-${mode}`}
        mode={mode}
        vault={selected}
        metric={earn.metrics.get(selected.address.toLowerCase())}
        position={earn.positions.get(selected.address.toLowerCase())}
        wallet={earn.wallet}
        solanaUsdcAtomic={solanaUsdcAtomic}
        solanaAddress={solanaAddress}
        solanaSigner={earn.solanaSigner}
        evm={earn.evm}
        onSettled={onSettled}
      />
    </div>
  );
}

// ── per-vault form ──────────────────────────────────────────────────────────

type FormState =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "done"; txHash: string | null; message: string }
  | { kind: "error"; message: string };

function AaveVaultForm({
  mode,
  vault,
  metric,
  position,
  wallet,
  solanaUsdcAtomic,
  solanaAddress,
  solanaSigner,
  evm,
  onSettled,
}: {
  // Driven by the shared deposit/withdraw switch on the expanded row.
  // Remounted on a change, so there is no stale amount to clear.
  mode: "deposit" | "withdraw";
  vault: AaveVault;
  metric: AaveVaultMetric | undefined;
  position: AavePosition | undefined;
  wallet: AaveWalletState;
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  solanaSigner: SolanaSigner | undefined;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  onSettled: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const decimals = vault.asset.decimals;
  const symbol = vault.asset.symbol;
  const isUmbrella = vault.kind === "umbrella";

  const onEthereum = walletAssetAtomic(vault, wallet);
  const positionAtomic = position?.assetsAtomic ?? "0";
  const positionShares = BigInt(position?.sharesAtomic ?? "0");

  // Umbrella exit state, judged against the chain's clock.
  const phase = useMemo(() => {
    if (!isUmbrella || !position?.cooldown) return { phase: "none" as const };
    return cooldownPhase(
      {
        amount: BigInt(position.cooldown.amount),
        endOfCooldown: position.cooldown.endOfCooldown,
        withdrawalWindow: position.cooldown.withdrawalWindow,
      },
      wallet.blockTimestamp,
    );
  }, [isUmbrella, position, wallet.blockTimestamp]);

  // Assets behind the cooldown snapshot: the snapshot is in shares, and the
  // position read gives the shares-to-assets ratio for the whole balance.
  const snapshotShares = phase.phase === "window" ? phase.shares : 0n;
  const snapshotAssets =
    positionShares > 0n ? (BigInt(positionAtomic) * snapshotShares) / positionShares : 0n;

  // Deposits can draw on the Solana balance through the funding leg, so the
  // ceiling is not just what already sits on Ethereum. Withdrawals from a
  // supply vault are capped by the reserve's free liquidity; from Umbrella by
  // the cooldown snapshot, and only inside the window.
  const withdrawable = BigInt(position?.withdrawableAtomic ?? "0");
  const maxAtomic =
    mode === "deposit"
      ? BigInt(
          maxFundableDepositAtomic({
            walletAssetAtomic: onEthereum,
            solanaUsdcAtomic: solanaSigner ? solanaUsdcAtomic : "0",
            ethBalanceAtomic: wallet.ethBalanceAtomic,
            gasPriceWei: wallet.gasPriceWei,
          }),
        )
      : isUmbrella
        ? snapshotAssets
        : withdrawable < BigInt(positionAtomic)
          ? withdrawable
          : BigInt(positionAtomic);
  const maxUi = Number(formatUnits(maxAtomic, decimals));
  const useSlider = maxUi > 0;

  const amountAtomic = (() => {
    try {
      return input ? parseUnits(input, decimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const shortfallAtomic =
    mode === "deposit" && amountAtomic > BigInt(onEthereum)
      ? amountAtomic - BigInt(onEthereum)
      : 0n;
  const overLimit = amountAtomic > maxAtomic;
  const busy = state.kind === "busy";
  const gasShort = needsEthGas(wallet.ethBalanceAtomic, wallet.gasPriceWei);
  const paused = Boolean(metric?.paused);
  const liquidityCapped =
    mode === "withdraw" && !isUmbrella && withdrawable < BigInt(positionAtomic);
  // A full exit redeems shares directly, avoiding asset-rounding dust.
  const redeemAll =
    mode === "withdraw" && amountAtomic > 0n && amountAtomic >= maxAtomic;

  const disabled =
    busy ||
    !evm.ready ||
    (mode === "deposit" && (amountAtomic <= 0n || overLimit || paused)) ||
    (mode === "withdraw" && (amountAtomic <= 0n || overLimit));

  const onProgress = (p: AaveTxProgress) => setState({ kind: "busy", message: p.message });

  function signer() {
    if (!evm.address) throw new Error("No embedded EVM wallet available.");
    return { address: evm.address, switchChain: evm.switchChain, getProvider: evm.getProvider };
  }

  async function run(label: string, action: () => Promise<string | null>, doneMessage: string) {
    setState({ kind: "busy", message: label });
    try {
      const txHash = await action();
      setState({ kind: "done", txHash, message: doneMessage });
      setInput("");
      await onSettled();
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const handleSubmit = () =>
    mode === "deposit"
      ? run(
          "Preparing…",
          async () =>
            (
              await depositWithFunding({
                vault,
                amountAtomic,
                walletAssetAtomic: onEthereum,
                solanaUsdcAtomic,
                ethBalanceAtomic: wallet.ethBalanceAtomic,
                gasPriceWei: wallet.gasPriceWei,
                signer: signer(),
                solana: solanaSigner,
                onProgress,
              })
            ).txHash,
          "Deposit confirmed",
        )
      : isUmbrella
        ? run(
            "Preparing…",
            () =>
              redeemFromUmbrella({
                vault,
                // Max redeems the exact snapshot; anything less is prorated.
                sharesAtomic: redeemAll
                  ? snapshotShares
                  : snapshotAssets > 0n
                    ? (snapshotShares * amountAtomic) / snapshotAssets
                    : 0n,
                signer: signer(),
                onProgress,
              }),
            "Withdrawal confirmed",
          )
        : run(
            "Preparing…",
            () =>
              withdrawFromAaveSupply({
                vault,
                amountAtomic,
                redeemAll: redeemAll && !liquidityCapped,
                signer: signer(),
                onProgress,
              }),
            "Withdrawal confirmed",
          );

  const cooldownDays = metric ? formatDuration(metric.cooldownSeconds) : "20 days";
  const windowLength = metric ? formatDuration(metric.unstakeWindowSeconds) : "2 days";

  // Umbrella withdrawals are a state machine, not a form, until the window is
  // open. Everything below the position summary swaps on the phase.
  const umbrellaExit =
    mode === "withdraw" && isUmbrella ? (
      <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-[11px] text-white/60">
        {phase.phase === "none" && (
          <>
            <p>
              Leaving Umbrella takes {cooldownDays}. Start the cooldown now; after it
              ends you have {windowLength} to withdraw. The deposit keeps earning
              through the cooldown and stays slashable until it is out.
            </p>
            <button
              type="button"
              disabled={busy || !evm.ready || positionShares <= 0n}
              onClick={() =>
                run(
                  "Preparing…",
                  () => startUmbrellaCooldown({ vault, signer: signer(), onProgress }),
                  "Cooldown started",
                )
              }
              className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? state.message : `Start ${cooldownDays} cooldown`}
            </button>
          </>
        )}
        {phase.phase === "cooling" && (
          <p>
            Cooldown in progress.{" "}
            <span className="text-white">
              Withdrawable in{" "}
              {formatDuration(phase.redeemableAt - wallet.blockTimestamp)}
            </span>
            , then open for {windowLength}. Only the{" "}
            {fmtAmount(snapshotAssetsFor(phase.shares))} {symbol} snapshotted when
            the cooldown started can be withdrawn in that window.
          </p>
        )}
        {phase.phase === "window" && (
          <p>
            <span className="text-aeras-positive">Withdrawal window open.</span> It
            closes in {formatDuration(phase.windowEndsAt - wallet.blockTimestamp)}.
            Up to {fmtAmount(snapshotAssets)} {symbol} can leave now; anything
            not withdrawn needs a new cooldown.
          </p>
        )}
        {phase.phase === "expired" && (
          <>
            <p className="text-aeras-warning">
              The last withdrawal window closed without a withdrawal. Start a new
              {" "}{cooldownDays} cooldown to withdraw.
            </p>
            <button
              type="button"
              disabled={busy || !evm.ready}
              onClick={() =>
                run(
                  "Preparing…",
                  () => startUmbrellaCooldown({ vault, signer: signer(), onProgress }),
                  "Cooldown started",
                )
              }
              className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? state.message : `Start ${cooldownDays} cooldown`}
            </button>
          </>
        )}
      </div>
    ) : null;

  function snapshotAssetsFor(shares: bigint): bigint {
    return positionShares > 0n ? (BigInt(positionAtomic) * shares) / positionShares : 0n;
  }

  const showAmountField = mode === "deposit" || !isUmbrella || phase.phase === "window";

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      {isUmbrella && metric && (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-white/50">Aave supply rate</div>
            <div className="mt-0.5 font-mono text-sm tabular-nums text-white">
              {fmtPct(metric.supplyApy)}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-white/50">Safety incentives</div>
            <div className="mt-0.5 font-mono text-sm tabular-nums text-aeras-positive">
              +{fmtPct(metric.rewardApr)}
            </div>
          </div>
        </div>
      )}

      {umbrellaExit}

      {showAmountField && (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
              {mode === "deposit" ? "Deposit" : "Withdraw"} {symbol}
            </label>
            <span className="font-mono text-[11px] text-white/50">
              {maxUi.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              {mode === "deposit" ? "available" : "withdrawable"}
              <button
                type="button"
                onClick={() => {
                  setInput(formatUnits(maxAtomic, decimals));
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
                  {input || "0"} <span className="text-xs text-white/50">{symbol}</span>
                </span>
                <span className="font-mono text-[11px] text-white/50">
                  {maxUi > 0 ? `${Math.round(((Number(input) || 0) / maxUi) * 100)}%` : "0%"}
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
                  setInput(v >= maxUi ? formatUnits(maxAtomic, decimals) : String(v));
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
                {symbol}
              </span>
            </div>
          )}
        </div>
      )}

      {mode === "deposit" && amountAtomic > 0n && !overLimit && (shortfallAtomic > 0n || gasShort) && (
        <p className="text-[11px] text-white/60">
          {shortfallAtomic > 0n && (
            <>
              {fmtAmount(shortfallAtomic, decimals)} {symbol} of this comes from your
              Solana USDC, converted to Ethereum through Trustware before the deposit.{" "}
            </>
          )}
          {gasShort && (
            <>
              Some Solana USDC also buys ETH so the wallet can pay Ethereum gas for
              this deposit and a later withdrawal; the amount is priced from the live
              gas price before you sign.{" "}
            </>
          )}
          Bridging takes a few minutes.
        </p>
      )}
      {mode === "deposit" && paused && (
        <p className="text-[11px] text-aeras-warning">
          Aave has paused this stake token. It takes no deposits until governance
          unpauses it.
        </p>
      )}
      {liquidityCapped && (
        <p className="text-[11px] text-aeras-warning">
          The Aave reserve can pay out {fmtAmount(withdrawable, decimals)} {symbol}{" "}
          right now. Withdraw the rest once borrowers repay.
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
          Amount is above the {mode === "deposit" ? "available" : "withdrawable"} limit.
        </p>
      )}
      {state.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {state.message}
        </p>
      )}
      {state.kind === "done" && (
        <a
          href={state.txHash ? `${ETHEREUM_EXPLORER_TX_BASE}${state.txHash}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">{state.message}</div>
          {state.txHash && (
            <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
              {state.txHash}
            </div>
          )}
        </a>
      )}

      {showAmountField && (
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
              : `Withdraw ${symbol}`}
        </button>
      )}

      {isUmbrella && position && (
        <RewardsBlock
          vault={vault}
          metric={metric}
          position={position}
          busy={busy}
          ready={evm.ready}
          onClaim={(restake) =>
            run(
              "Preparing…",
              () => claimUmbrellaRewards({ vault, restake, signer: signer(), onProgress }),
              restake ? "Rewards claimed and restaked" : "Rewards claimed",
            )
          }
        />
      )}

      {BigInt(onEthereum) > 0n && solanaAddress && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px]">
          <div className="text-white/60">
            <span className="font-mono tabular-nums text-white">
              {fmtAmount(onEthereum, decimals)} {symbol}
            </span>{" "}
            in your Ethereum wallet, not deposited.
          </div>
          <button
            type="button"
            disabled={busy || !evm.ready}
            onClick={() =>
              run(
                "Preparing…",
                async () => {
                  await sendAaveAssetToSolana({
                    vault,
                    amountAtomic: BigInt(onEthereum),
                    walletAssetAtomic: onEthereum,
                    ethBalanceAtomic: wallet.ethBalanceAtomic,
                    gasPriceWei: wallet.gasPriceWei,
                    evm: signer(),
                    solanaAddress,
                    onProgress,
                  });
                  return null;
                },
                "USDC arrived on Solana",
              )
            }
            className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-white/80 transition-colors hover:border-white/30 hover:text-white disabled:opacity-40"
          >
            Move to Solana
          </button>
        </div>
      )}

      <p className="text-[11px] text-white/50">
        {isUmbrella ? (
          <>
            {vault.name} stakes {symbol} in Aave&rsquo;s Umbrella safety module. It
            earns the Aave V3 supply rate plus safety incentives, and in return the
            deposit can be slashed to cover the protocol&rsquo;s bad debt. Leaving
            takes a {cooldownDays} cooldown and a {windowLength} window. This
            position settles on Ethereum, not on Solana.
          </>
        ) : (
          <>
            {vault.name} supplies {symbol} to the Aave V3 Core market on Ethereum
            through its ERC-4626 wrapper. The rate is variable and set by the
            reserve&rsquo;s utilisation. Withdraw any time the reserve has free
            liquidity. This position settles on Ethereum, not on Solana.
          </>
        )}
      </p>
    </div>
  );
}

// Pending safety incentives, and the two ways to take them.
function RewardsBlock({
  vault,
  metric,
  position,
  busy,
  ready,
  onClaim,
}: {
  vault: AaveVault;
  metric: AaveVaultMetric | undefined;
  position: AavePosition;
  busy: boolean;
  ready: boolean;
  onClaim: (restake: boolean) => void;
}) {
  const pending = position.rewards.filter((r) => BigInt(r.amountAtomic) > 0n);
  if (pending.length === 0) return null;
  const symbolOf = (token: string) =>
    metric?.rewards.find((s) => s.token.toLowerCase() === token.toLowerCase())?.symbol ??
    "reward";
  const restakeable = pending.some(
    (r) => r.token.toLowerCase() === vault.aToken.toLowerCase(),
  );
  return (
    <div className="space-y-2 rounded-lg border border-aeras-positive/25 bg-aeras-positive/10 px-3 py-2 text-[11px]">
      <div className="text-white/60">
        Pending rewards:{" "}
        {pending.map((r, i) => (
          <span key={r.token} className="font-mono tabular-nums text-white">
            {i > 0 && ", "}
            {fmtAmount(r.amountAtomic, r.decimals, 4)} {symbolOf(r.token)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => onClaim(false)}
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-white/80 transition-colors hover:border-white/30 hover:text-white disabled:opacity-40"
        >
          Claim to wallet
        </button>
        <button
          type="button"
          disabled={busy || !ready || !restakeable}
          title={restakeable ? undefined : "This reward token cannot be restaked here"}
          onClick={() => onClaim(true)}
          className="rounded-full bg-aeras-blue px-3 py-1.5 text-white transition-colors hover:bg-aeras-blue-medium disabled:opacity-40"
        >
          Claim and restake
        </button>
      </div>
      <p className="text-white/50">
        Rewards are paid as the reserve&rsquo;s aToken. Claimed to the wallet they
        keep earning the supply rate but not the incentives; restaking puts them
        back in the vault.
      </p>
    </div>
  );
}
