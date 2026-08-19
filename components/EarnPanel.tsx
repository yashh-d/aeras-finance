"use client";

// Earn surface. Three sub-products laid out per design.md "institutional lending
// terminal" feel: yield Vaults (Jupiter Lend Earn and Kamino Earn vaults),
// Looping (recursive borrow against collateral), and direct Lend.
//
// Vaults carry two venues per asset. They are not the same kind of product:
// Jupiter Lend is a single protocol-native vault per asset, while a Kamino
// K-Vault is a curator-run strategy that allocates across Kamino Lend reserves.
// Kamino usually pays more and does not cover every asset, so the rows show
// both rates side by side rather than picking one. Looping (multiply / unwind)
// lives in LoopingPanel. Morpho and Aave are not on this surface: both are
// EVM-only lending protocols, so they need an EVM wallet and a bridge before
// they can be wired up. See the Stage 2 notes in the PR description.

import { useCallback, useEffect, useState } from "react";
import BN from "bn.js";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import {
  EARN_ASSETS,
  buildEarnDepositTx,
  buildEarnRedeemAllTx,
  buildEarnWithdrawTx,
  depositableAtomic,
  fetchEarnVaultsViaProxy,
  fetchEarnWalletBalances,
  positionAssetsAtomic,
  sharesAtomic,
  uiToAtomic,
  type EarnAssetMeta,
  type EarnVaultState,
  type EarnWalletBalances,
} from "@/lib/jupiter/earn";
import {
  RATIO_PRECISION,
  buildKaminoVaultTx,
  fetchKaminoPositionsViaProxy,
  fetchKaminoVaultsViaProxy,
  kaminoVaultByAsset,
  sharesToTokensAtomic,
  tokensToSharesAtomic,
  type KaminoPosition,
  type KaminoVaultMeta,
  type KaminoVaultState,
} from "@/lib/kamino/kvaults";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  getConnection,
  type AccountBalances,
} from "@/lib/solana/balances";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { LoopingCard } from "@/components/LoopingPanel";
import { RyskOptionsCard } from "@/components/RyskOptionsPanel";

interface Props {
  walletAddress: string | undefined;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void>;
}

export function EarnPanel({ walletAddress, balances, prices, onRefresh }: Props) {
  const { vaults, error: vaultsError } = useEarnVaults();
  const { vaults: kaminoVaults } = useKaminoVaults();
  const { balances: earnBalances, refresh: refreshBalances } =
    useEarnBalances(walletAddress);
  const { positions: kaminoPositions, refresh: refreshKamino } =
    useKaminoPositions(walletAddress);

  const handleSettled = useCallback(async () => {
    await Promise.all([onRefresh(), refreshBalances(), refreshKamino()]);
  }, [onRefresh, refreshBalances, refreshKamino]);

  return (
    <div className="space-y-6">
      <PageHeader />
      <VaultsCard
        vaults={vaults}
        kaminoVaults={kaminoVaults}
        kaminoPositions={kaminoPositions}
        vaultsError={vaultsError}
        balances={earnBalances}
        walletAddress={walletAddress}
        onSettled={handleSettled}
      />
      <LoopingCard
        walletAddress={walletAddress}
        balances={balances}
        prices={prices}
        onRefresh={handleSettled}
      />
      <RyskOptionsCard />
    </div>
  );
}

function PageHeader() {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
        Earn
      </div>
      <h2 className="font-light text-2xl tracking-tight text-aeras-900">
        Put idle capital to work
      </h2>
      <p className="text-sm text-aeras-300">
        Three ways to earn yield on assets you already hold: vault deposits,
        leveraged looping, and selling options.
      </p>
    </div>
  );
}

// ── Data ───────────────────────────────────────────────────────────────────

const VAULT_POLL_MS = 60_000;

function useEarnVaults(): {
  vaults: Map<string, EarnVaultState>;
  error: string | null;
} {
  const [vaults, setVaults] = useState<Map<string, EarnVaultState>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await fetchEarnVaultsViaProxy();
        if (cancelled) return;
        setVaults(new Map(list.map((v) => [v.assetMint, v])));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("[useEarnVaults]", err);
        setError("Live vault rates are unavailable right now.");
      }
    }
    load();
    const id = setInterval(load, VAULT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { vaults, error };
}

