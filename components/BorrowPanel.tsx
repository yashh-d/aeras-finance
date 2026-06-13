"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  buildOperateTx,
  fetchLiveVaultStateViaProxy,
  fetchPositionState,
  findExistingNftId,
  fromAtomicBN,
  getMaxSentinels,
  toAtomicBN,
  XSTOCK_BORROW_VAULTS,
  type LiveVaultState,
  type UserPositionState,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  getConnection,
  type AccountBalances,
} from "@/lib/solana/balances";
import BN from "bn.js";

interface Props {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}

export function BorrowPanel({
  walletAddress,
  balances,
  prices,
  onRefresh,
}: Props) {
  // Vault ids the user already has a position NFT for (persisted at borrow time).
  // Read once on mount: after a full-balance borrow the wallet collateral is 0,
  // but the open position (and its Close control) must stay visible.
  const [vaultsWithPosition, setVaultsWithPosition] = useState<Set<number>>(
    () => new Set(),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = new Set<number>();
    for (const v of XSTOCK_BORROW_VAULTS) {
      const raw = localStorage.getItem(
        `aeras:borrow:${walletAddress}:${v.vaultId}`,
      );
      const n = raw ? Number(raw) : NaN;
      if (Number.isInteger(n) && n > 0) ids.add(v.vaultId);
    }
    setVaultsWithPosition(ids);
  }, [walletAddress]);

  // Show a vault if the user holds its collateral OR already has a position in
  // it. Filtering on wallet balance alone made the card (and its Close button)
  // disappear after a borrow deposited the full balance as collateral.
  const eligibleVaults = useMemo(() => {
    if (!balances) return [];
    return XSTOCK_BORROW_VAULTS.filter(
      (v) =>
        (balances.xstocks[v.collateralMint] ?? 0) > 0 ||
        vaultsWithPosition.has(v.vaultId),
    );
  }, [balances, vaultsWithPosition]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          Borrow
        </div>
        <span className="text-xs text-aeras-300">Jupiter Lend · USDC</span>
      </div>
      {eligibleVaults.length === 0 ? (
        <p className="rounded-xl border border-aeras-blue-soft bg-aeras-blue-wash px-4 py-3 text-sm text-aeras-500">
          Buy <span className="font-medium text-aeras-blue">TSLAx</span>,{" "}
          <span className="font-medium text-aeras-blue">SPYx</span>,{" "}
          <span className="font-medium text-aeras-blue">QQQx</span>, or{" "}
          <span className="font-medium text-aeras-blue">NVDAx</span> above to
          deposit it as collateral and borrow USDC.
        </p>
      ) : (
        eligibleVaults.map((vault) => (
          <VaultCard
            key={vault.vaultId}
            vault={vault}
            walletAddress={walletAddress}
            collateralBalance={balances?.xstocks[vault.collateralMint] ?? 0}
            collateralBalanceAtomic={
              balances?.xstocksAtomic[vault.collateralMint] ?? "0"
            }
            prices={prices}
            onRefresh={onRefresh}
          />
        ))
      )}
    </div>
  );
}

interface VaultCardProps {
  vault: XStockBorrowVault;
  walletAddress: string;
  collateralBalance: number;
  // Exact base-unit balance as a decimal string. Used to defeat float rounding
  // in Max/submit so we never request more than the wallet actually holds.
  collateralBalanceAtomic: string;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "done"; signature: string };

function VaultCard({
  vault,
  walletAddress,
  collateralBalance,
  collateralBalanceAtomic,
  prices,
  onRefresh,
}: VaultCardProps) {
  const [live, setLive] = useState<LiveVaultState | null>(null);
  const [position, setPosition] = useState<UserPositionState | null>(null);
  const [positionLoading, setPositionLoading] = useState(true);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const [closingState, setClosingState] = useState<FormState>({ kind: "idle" });

  const signTxBase64 = useSignSolanaTxBase64();

  // Tracked nftId — mirrors localStorage but mutable via state so React re-renders
  // when auto-recovery rebinds an existing on-chain position NFT.
  const storageKey = `aeras:borrow:${walletAddress}:${vault.vaultId}`;
  const initialNftId = (() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  const [storedNftId, setStoredNftId] = useState<number | null>(initialNftId);
  // Gate on initial NFT scan to avoid accidentally creating a second NFT (and
  // paying rent again) before recovery has had a chance to bind an existing one.
  const [recovering, setRecovering] = useState<boolean>(initialNftId == null);
  const persistNftId = useCallback(
    (nftId: number) => {
      localStorage.setItem(storageKey, String(nftId));
      setStoredNftId(nftId);
    },
    [storageKey],
  );

  // Auto-recover: if localStorage has no nftId for this (wallet, vault), scan
  // the wallet on-chain for existing Jupiter Lend position NFTs and rebind.
  useEffect(() => {
    if (storedNftId != null) {
      setRecovering(false);
      return;
    }
    let cancelled = false;
    setRecovering(true);
    (async () => {
      try {
        const found = await findExistingNftId(
          walletAddress,
          vault,
          getConnection(),
        );
        if (cancelled) return;
        if (found != null) {
          console.log(
            `[borrow auto-recover] rebound nftId ${found} for vault ${vault.vaultId}`,
          );
          persistNftId(found);
        }
      } catch (err) {
        console.error("[borrow auto-recover]", err);
      } finally {
        if (!cancelled) setRecovering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedNftId, walletAddress, vault, persistNftId]);

  const refreshLive = useCallback(async () => {
    try {
      setLive(await fetchLiveVaultStateViaProxy(vault.vaultId));
    } catch (err) {
      console.error("[borrow live]", err);
    }
  }, [vault.vaultId]);

  const refreshPosition = useCallback(async () => {
    if (!storedNftId) {
      setPosition(null);
      setPositionError(null);
      setPositionLoading(false);
      return;
    }
    setPositionLoading(true);
    try {
      const state = await fetchPositionState(
        vault,
        storedNftId,
        getConnection(),
      );
      setPosition(state);
      setPositionError(null);
    } catch (err) {
      console.error("[borrow position]", err);
      setPositionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPositionLoading(false);
    }
  }, [storedNftId, vault]);

  useEffect(() => {
    refreshLive();
  }, [refreshLive]);

  useEffect(() => {
    refreshPosition();
  }, [refreshPosition]);

  const oraclePrice = live?.oraclePriceUsd ?? prices?.[vault.collateralMint]?.usdPrice ?? null;
  const collateralUsd = oraclePrice != null ? collateralBalance * oraclePrice : null;
  const cfPct = vault.collateralFactor / 10;
  const ltPct = vault.liquidationThreshold / 10;
  const borrowRatePct = live ? live.borrowRateAnnual * 100 : null;

  async function handleSubmit(args: {
    collateralUi: number;
    borrowUi: number;
  }) {
    setFormState({ kind: "submitting" });
    try {
      let colAtomic = toAtomicBN(args.collateralUi, vault.collateralDecimals);
      const debtAtomic = toAtomicBN(args.borrowUi, vault.borrowDecimals);
      const conn = getConnection();
      // Belt-and-suspenders against float drift AND stale balance: re-read the
      // ATA at submit time and clamp to it. The prop is the balance from the
      // parent's last refresh, which can be stale if the user just topped up a
      // position (NFT 463 case) or moved funds in another tab — the SDK then
      // asks Token-2022 to TransferChecked more than the ATA holds and the
      // inner instruction fails with "insufficient funds" (0x1).
      if (colAtomic.gtn(0)) {
        const ata = getAssociatedTokenAddressSync(
          new PublicKey(vault.collateralMint),
          new PublicKey(walletAddress),
          false,
          TOKEN_2022_PROGRAM_ID,
        );
        let freshAtomic: BN;
        try {
          // `processed` matches what simulation reads — `confirmed` can lag a
          // few slots and let a stale "max" through.
          const fresh = await conn.getTokenAccountBalance(ata, "processed");
          freshAtomic = new BN(fresh.value.amount);
        } catch {
          // ATA doesn't exist or RPC error — fall back to the prop value so we
          // don't block a borrow-only op against an existing position.
          freshAtomic = new BN(collateralBalanceAtomic);
        }
        // The Borrow program scales col 8-dec → 9-dec internally and converts
        // back to mint-atomic when wiring the TransferChecked. Combined with
        // Earn-vault exchange-price rounding, the on-chain transfer can ask for
        // 1 atomic unit more than `colAtomic`. Reserve a 1-unit cushion so a
        // user typing "Max" doesn't fail simulation by a hair.
        const cushion = freshAtomic.gtn(1) ? freshAtomic.subn(1) : new BN(0);
        if (colAtomic.gt(cushion)) colAtomic = cushion;
        if (colAtomic.isZero() && args.collateralUi > 0) {
          throw new Error(
            `You don't have enough ${vault.collateralSymbol} in this wallet to deposit. Buy more before depositing.`,
          );
        }
      }
      const { base64Tx, nftId } = await buildOperateTx({
        vaultId: vault.vaultId,
        positionId: storedNftId ?? 0,
        collateralDeltaAtomic: colAtomic,
        debtDeltaAtomic: debtAtomic,
        signerAddress: walletAddress,
        connection: conn,
      });
      const signed = await signTxBase64(base64Tx);
      const signedBytes = base64ToBytes(signed);
      const sig = await conn.sendRawTransaction(signedBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await conn.confirmTransaction(sig, "confirmed");
      // Persist nftId for future operations on this vault.
      const finalNftId = nftId ?? storedNftId;
      if (finalNftId) persistNftId(finalNftId);
      setFormState({ kind: "done", signature: sig });
      await onRefresh();
      await refreshPosition();
    } catch (err) {
      console.error("[borrow submit]", err);
      setFormState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleClose() {
    if (!position) return;
    setClosingState({ kind: "submitting" });
    try {
      const { maxRepay, maxWithdraw } = await getMaxSentinels();
      const conn = getConnection();
      const { base64Tx } = await buildOperateTx({
        vaultId: vault.vaultId,
        positionId: position.nftId,
        collateralDeltaAtomic: maxWithdraw,
        debtDeltaAtomic: maxRepay,
        signerAddress: walletAddress,
        connection: conn,
      });
      const signed = await signTxBase64(base64Tx);
      const signedBytes = base64ToBytes(signed);
      const sig = await conn.sendRawTransaction(signedBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await conn.confirmTransaction(sig, "confirmed");
      // Position is zeroed but the on-chain position-NFT account stays alive
      // (Jupiter Lend has no close-position instruction). Keep the nftId in
      // localStorage so future borrows in this vault reuse it instead of
      // paying ~0.015 SOL rent for a new NFT.
      setClosingState({ kind: "done", signature: sig });
      await onRefresh();
      await refreshPosition();
    } catch (err) {
      console.error("[borrow close]", err);
      setClosingState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-aeras-border bg-white p-4">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium tracking-tight text-aeras-900">
            {vault.collateralSymbol} → {vault.borrowSymbol}
          </div>
          <div className="font-mono text-xs text-aeras-300">
            #{vault.vaultId}
          </div>
        </div>
        <div className="font-mono text-[11px] text-aeras-300">
          CF {cfPct.toFixed(0)}% · LT {ltPct.toFixed(0)}%
          {borrowRatePct != null && ` · ${borrowRatePct.toFixed(2)}% APR`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          label="Your collateral"
          value={`${collateralBalance.toFixed(4)} ${vault.collateralSymbol}`}
          sub={collateralUsd != null ? `$${collateralUsd.toFixed(2)}` : undefined}
        />
        <Stat
          label="Oracle price"
          value={oraclePrice != null ? `$${oraclePrice.toFixed(2)}` : "…"}
        />
      </div>

      {positionLoading ? (
        <p className="text-xs text-aeras-300">Loading position…</p>
      ) : positionError ? (
        <div className="rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2 text-xs text-aeras-500">
          <div className="font-medium text-aeras-900">
            Couldn&apos;t load position
          </div>
          <div className="mt-1 break-all text-aeras-300">{positionError}</div>
          {storedNftId != null && (
            <div className="mt-1 font-mono text-[10px] text-aeras-300">
              Stored nftId: {storedNftId} · clear devtools localStorage if stale
            </div>
          )}
        </div>
      ) : position && (position.collateralAtomic.gtn(0) || position.debtAtomic.gtn(0)) ? (
        <>
          <PositionCard vault={vault} position={position} oraclePrice={oraclePrice} />
          <ClosePositionControl
            vault={vault}
            position={position}
            state={closingState}
            onClose={handleClose}
            onReset={() => setClosingState({ kind: "idle" })}
          />
        </>
      ) : position ? (
        <div className="rounded-lg border border-aeras-blue-soft bg-aeras-blue-wash px-3 py-2 text-xs text-aeras-500">
          <span className="font-medium text-aeras-blue">Position #{position.nftId}</span>{" "}
          · empty. Reused on your next borrow in this vault (no extra rent).
        </div>
      ) : null}

      <OperateForm
        vault={vault}
        existingPosition={position}
        collateralBalance={collateralBalance}
        collateralBalanceAtomic={collateralBalanceAtomic}
        oraclePrice={oraclePrice}
        onSubmit={handleSubmit}
        formState={formState}
        resetForm={() => setFormState({ kind: "idle" })}
        recovering={recovering}
      />
    </div>
  );
}

function PositionCard({
  vault,
  position,
  oraclePrice,
}: {
  vault: XStockBorrowVault;
  position: UserPositionState;
  oraclePrice: number | null;
}) {
  const colUi = fromAtomicBN(position.collateralAtomic, vault.collateralDecimals);
  const debtUi = fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
  const colUsd = oraclePrice != null ? colUi * oraclePrice : null;
  const ltvPct = colUsd && colUsd > 0 ? (debtUi / colUsd) * 100 : 0;
  const liquidationPct = vault.liquidationThreshold / 10;
  // Collateral price at which LTV would reach LT, given current debt:
  //   LT = debt / (col * priceLiq) => priceLiq = debt / (col * LT)
  const liquidationPrice =
    colUi > 0 && debtUi > 0
      ? debtUi / (colUi * (vault.liquidationThreshold / 1000))
      : null;
  // Health factor: how much room before liquidation. 1.0x = at LT.
  const health = ltvPct > 0 ? liquidationPct / ltvPct : Infinity;
  const healthy = ltvPct < liquidationPct * 0.8;
  const warning = !healthy && ltvPct < liquidationPct;
  const liquidatable = ltvPct >= liquidationPct;

  let badgeBg = "bg-aeras-blue-wash text-aeras-blue";
  let badgeText = "Healthy";
  let cardBg = "bg-aeras-blue-wash border-aeras-blue-soft";
  if (liquidatable) {
    badgeBg = "bg-aeras-surface text-aeras-negative";
    badgeText = "At risk";
    cardBg = "bg-aeras-surface border-aeras-border";
  } else if (warning) {
    badgeBg = "bg-aeras-surface text-aeras-warning";
    badgeText = "Watch";
    cardBg = "bg-aeras-surface border-aeras-border";
  }

  return (
    <div className={`space-y-3 rounded-xl border p-3.5 ${cardBg}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-aeras-300">
          Position #{position.nftId}
        </span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badgeBg}`}
        >
          {badgeText}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          label="Collateral"
          value={`${colUi.toFixed(4)} ${vault.collateralSymbol}`}
          sub={colUsd != null ? `$${colUsd.toFixed(2)}` : undefined}
        />
        <Stat
          label="Debt"
          value={`${debtUi.toFixed(4)} ${vault.borrowSymbol}`}
        />
        <Stat
          label="Projected LTV"
          value={`${ltvPct.toFixed(1)}% / LT ${liquidationPct.toFixed(0)}%`}
        />
        <Stat
          label="Health"
          value={health === Infinity ? "—" : `${health.toFixed(2)}×`}
        />
      </div>
      {liquidationPrice != null && (
        <div className="border-t border-aeras-border pt-3 text-xs">
          <div className="flex items-baseline justify-between">
            <span className="text-aeras-300">Liquidation price</span>
            <span className="font-mono tabular-nums text-aeras-900">
              ${liquidationPrice.toFixed(2)} / {vault.collateralSymbol}
            </span>
          </div>
          {oraclePrice != null && (
            <div className="mt-1 text-[11px] text-aeras-300">
              {oraclePrice > liquidationPrice
                ? `${vault.collateralSymbol} would need to drop ${(((oraclePrice - liquidationPrice) / oraclePrice) * 100).toFixed(1)}% from $${oraclePrice.toFixed(2)} to liquidate.`
                : "Position is at the liquidation threshold."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OperateForm({
  vault,
  existingPosition,
  collateralBalance,
  collateralBalanceAtomic,
  oraclePrice,
  onSubmit,
  formState,
  resetForm,
  recovering,
}: {
  vault: XStockBorrowVault;
  existingPosition: UserPositionState | null;
  collateralBalance: number;
  collateralBalanceAtomic: string;
  oraclePrice: number | null;
  onSubmit: (args: { collateralUi: number; borrowUi: number }) => void;
  formState: FormState;
  resetForm: () => void;
  recovering: boolean;
}) {
  // Default: deposit a small amount of collateral and borrow conservatively against it.
  const safeCFPct = (vault.collateralFactor / 10) * 0.6; // borrow up to 60% of CF for safety
  const [colInput, setColInput] = useState<string>(() =>
    collateralBalance > 0 ? collateralBalance.toFixed(4) : "0",
  );
  const [borrowInput, setBorrowInput] = useState<string>("");

  useEffect(() => {
    if (collateralBalance > 0 && colInput === "0") {
      setColInput(collateralBalance.toFixed(4));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collateralBalance]);

  const collateralUi = Number(colInput);
  const borrowUi = Number(borrowInput);

  const colDeltaValid =
    Number.isFinite(collateralUi) &&
    collateralUi >= 0 &&
    collateralUi <= collateralBalance;
  const borrowValid = Number.isFinite(borrowUi) && borrowUi >= 0;
  const totalCollateralUsd =
    oraclePrice != null
      ? ((existingPosition
          ? fromAtomicBN(existingPosition.collateralAtomic, vault.collateralDecimals)
          : 0) +
          collateralUi) *
        oraclePrice
      : null;
  const totalDebtUi =
    (existingPosition
      ? fromAtomicBN(existingPosition.debtAtomic, vault.borrowDecimals)
      : 0) + borrowUi;
  const projectedLtv =
    totalCollateralUsd && totalCollateralUsd > 0
      ? (totalDebtUi / totalCollateralUsd) * 100
      : 0;
  const ltPct = vault.liquidationThreshold / 10;
  const cfPct = vault.collateralFactor / 10;
  const tooClose = projectedLtv >= cfPct;
  const submitting = formState.kind === "submitting";
  const disabled =
    !colDeltaValid ||
    !borrowValid ||
    submitting ||
    tooClose ||
    recovering ||
    (collateralUi === 0 && borrowUi === 0);

  const maxBorrowUsd = totalCollateralUsd ? totalCollateralUsd * (safeCFPct / 100) : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={`Deposit ${vault.collateralSymbol}`}
          value={colInput}
          onChange={(v) => {
            setColInput(v);
            resetForm();
          }}
          right={vault.collateralSymbol}
          balanceLabel={`${collateralBalance.toFixed(4)} avail`}
          onMax={() => {
            // Use the exact on-chain base-unit string so the resulting atomic
            // amount never exceeds what the wallet actually holds.
            setColInput(
              atomicToUiString(
                collateralBalanceAtomic,
                vault.collateralDecimals,
              ),
            );
            resetForm();
          }}
        />
        <NumberField
          label={`Borrow ${vault.borrowSymbol}`}
          value={borrowInput}
          onChange={(v) => {
            setBorrowInput(v);
            resetForm();
          }}
          right={vault.borrowSymbol}
          balanceLabel={
            maxBorrowUsd > 0 ? `${maxBorrowUsd.toFixed(2)} max safe` : undefined
          }
          onMax={
            maxBorrowUsd > 0
              ? () => {
                  setBorrowInput(maxBorrowUsd.toFixed(2));
                  resetForm();
                }
              : undefined
          }
        />
      </div>

      {(collateralUi > 0 || borrowUi > 0) && (
        <div className="rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2 text-xs">
          <div className="flex justify-between">
            <span className="text-aeras-300">Projected LTV</span>
            <span
              className={`font-mono tabular-nums ${
                tooClose ? "text-aeras-negative" : "text-aeras-900"
              }`}
            >
              {projectedLtv.toFixed(1)}% / LT {ltPct.toFixed(0)}%
            </span>
          </div>
          {tooClose && (
            <p className="mt-1 text-aeras-negative">
              Borrow exceeds the collateral factor ({cfPct.toFixed(0)}%). Reduce
              the borrow amount or add more collateral.
            </p>
          )}
        </div>
      )}

      {formState.kind === "error" && (
        <p className="rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2 text-xs text-aeras-negative">
          {formState.message}
        </p>
      )}
      {formState.kind === "done" && (
        <a
          href={`${SOLSCAN_TX_BASE}${formState.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">Submitted</div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-aeras-300">
            {formState.signature}
          </div>
        </a>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit({ collateralUi, borrowUi })}
        className="w-full rounded-xl bg-aeras-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {recovering
          ? "Checking for an existing position…"
          : submitting
            ? "Signing and submitting…"
            : existingPosition
              ? "Update position"
              : "Open position"}
      </button>
    </div>
  );
}

function ClosePositionControl({
  vault,
  position,
  state,
  onClose,
  onReset,
}: {
  vault: XStockBorrowVault;
  position: UserPositionState;
  state: FormState;
  onClose: () => void;
  onReset: () => void;
}) {
  const debtUi = fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
  const colUi = fromAtomicBN(position.collateralAtomic, vault.collateralDecimals);
  const submitting = state.kind === "submitting";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="w-full rounded-xl border border-aeras-border bg-white px-4 py-2.5 text-sm font-medium text-aeras-900 transition-colors hover:border-aeras-border-strong hover:bg-aeras-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? "Closing position…"
          : `Close · repay ${debtUi.toFixed(4)} ${vault.borrowSymbol} + withdraw ${colUi.toFixed(4)} ${vault.collateralSymbol}`}
      </button>
      <p className="text-[11px] text-aeras-300">
        Needs ≥ {debtUi.toFixed(4)} {vault.borrowSymbol} in your wallet to repay
        the loan plus accrued interest.
      </p>
      {state.kind === "error" && (
        <div className="rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2 text-xs text-aeras-negative">
          {state.message}
          <button
            type="button"
            onClick={onReset}
            className="ml-2 text-aeras-300 underline-offset-2 hover:text-aeras-900 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {state.kind === "done" && (
        <a
          href={`${SOLSCAN_TX_BASE}${state.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">Position closed</div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-aeras-300">
            {state.signature}
          </div>
        </a>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  right,
  balanceLabel,
  onMax,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  right: string;
  balanceLabel?: string;
  onMax?: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          {label}
        </label>
        {balanceLabel && (
          <span className="font-mono text-[11px] text-aeras-300">
            {balanceLabel}
            {onMax && (
              <button
                type="button"
                onClick={onMax}
                className="ml-1 text-aeras-500 underline-offset-2 hover:text-aeras-900 hover:underline"
              >
                Max
              </button>
            )}
          </span>
        )}
      </div>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-lg border border-aeras-border bg-white px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-aeras-900 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-aeras-300">
          {right}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[11px] text-aeras-300">{label}</div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-aeras-900">
        {value}
        {sub && <span className="text-aeras-300"> · {sub}</span>}
      </div>
    </div>
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