// Kamino rates are polled on the same cadence as Jupiter's. A failure here is
// deliberately quiet: the Kamino column falls back to a dash and the Jupiter
// side of every row keeps working, which is better than an error banner over a
// card that is still half usable.
function useKaminoVaults(): { vaults: Map<string, KaminoVaultState> } {
  const [vaults, setVaults] = useState<Map<string, KaminoVaultState>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await fetchKaminoVaultsViaProxy();
        if (cancelled) return;
        setVaults(new Map(list.map((v) => [v.address, v])));
      } catch (err) {
        console.error("[useKaminoVaults]", err);
      }
    }
    load();
    const id = setInterval(load, VAULT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { vaults };
}

// K-Vault positions come from Kamino's API rather than the wallet's token
// accounts. A deposit auto-stakes its shares into the vault's farm in the same
// transaction, so the share-token balance reads zero while the position is
// live.
function useKaminoPositions(walletAddress: string | undefined): {
  positions: Map<string, KaminoPosition>;
  refresh: () => Promise<void>;
} {
  const [positions, setPositions] = useState<Map<string, KaminoPosition>>(
    new Map(),
  );

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setPositions(new Map());
      return;
    }
    try {
      setPositions(await fetchKaminoPositionsViaProxy(walletAddress));
    } catch (err) {
      console.error("[useKaminoPositions]", err);
    }
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!walletAddress) return;
      try {
        const next = await fetchKaminoPositionsViaProxy(walletAddress);
        if (!cancelled) setPositions(next);
      } catch (err) {
        console.error("[useKaminoPositions]", err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return { positions, refresh };
}

function useEarnBalances(walletAddress: string | undefined): {
  balances: EarnWalletBalances | null;
  refresh: () => Promise<void>;
} {
  const [balances, setBalances] = useState<EarnWalletBalances | null>(null);

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setBalances(null);
      return;
    }
    try {
      const next = await fetchEarnWalletBalances(walletAddress, getConnection());
      setBalances(next);
    } catch (err) {
      // Non-fatal: the rows still render, Max and the position column just go
      // quiet until the next successful read.
      console.error("[useEarnBalances]", err);
    }
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!walletAddress) return;
      try {
        const next = await fetchEarnWalletBalances(
          walletAddress,
          getConnection(),
        );
        if (!cancelled) setBalances(next);
      } catch (err) {
        console.error("[useEarnBalances]", err);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return { balances, refresh };
}

// ── Vaults ─────────────────────────────────────────────────────────────────

function VaultsCard({
  vaults,
  kaminoVaults,
  kaminoPositions,
  vaultsError,
  balances,
  walletAddress,
  onSettled,
}: {
  vaults: Map<string, EarnVaultState>;
  kaminoVaults: Map<string, KaminoVaultState>;
  kaminoPositions: Map<string, KaminoPosition>;
  vaultsError: string | null;
  balances: EarnWalletBalances | null;
  walletAddress: string | undefined;
  onSettled: () => Promise<void>;
}) {
  const [openMint, setOpenMint] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-aeras-hero-from to-aeras-hero-to p-5 lg:p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Vaults
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-white">
            Deposit, hold, earn
          </div>
        </div>
        <div className="text-[11px] text-white/50">Two venues per asset</div>
      </div>

      {vaultsError && (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-warning">
          {vaultsError}
        </p>
      )}

      <div className="mt-5 divide-y divide-white/10">
        <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          <div className="col-span-3">Asset</div>
          <div className="col-span-3 text-right">Jupiter Lend</div>
          <div className="col-span-3 text-right">Kamino</div>
          <div className="col-span-2 text-right">Your deposit</div>
          <div className="col-span-1" />
        </div>
        {EARN_ASSETS.map((meta) => {
          const kaminoMeta = kaminoVaultByAsset(meta.assetMint);
          return (
            <VaultRow
              key={meta.assetMint}
              meta={meta}
              vault={vaults.get(meta.assetMint)}
              kaminoMeta={kaminoMeta}
              kaminoVault={
                kaminoMeta ? kaminoVaults.get(kaminoMeta.address) : undefined
              }
              kaminoPosition={
                kaminoMeta ? kaminoPositions.get(kaminoMeta.address) : undefined
              }
              balances={balances}
              walletAddress={walletAddress}
              open={openMint === meta.assetMint}
              onToggle={() =>
                setOpenMint((cur) =>
                  cur === meta.assetMint ? null : meta.assetMint,
                )
              }
              onSettled={onSettled}
            />
          );
        })}
      </div>

      <p className="mt-4 text-[11px] text-white/50">
        Deposits earn a variable rate that moves with vault utilization.
        Withdrawals are subject to available vault liquidity. Jupiter Lend
        vaults are protocol-native. Kamino vaults are run by third-party
        curators who choose which Kamino Lend reserves the deposit is allocated
        to, and each one sets its own fees and risk limits.
      </p>
    </div>
  );
}

type Venue = "jupiter" | "kamino";

function VaultRow({
  meta,
  vault,
  kaminoMeta,
  kaminoVault,
  kaminoPosition,
  balances,
  walletAddress,
  open,
  onToggle,
  onSettled,
}: {
  meta: EarnAssetMeta;
  vault: EarnVaultState | undefined;
  kaminoMeta: KaminoVaultMeta | undefined;
  kaminoVault: KaminoVaultState | undefined;
  kaminoPosition: KaminoPosition | undefined;
  balances: EarnWalletBalances | null;
  walletAddress: string | undefined;
  open: boolean;
  onToggle: () => void;
  onSettled: () => Promise<void>;
}) {
  const shares = sharesAtomic(meta, balances);
  const positionAtomic = positionAssetsAtomic(shares, vault, meta.decimals);
  const positionUi = Number(
    atomicToUiString(positionAtomic.toString(), meta.decimals),
  );

  const kaminoShares = kaminoPosition?.totalSharesAtomic ?? "0";
  const kaminoPositionAtomic = kaminoMeta
    ? sharesToTokensAtomic(kaminoShares, kaminoVault, kaminoMeta)
    : "0";
  const kaminoPositionUi = Number(
    atomicToUiString(kaminoPositionAtomic, meta.decimals),
  );

  // Whichever venue pays more gets the green rate. This falls out of the data
  // rather than being asserted anywhere, so the USDT row correctly shows
  // Jupiter ahead without a special case.
  const jupiterApy = vault?.apy ?? null;
  const kaminoApy = kaminoVault?.apy ?? null;
  const jupiterLeads =
    jupiterApy !== null && (kaminoApy === null || jupiterApy >= kaminoApy);
  const kaminoLeads =
    kaminoApy !== null && (jupiterApy === null || kaminoApy > jupiterApy);

  const totalPositionUi = positionUi + kaminoPositionUi;
  const bothVenuesHeld = positionUi > 0 && kaminoPositionUi > 0;
  const decimalsShown = meta.decimals === 9 ? 4 : 2;

  // Default the expanded form to the venue the user already has money in, then
  // to the better rate. Derived rather than stored, so the default tracks a
  // rate flip until the user picks a venue explicitly.
  const [picked, setPicked] = useState<Venue | null>(null);
  const suggested: Venue =
    positionUi > 0 && kaminoPositionUi === 0
      ? "jupiter"
      : kaminoPositionUi > 0 && positionUi === 0
        ? "kamino"
        : kaminoLeads
          ? "kamino"
          : "jupiter";
  const kaminoUsable = Boolean(kaminoMeta && kaminoVault);
  const venue: Venue =
    picked === "kamino" && !kaminoUsable ? "jupiter" : (picked ?? suggested);

  const canOpen = Boolean((vault || kaminoUsable) && walletAddress);

  return (
    <div className="py-2.5">
      <div className="grid grid-cols-12 items-center gap-2 text-sm">
        <div className="col-span-3">
          <div className="font-medium tracking-tight text-white">
            {meta.symbol}
          </div>
          <div className="text-[11px] text-white/50">{meta.name}</div>
        </div>

        <VenueCell
          apy={jupiterApy}
          leads={jupiterLeads}
          subtitle={vault ? `$${formatLargeUsd(vault.tvlUsd)} TVL` : null}
          note={
            vault && vault.rewardsApy > 0
              ? `incl. ${(vault.rewardsApy * 100).toFixed(2)}% rewards`
              : null
          }
        />

        <VenueCell
          apy={kaminoApy}
          leads={kaminoLeads}
          subtitle={
            kaminoVault ? `$${formatLargeUsd(kaminoVault.tvlUsd)} TVL` : null
          }
          note={kaminoMeta ? kaminoMeta.name : "No vault"}
        />

        <div className="col-span-2 text-right font-mono text-xs tabular-nums text-white">
          {totalPositionUi > 0 ? (
            <>
              {totalPositionUi.toFixed(decimalsShown)}
              <div className="text-[10px] text-white/50">
                {bothVenuesHeld
                  ? "2 venues"
                  : positionUi > 0
                    ? "Jupiter"
                    : "Kamino"}
              </div>
            </>
          ) : (
            <span className="text-white/40">—</span>
          )}
        </div>

        <div className="col-span-1 text-right">
          <button
            type="button"
            onClick={onToggle}
            disabled={!canOpen}
            aria-expanded={open}
            aria-label={open ? `Close ${meta.symbol}` : `Manage ${meta.symbol}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-xs text-white transition-colors hover:border-white/25 hover:bg-white/15 disabled:cursor-not-allowed disabled:text-white/30"
            title={!walletAddress ? "Waiting for wallet" : undefined}
          >
            <span
              className={`transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            >
              ⌄
            </span>
          </button>
        </div>
      </div>

      {open && walletAddress && (
        <div className="mt-3 space-y-3">
          <VenueTabs
            venue={venue}
            onPick={setPicked}
            jupiterApy={jupiterApy}
            kaminoApy={kaminoApy}
            kaminoName={kaminoMeta?.name}
            kaminoUsable={kaminoUsable}
            jupiterUsable={Boolean(vault)}
          />

          {venue === "jupiter" && vault && (
            <VaultForm
              meta={meta}
              vault={vault}
              balances={balances}
              walletAddress={walletAddress}
              onSettled={onSettled}
            />
          )}
          {venue === "kamino" && kaminoMeta && kaminoVault && (
            <KaminoVaultForm
              asset={meta}
              vaultMeta={kaminoMeta}
              vault={kaminoVault}
              sharesAtomic={kaminoShares}
              balances={balances}
              walletAddress={walletAddress}
              onSettled={onSettled}
            />
          )}
        </div>
      )}
    </div>
  );
}

function VenueCell({
  apy,
  leads,
  subtitle,
  note,
}: {
  apy: number | null;
  leads: boolean;
  subtitle: string | null;
  note: string | null;
}) {
  return (
    <div className="col-span-3 text-right">
      <span
        className={`font-mono tabular-nums ${
          apy === null
            ? "text-white/30"
            : leads
              ? "text-aeras-positive"
              : "text-white/70"
        }`}
      >
        {apy === null ? "—" : `${(apy * 100).toFixed(2)}%`}
      </span>
      {subtitle && (
        <div className="font-mono text-[10px] tabular-nums text-white/50">
          {subtitle}
        </div>
      )}
      {note && (
        <div className="truncate text-[10px] text-white/40" title={note}>
          {note}
        </div>
      )}
    </div>
  );
}

function VenueTabs({
  venue,
  onPick,
  jupiterApy,
  kaminoApy,
  kaminoName,
  kaminoUsable,
  jupiterUsable,
}: {
  venue: Venue;
  onPick: (v: Venue) => void;
  jupiterApy: number | null;
  kaminoApy: number | null;
  kaminoName: string | undefined;
  kaminoUsable: boolean;
  jupiterUsable: boolean;
}) {
  const options: Array<{
    id: Venue;
    label: string;
    apy: number | null;
    enabled: boolean;
  }> = [
    {
      id: "jupiter",
      label: "Jupiter Lend",
      apy: jupiterApy,
      enabled: jupiterUsable,
    },
    {
      id: "kamino",
      label: kaminoName ?? "Kamino",
      apy: kaminoApy,
      enabled: kaminoUsable,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={!o.enabled}
          onClick={() => onPick(o.id)}
          className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            venue === o.id
              ? "border-aeras-blue bg-aeras-blue/10"
              : "border-white/10 bg-white/5 hover:border-white/20"
          }`}
        >
          <div className="truncate text-[11px] text-white/60">{o.label}</div>
          <div className="font-mono text-sm tabular-nums text-white">
            {o.apy === null ? "Not available" : `${(o.apy * 100).toFixed(2)}%`}
          </div>
        </button>
      ))}
    </div>
  );
}

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

function VaultForm({
  meta,
  vault,
  balances,
  walletAddress,
  onSettled,
}: {
  meta: EarnAssetMeta;
  vault: EarnVaultState;
  balances: EarnWalletBalances | null;
  walletAddress: string;
  onSettled: () => Promise<void>;
}) {
  const signTxBase64 = useSignSolanaTxBase64();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [input, setInput] = useState("");
  // Set when the user hits Max on a full withdrawal, so we redeem the exact
  // share balance instead of an asset amount that rounds against them.
  const [redeemAll, setRedeemAll] = useState(false);
  const [state, setState] = useState<FormState>({ kind: "idle" });

  const walletAtomic = depositableAtomic(meta, balances);
  const shares = sharesAtomic(meta, balances);
  const positionAtomic = positionAssetsAtomic(shares, vault, meta.decimals);
  const vaultLiquidityAtomic = new BN(vault.withdrawableAtomic);
  const maxWithdrawAtomic = positionAtomic.gt(vaultLiquidityAtomic)
    ? vaultLiquidityAtomic
    : positionAtomic;

  const amountAtomic = uiToAtomic(input, meta.decimals);
  const limitAtomic = mode === "deposit" ? new BN(walletAtomic) : maxWithdrawAtomic;
  const overLimit = amountAtomic.gt(limitAtomic);
  // Slider withdrawals: the max the user can drag to, as a UI number. A slider
  // replaces the number box for withdrawals once a position exists.
  const maxWithdrawUi = Number(
    atomicToUiString(maxWithdrawAtomic.toString(), meta.decimals),
  );
  const useWithdrawSlider = mode === "withdraw" && positionAtomic.gtn(0);
  const submitting = state.kind === "submitting";
  const disabled = submitting || amountAtomic.lten(0) || overLimit;

  // A withdrawal the vault cannot currently fund in full. Worth calling out
  // rather than letting the transaction fail in simulation.
  const liquidityCapped =
    mode === "withdraw" && positionAtomic.gt(vaultLiquidityAtomic);

  function reset() {
    if (state.kind !== "idle") setState({ kind: "idle" });
  }

  function switchMode(next: "deposit" | "withdraw") {
    setMode(next);
    setInput("");
    setRedeemAll(false);
    setState({ kind: "idle" });
  }

  async function handleSubmit() {
    setState({ kind: "submitting" });
    try {
      const connection = getConnection();
      let base64Tx: string;
      if (mode === "deposit") {
        base64Tx = await buildEarnDepositTx({
          meta,
          amountAtomic,
          signerAddress: walletAddress,
          connection,
        });
      } else if (redeemAll) {
        base64Tx = await buildEarnRedeemAllTx({
          meta,
          sharesAtomicAmount: new BN(shares),
          signerAddress: walletAddress,
          connection,
        });
      } else {
        base64Tx = await buildEarnWithdrawTx({
          meta,
          amountAtomic,
          signerAddress: walletAddress,
          connection,
        });
      }

      const signed = await signTxBase64(base64Tx);
      const sig = await connection.sendRawTransaction(base64ToBytes(signed), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(sig, "confirmed");
      setState({ kind: "done", signature: sig });
      setInput("");
      setRedeemAll(false);
      await onSettled();
    } catch (err) {
      console.error("[earn submit]", err);
      setState({ kind: "error", message: readableError(err) });
    }
  }

  const balanceLabel =
    mode === "deposit"
      ? `${atomicToUiString(walletAtomic, meta.decimals)} in wallet`
      : `${atomicToUiString(maxWithdrawAtomic.toString(), meta.decimals)} available`;

  return (
    <div className="space-y-3">
      {positionAtomic.gtn(0) && (
        <VaultPositionSummary
          meta={meta}
          vault={vault}
          positionAtomic={positionAtomic}
        />
      )}
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
            {mode === "deposit" ? "Deposit" : "Withdraw"} {meta.symbol}
          </label>
          <span className="font-mono text-[11px] text-white/50">
            {balanceLabel}
            <button
              type="button"
              onClick={() => {
                const max =
                  mode === "deposit" ? walletAtomic : maxWithdrawAtomic.toString();
                setInput(atomicToUiString(max, meta.decimals));
                // Only a full-position withdrawal can redeem shares directly.
                setRedeemAll(
                  mode === "withdraw" && !positionAtomic.gt(vaultLiquidityAtomic),
                );
                reset();
              }}
              className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
            >
              Max
            </button>
          </span>
        </div>
        {useWithdrawSlider ? (
          <div className="space-y-2 rounded-lg border border-white/15 bg-white/5 px-3 py-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-lg tabular-nums text-white">
                {input || "0"}{" "}
                <span className="text-xs text-white/50">{meta.symbol}</span>
              </span>
              <span className="font-mono text-[11px] text-white/50">
                {maxWithdrawUi > 0
                  ? `${Math.round(((Number(input) || 0) / maxWithdrawUi) * 100)}%`
                  : "0%"}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={maxWithdrawUi}
              step={Math.max(maxWithdrawUi / 100, 1e-6)}
              value={Math.min(Number(input) || 0, maxWithdrawUi)}
              onChange={(e) => {
                const v = Number(e.target.value);
                const atMax = v >= maxWithdrawUi;
                const atomic = atMax
                  ? maxWithdrawAtomic.toString()
                  : uiToAtomic(String(v), meta.decimals).toString();
                setInput(atomicToUiString(atomic, meta.decimals));
                // Only a full-position withdrawal can redeem shares directly.
                setRedeemAll(atMax && !positionAtomic.gt(vaultLiquidityAtomic));
                reset();
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
                setRedeemAll(false);
                reset();
              }}
              className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
              {meta.symbol}
            </span>
          </div>
        )}
      </div>

      {meta.isNativeSol && mode === "deposit" && (
        <p className="text-[11px] text-white/50">
          Max leaves 0.015 SOL in your wallet to cover transaction fees.
        </p>
      )}

      {liquidityCapped && (
        <p className="text-[11px] text-aeras-warning">
          The vault can currently pay out{" "}
          {atomicToUiString(vaultLiquidityAtomic.toString(), meta.decimals)}{" "}
          {meta.symbol}. Withdraw the rest once liquidity refills.
        </p>
      )}

      {overLimit && (
        <p className="text-[11px] text-aeras-negative">
          Amount is above the {mode === "deposit" ? "balance" : "available"}{" "}
          limit.
        </p>
      )}

      {state.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {state.message}
        </p>
      )}
      {state.kind === "done" && (
        <a
          href={`${SOLSCAN_TX_BASE}${state.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">
            {mode === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed"}
          </div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
            {state.signature}
          </div>
        </a>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={handleSubmit}
        className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? "Signing and submitting…"
          : mode === "deposit"
            ? `Deposit ${meta.symbol}`
            : `Withdraw ${meta.symbol}`}
      </button>
      </div>
    </div>
  );
}

// ── Kamino vault form ──────────────────────────────────────────────────────

// Mechanically different enough from VaultForm to be its own component rather
// than a branch inside it. Three things differ and each one is a correctness
// issue, not a styling one:
//
//  1. The transaction is built by Kamino's KTX API, not a local SDK.
//  2. Withdrawals are denominated in SHARES. The field asks for tokens, so the
//     amount is converted before it is sent.
//  3. Positions come from the API, because deposits auto-stake the shares.
function KaminoVaultForm({
  asset,
  vaultMeta,
  vault,
  sharesAtomic: positionSharesAtomic,
  balances,
  walletAddress,
  onSettled,
}: {
  asset: EarnAssetMeta;
  vaultMeta: KaminoVaultMeta;
  vault: KaminoVaultState;
  sharesAtomic: string;
  balances: EarnWalletBalances | null;
  walletAddress: string;
  onSettled: () => Promise<void>;
}) {
  const signTxBase64 = useSignSolanaTxBase64();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [input, setInput] = useState("");
  // Set when the user hits Max on a withdrawal, so we redeem the exact share
  // balance rather than a token amount converted back into shares. The round
  // trip through tokens would leave share dust behind.
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [state, setState] = useState<FormState>({ kind: "idle" });

  const walletAtomic = depositableAtomic(asset, balances);
  const positionAtomic = sharesToTokensAtomic(
    positionSharesAtomic,
    vault,
    vaultMeta,
  );

  const amountAtomic = uiToAtomic(input, asset.decimals);
  const limitAtomic = new BN(
    mode === "deposit" ? walletAtomic : positionAtomic,
  );
  const overLimit = amountAtomic.gt(limitAtomic);
  // Slider withdrawals: max the user can drag to (their full deposit), as a UI
  // number. Replaces the number box for withdrawals once a position exists.
  const maxWithdrawUi = Number(
    atomicToUiString(positionAtomic, asset.decimals),
  );
  const useWithdrawSlider = mode === "withdraw" && positionAtomic !== "0";
  const belowMinimum =
    mode === "deposit" &&
    amountAtomic.gtn(0) &&
    amountAtomic.lt(new BN(vaultMeta.minDepositAtomic));
  const submitting = state.kind === "submitting";
  const disabled =
    submitting || amountAtomic.lten(0) || overLimit || belowMinimum;

  function reset() {
    if (state.kind !== "idle") setState({ kind: "idle" });
  }

  function switchMode(next: "deposit" | "withdraw") {
    setMode(next);
    setInput("");
    setWithdrawAll(false);
    setState({ kind: "idle" });
  }

  async function handleSubmit() {
    setState({ kind: "submitting" });
    try {
      // Deposits are priced in the underlying token. Withdrawals are priced in
      // shares, so the typed token amount is converted, and a full exit uses
      // the exact share balance.
      const sendAtomic =
        mode === "deposit"
          ? amountAtomic.toString()
          : withdrawAll
            ? positionSharesAtomic
            : tokensToSharesAtomic(
                amountAtomic.toString(),
                vault,
                vaultMeta,
              );

      if (sendAtomic === "0") {
        throw new Error("Amount rounds to zero shares.");
      }

      const base64Tx = await buildKaminoVaultTx({
        action: mode,
        walletAddress,
        vault: vaultMeta,
        amountAtomic: sendAtomic,
      });

      const connection = getConnection();
      const signed = await signTxBase64(base64Tx);
      const sig = await connection.sendRawTransaction(base64ToBytes(signed), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(sig, "confirmed");
      setState({ kind: "done", signature: sig });
      setInput("");
      setWithdrawAll(false);
      await onSettled();
    } catch (err) {
      console.error("[kamino vault submit]", err);
      setState({ kind: "error", message: readableError(err) });
    }
  }

  const balanceLabel =
    mode === "deposit"
      ? `${atomicToUiString(walletAtomic, asset.decimals)} in wallet`
      : `${atomicToUiString(positionAtomic, asset.decimals)} deposited`;

  return (
    <div className="space-y-3">
      {positionAtomic !== "0" && (
        <KaminoPositionSummary
          asset={asset}
          vaultMeta={vaultMeta}
          vault={vault}
          positionAtomic={positionAtomic}
        />
      )}

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
              {mode === "deposit" ? "Deposit" : "Withdraw"} {asset.symbol}
            </label>
            <span className="font-mono text-[11px] text-white/50">
              {balanceLabel}
              <button
                type="button"
                onClick={() => {
                  const max =
                    mode === "deposit" ? walletAtomic : positionAtomic;
                  setInput(atomicToUiString(max, asset.decimals));
                  setWithdrawAll(mode === "withdraw");
                  reset();
                }}
                className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
              >
                Max
              </button>
            </span>
          </div>
          {useWithdrawSlider ? (
            <div className="space-y-2 rounded-lg border border-white/15 bg-white/5 px-3 py-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-lg tabular-nums text-white">
                  {input || "0"}{" "}
                  <span className="text-xs text-white/50">{asset.symbol}</span>
                </span>
                <span className="font-mono text-[11px] text-white/50">
                  {maxWithdrawUi > 0
                    ? `${Math.round(((Number(input) || 0) / maxWithdrawUi) * 100)}%`
                    : "0%"}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={maxWithdrawUi}
                step={Math.max(maxWithdrawUi / 100, 1e-6)}
                value={Math.min(Number(input) || 0, maxWithdrawUi)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const atMax = v >= maxWithdrawUi;
                  const atomic = atMax
                    ? positionAtomic
                    : uiToAtomic(String(v), asset.decimals).toString();
                  setInput(atomicToUiString(atomic, asset.decimals));
                  // A full exit redeems the exact share balance.
                  setWithdrawAll(atMax);
                  reset();
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
                  setWithdrawAll(false);
                  reset();
                }}
                className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
                {asset.symbol}
              </span>
            </div>
          )}
        </div>

        {asset.isNativeSol && mode === "deposit" && (
          <p className="text-[11px] text-white/50">
            Max leaves 0.015 SOL in your wallet to cover transaction fees.
          </p>
        )}

        {belowMinimum && (
          <p className="text-[11px] text-aeras-negative">
            This vault has a minimum deposit of{" "}
            {atomicToUiString(vaultMeta.minDepositAtomic, asset.decimals)}{" "}
            {asset.symbol}.
          </p>
        )}

        {overLimit && (
          <p className="text-[11px] text-aeras-negative">
            Amount is above the {mode === "deposit" ? "balance" : "deposited"}{" "}
            limit.
          </p>
        )}

        {state.kind === "error" && (
          <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
            {state.message}
          </p>
        )}
        {state.kind === "done" && (
          <a
            href={`${SOLSCAN_TX_BASE}${state.signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
          >
            <div className="font-medium text-aeras-positive">
              {mode === "deposit"
                ? "Deposit confirmed"
                : "Withdrawal confirmed"}
            </div>
            <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
              {state.signature}
            </div>
          </a>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={handleSubmit}
          className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? "Signing and submitting…"
            : mode === "deposit"
              ? `Deposit into ${vaultMeta.name}`
              : `Withdraw ${asset.symbol}`}
        </button>

        <p className="text-[11px] text-white/50">
          {vaultMeta.name} is managed by a third-party curator, not by Kamino.
          The curator decides which Kamino Lend reserves your deposit is
          allocated to and takes a fee from the yield. The rate shown is net of
          that fee.
        </p>
      </div>
    </div>
  );
}

function KaminoPositionSummary({
  asset,
  vaultMeta,
  vault,
  positionAtomic,
}: {
  asset: EarnAssetMeta;
  vaultMeta: KaminoVaultMeta;
  vault: KaminoVaultState;
  positionAtomic: string;
}) {
  const positionUi = Number(atomicToUiString(positionAtomic, asset.decimals));
  // sharePrice is USD per share and tokensPerShare is the token ratio, so the
  // token's own USD price is the quotient. Derived this way because the K-Vault
  // metrics endpoint does not report an asset price directly. Float division is
  // fine here: this figure is only ever rendered, never turned into an amount.
  const tokensPerShare =
    Number(vault.tokensPerShareScaled) / 10 ** RATIO_PRECISION;
  const assetPriceUsd =
    tokensPerShare > 0 ? vault.sharePriceUsd / tokensPerShare : 0;
  const positionUsd = positionUi * assetPriceUsd;
  const apyPct = vault.apy * 100;

  return (
    <div className="grid grid-cols-3 gap-3 rounded-xl border border-aeras-positive/25 bg-aeras-positive/10 p-4 text-xs">
      <Stat label="Position value" value={`$${positionUsd.toFixed(2)}`} />
      <Stat label="Current APY" value={`${apyPct.toFixed(2)}%`} highlight />
      <Stat
        label="Est. 1-yr yield"
        value={`+$${(positionUsd * vault.apy).toFixed(2)}`}
        highlight
      />
      <div className="col-span-3 text-[11px] text-white/50">
        Deposited in {vaultMeta.name}. The rate is variable and set by the
        vault&rsquo;s allocation across Kamino Lend reserves.
      </div>
    </div>
  );
}

// ── Vault position ─────────────────────────────────────────────────────────

// A yield vault is a savings position, so the honest visual is how the deposit
// grows if the current rate holds. The curve is a direct function of the live
// APY and the current balance, compounded monthly, and is labeled as a
// projection since the rate is variable.
function VaultPositionSummary({
  meta,
  vault,
  positionAtomic,
}: {
  meta: EarnAssetMeta;
  vault: EarnVaultState;
  positionAtomic: BN;
}) {
  const positionUi = Number(
    atomicToUiString(positionAtomic.toString(), meta.decimals),
  );
  const positionUsd = positionUi * vault.assetPriceUsd;
  const yearYieldUsd = positionUsd * vault.apy;
  const apyPct = vault.apy * 100;

  const series = Array.from({ length: 13 }, (_, m) => ({
    m,
    value: positionUsd * Math.pow(1 + vault.apy, m / 12),
  }));
  const fillId = `vaultGrowthFill-${meta.assetMint}`;

  return (
    <div className="space-y-3 rounded-xl border border-aeras-positive/25 bg-aeras-positive/10 p-4">
      <div className="grid grid-cols-3 gap-3 text-xs">
        <Stat
          label="Position value"
          value={`$${positionUsd.toFixed(2)}`}
        />
        <Stat label="Current APY" value={`${apyPct.toFixed(2)}%`} highlight />
        <Stat
          label="Est. 1-yr yield"
          value={`+$${yearYieldUsd.toFixed(2)}`}
          highlight
        />
      </div>

      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Projected growth at current APY
        </div>
        <div className="h-24 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={series}
              margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#119b62" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#119b62" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="m" hide />
              <YAxis dataKey="value" domain={["dataMin", "dataMax"]} hide />
              <Tooltip content={<GrowthTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#119b62"
                strokeWidth={1.25}
                fill={`url(#${fillId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/50">
          <span>Now</span>
          <span>12 mo</span>
        </div>
      </div>

      <p className="text-[11px] text-white/50">
        Projection assumes the current {apyPct.toFixed(2)}% rate holds. The rate
        is variable and moves with vault utilization.
      </p>
    </div>
  );
}

function GrowthTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { m: number; value: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-white/10 bg-black/60 px-2 py-1.5 text-xs shadow-sm backdrop-blur">
      <div className="font-mono tabular-nums text-white">
        ${point.value.toFixed(2)}
      </div>
      <div className="text-white/50">
        {point.m === 0 ? "Now" : `Month ${point.m}`}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  highlight,
  warning,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warning?: boolean;
}) {
  let valueClass = "font-mono tabular-nums text-sm text-white";
  if (highlight) valueClass = "font-mono tabular-nums text-sm text-aeras-positive";
  if (warning) valueClass = "font-mono tabular-nums text-sm text-aeras-warning";

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className={`mt-0.5 ${valueClass}`}>{value}</div>
    </div>
  );
}

function formatLargeUsd(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Chain errors are unreadable by default. Map the ones users actually hit and
// fall back to the raw message rather than swallowing it.
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/insufficient funds|0x1\b/i.test(raw)) {
    return "Not enough balance to cover this amount plus fees.";
  }
  if (/blockhash not found|block height exceeded/i.test(raw)) {
    return "The transaction expired before it landed. Try again.";
  }
  if (/User rejected|declined|denied/i.test(raw)) {
    return "Signature request was declined.";
  }
  return `Transaction failed: ${raw}`;
}
