"use client";

import { useCallback, useEffect, useState } from "react";

import { PriceChart } from "@/components/PriceChart";
import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { xstockByMint } from "@/lib/jupiter/xstocks";
import {
  buildKaminoBorrowTx,
  buildKaminoDepositTx,
  KaminoKtxError,
  toAtomicString,
} from "@/lib/kamino/borrow";
import {
  buildKaminoRepayTx,
  buildKaminoWithdrawTx,
  fetchKaminoPosition,
  type KaminoPosition,
} from "@/lib/kamino/positions";
import type { KaminoCollateralReserve } from "@/lib/kamino/reserves";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  getConnection,
} from "@/lib/solana/balances";

// USDC is the only borrow asset in this market for v1.
const BORROW_SYMBOL = "USDC";

interface Props {
  collateral: KaminoCollateralReserve;
  walletAddress: string;
  collateralBalance: number;
  // Exact base-unit balance as a decimal string. Used to defeat float rounding
  // when depositing the full wallet balance.
  collateralBalanceAtomic: string;
  prices: JupiterPriceMap | null;
  // Position pre-fetched by the parent (single obligation per market). Passed so
  // the card renders an existing position without an extra round-trip on mount.
  initialPosition: KaminoPosition | null;
  onRefresh: () => Promise<void> | void;
  // Ask the parent to re-read the obligation after an open/close so the card
  // stays visible once collateral has moved out of the wallet.
  onPositionChange: () => void;
}

// Submitting carries a human-readable step because opening or closing a Kamino
// position is two transactions (deposit then borrow / repay then withdraw), each
// signed separately.
type FormState =
  | { kind: "idle" }
  | { kind: "submitting"; step: string }
  | { kind: "error"; message: string }
  | { kind: "done"; signature: string };

export function KaminoBorrowCard({
  collateral,
  walletAddress,
  collateralBalance,
  collateralBalanceAtomic,
  prices,
  initialPosition,
  onRefresh,
  onPositionChange,
}: Props) {
  const signTxBase64 = useSignSolanaTxBase64();

  const matchesThis = (p: KaminoPosition | null) =>
    p && p.collateral.collateralMint === collateral.collateralMint ? p : null;

  const [position, setPosition] = useState<KaminoPosition | null>(
    matchesThis(initialPosition),
  );
  const [positionError, setPositionError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const [closingState, setClosingState] = useState<FormState>({ kind: "idle" });

  const refreshPosition = useCallback(async () => {
    try {
      const p = await fetchKaminoPosition(walletAddress);
      setPosition(
        p && p.collateral.collateralMint === collateral.collateralMint
          ? p
          : null,
      );
      setPositionError(null);
    } catch (err) {
      console.error("[kamino position]", err);
      setPositionError(err instanceof Error ? err.message : String(err));
    }
  }, [walletAddress, collateral.collateralMint]);

  useEffect(() => {
    refreshPosition();
  }, [refreshPosition]);

  const oraclePrice =
    position?.oraclePriceUsd ??
    prices?.[collateral.collateralMint]?.usdPrice ??
    null;
  const collateralUsd =
    oraclePrice != null ? collateralBalance * oraclePrice : null;
  const cfPct = collateral.maxLtvSnapshot * 100;
  const ltPct = collateral.liquidationThreshold;

  // Sign, submit, and confirm one base64 transaction. Shared by both legs of the
  // open and close flows.
  const signSend = useCallback(
    async (base64Tx: string): Promise<string> => {
      const conn = getConnection();
      const signed = await signTxBase64(base64Tx);
      const bytes = base64ToBytes(signed);
      const sig = await conn.sendRawTransaction(bytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await conn.confirmTransaction(sig, "confirmed");
      return sig;
    },
    [signTxBase64],
  );

  async function handleSubmit(args: {
    collateralUi: number;
    borrowUi: number;
  }) {
    try {
      let lastSig: string | null = null;

      if (args.collateralUi > 0) {
        setFormState({
          kind: "submitting",
          step: `Depositing ${collateral.symbol}…`,
        });
        // Clamp to the exact on-chain balance so a "Max" deposit can't request
        // one atomic unit more than the wallet holds.
        const wantedAtomic = toAtomicString(
          args.collateralUi,
          collateral.decimals,
        );
        const clampedAtomic =
          BigInt(wantedAtomic) > BigInt(collateralBalanceAtomic)
            ? collateralBalanceAtomic
            : wantedAtomic;
        const depositUi = Number(
          atomicToUiString(clampedAtomic, collateral.decimals),
        );
        const depTx = await buildKaminoDepositTx({
          walletAddress,
          collateral,
          collateralUi: depositUi,
        });
        lastSig = await signSend(depTx);
      }

      if (args.borrowUi > 0) {
        setFormState({ kind: "submitting", step: `Borrowing ${BORROW_SYMBOL}…` });
        const borrowTx = await buildKaminoBorrowTx({
          walletAddress,
          borrowUi: args.borrowUi,
        });
        lastSig = await signSend(borrowTx);
      }

      if (!lastSig) {
        setFormState({ kind: "idle" });
        return;
      }
      setFormState({ kind: "done", signature: lastSig });
      await onRefresh();
      await refreshPosition();
      onPositionChange();
    } catch (err) {
      console.error("[kamino open]", err);
      const message =
        err instanceof KaminoKtxError &&
        err.code === "KLEND_OBLIGATION_NOT_FOUND"
          ? `Deposit ${collateral.symbol} before borrowing ${BORROW_SYMBOL}.`
          : err instanceof Error
            ? err.message
            : String(err);
      setFormState({ kind: "error", message });
    }
  }

  async function handleClose() {
    if (!position) return;
    try {
      let lastSig: string | null = null;
      if (position.debtUsdc > 0) {
        setClosingState({
          kind: "submitting",
          step: `Repaying ${BORROW_SYMBOL}…`,
        });
        const repayTx = await buildKaminoRepayTx(
          walletAddress,
          position.debtUsdc,
        );
        lastSig = await signSend(repayTx);
      }
      setClosingState({
        kind: "submitting",
        step: `Withdrawing ${collateral.symbol}…`,
      });
      const withdrawTx = await buildKaminoWithdrawTx(walletAddress, position);
      lastSig = await signSend(withdrawTx);

      setClosingState({ kind: "done", signature: lastSig });
      await onRefresh();
      await refreshPosition();
      onPositionChange();
    } catch (err) {
      console.error("[kamino close]", err);
      setClosingState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hasPosition =
    position != null && (position.collateralUi > 0 || position.debtUsdc > 0);

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-gradient-to-br from-aeras-hero-from to-aeras-hero-to p-4 shadow-lg shadow-black/10">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium tracking-tight text-white">
            {collateral.symbol} → {BORROW_SYMBOL}
          </div>
        </div>
        <div className="font-mono text-[11px] text-white/50">
          Max LTV {cfPct.toFixed(0)}% · LT {ltPct.toFixed(0)}%
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          label="Your collateral"
          value={`${collateralBalance.toFixed(4)} ${collateral.symbol}`}
          sub={collateralUsd != null ? `$${collateralUsd.toFixed(2)}` : undefined}
        />
        <Stat
          label="Oracle price"
          value={oraclePrice != null ? `$${oraclePrice.toFixed(2)}` : "…"}
        />
      </div>

      {positionError ? (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
          <div className="font-medium text-white">
            Couldn&apos;t load position
          </div>
          <div className="mt-1 break-all text-white/50">{positionError}</div>
        </div>
      ) : hasPosition ? (
        <>
          <KaminoPositionCard
            collateral={collateral}
            position={position!}
            oraclePrice={oraclePrice}
          />
          <KaminoCloseControl
            collateral={collateral}
            position={position!}
            state={closingState}
            onClose={handleClose}
            onReset={() => setClosingState({ kind: "idle" })}
          />
        </>
      ) : null}

      <KaminoOperateForm
        collateral={collateral}
        existingPosition={hasPosition ? position : null}
        collateralBalance={collateralBalance}
        collateralBalanceAtomic={collateralBalanceAtomic}
        oraclePrice={oraclePrice}
        onSubmit={handleSubmit}
        formState={formState}
        resetForm={() => setFormState({ kind: "idle" })}
      />
    </div>
  );
}

function KaminoPositionCard({
  collateral,
  position,
  oraclePrice,
}: {
  collateral: KaminoCollateralReserve;
  position: KaminoPosition;
  oraclePrice: number | null;
}) {
  const colUi = position.collateralUi;
  const debtUi = position.debtUsdc;
  const colUsd = oraclePrice != null ? colUi * oraclePrice : position.collateralUsd;
  const ltvPct =
    position.ltvPct > 0
      ? position.ltvPct
      : colUsd > 0
        ? (debtUi / colUsd) * 100
        : 0;
  const liquidationPct =
    position.liquidationLtvPct > 0
      ? position.liquidationLtvPct
      : collateral.liquidationThreshold;
  // Collateral price at which LTV reaches LT for the current debt.
  const liquidationPrice =
    colUi > 0 && debtUi > 0
      ? debtUi / (colUi * (liquidationPct / 100))
      : null;
  const health = ltvPct > 0 ? liquidationPct / ltvPct : Infinity;
  const healthy = ltvPct < liquidationPct * 0.8;
  const warning = !healthy && ltvPct < liquidationPct;
  const liquidatable = ltvPct >= liquidationPct;

  let badgeBg = "bg-aeras-blue/20 text-aeras-blue-medium";
  let badgeText = "Healthy";
  let cardBg = "bg-aeras-blue/15 border-aeras-blue/30";
  let statusDot = "bg-aeras-blue";
  if (liquidatable) {
    badgeBg = "bg-white/10 text-aeras-negative";
    badgeText = "At risk";
    cardBg = "bg-white/5 border-white/10";
    statusDot = "bg-aeras-negative";
  } else if (warning) {
    badgeBg = "bg-white/10 text-aeras-warning";
    badgeText = "Watch";
    cardBg = "bg-white/5 border-white/10";
    statusDot = "bg-aeras-warning";
  }

  return (
    <div className={`space-y-3 rounded-xl border p-3.5 ${cardBg}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-white/50">
          Position
        </span>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badgeBg}`}
        >
          {badgeText}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          dot="bg-aeras-positive"
          label="Collateral"
          value={`${colUi.toFixed(4)} ${collateral.symbol}`}
          sub={colUsd > 0 ? `$${colUsd.toFixed(2)}` : undefined}
        />
        <Stat
          dot="bg-aeras-warning"
          label="Debt"
          value={`${debtUi.toFixed(2)} ${BORROW_SYMBOL}`}
        />
        <Stat
          dot={statusDot}
          label="LTV"
          value={`${ltvPct.toFixed(1)}% / LT ${liquidationPct.toFixed(0)}%`}
        />
        <Stat
          dot={statusDot}
          label="Health"
          value={health === Infinity ? "—" : `${health.toFixed(2)}×`}
        />
      </div>
      {liquidationPrice != null && (
        <div className="border-t border-white/10 pt-3 text-xs">
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-white/50">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-aeras-negative" />
              Liquidation price
            </span>
            <span className="font-mono tabular-nums text-white">
              ${liquidationPrice.toFixed(2)} / {collateral.symbol}
            </span>
          </div>
          {oraclePrice != null && (
            <div className="mt-1 text-[11px] text-white/50">
              {oraclePrice > liquidationPrice
                ? `${collateral.symbol} would need to drop ${(((oraclePrice - liquidationPrice) / oraclePrice) * 100).toFixed(1)}% from $${oraclePrice.toFixed(2)} to liquidate.`
                : "Position is at the liquidation threshold."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KaminoOperateForm({
  collateral,
  existingPosition,
  collateralBalance,
  collateralBalanceAtomic,
  oraclePrice,
  onSubmit,
  formState,
  resetForm,
}: {
  collateral: KaminoCollateralReserve;
  existingPosition: KaminoPosition | null;
  collateralBalance: number;
  collateralBalanceAtomic: string;
  oraclePrice: number | null;
  onSubmit: (args: { collateralUi: number; borrowUi: number }) => void;
  formState: FormState;
  resetForm: () => void;
}) {
  const safeCFPct = collateral.maxLtvSnapshot * 100 * 0.6; // 60% of max LTV
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

  const existingColUi = existingPosition?.collateralUi ?? 0;
  const existingDebtUi = existingPosition?.debtUsdc ?? 0;
  const totalCollateralUsd =
    oraclePrice != null
      ? (existingColUi + collateralUi) * oraclePrice
      : null;
  const totalDebtUi = existingDebtUi + borrowUi;
  const projectedLtv =
    totalCollateralUsd && totalCollateralUsd > 0
      ? (totalDebtUi / totalCollateralUsd) * 100
      : 0;
  const ltPct = collateral.liquidationThreshold;
  const cfPct = collateral.maxLtvSnapshot * 100;
  const tooClose = projectedLtv >= cfPct;
  const liquidationPrice =
    oraclePrice != null && projectedLtv > 0
      ? oraclePrice * (projectedLtv / ltPct)
      : null;
  const drawdownPct =
    liquidationPrice != null && oraclePrice != null && oraclePrice > 0
      ? ((oraclePrice - liquidationPrice) / oraclePrice) * 100
      : null;
  const ticker = xstockByMint(collateral.collateralMint);
  // Additional borrow that brings the position to the max LTV, less a 1% buffer
  // so interest accrued between preview and settlement can't push it over.
  const maxNewBorrow =
    totalCollateralUsd != null
      ? Math.max(0, totalCollateralUsd * ((cfPct - 1) / 100) - existingDebtUi)
      : 0;
  const submitting = formState.kind === "submitting";
  const disabled =
    !colDeltaValid ||
    !borrowValid ||
    submitting ||
    tooClose ||
    (collateralUi === 0 && borrowUi === 0);
  const maxBorrowUsd = totalCollateralUsd
    ? totalCollateralUsd * (safeCFPct / 100)
    : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={`Deposit ${collateral.symbol}`}
          value={colInput}
          onChange={(v) => {
            setColInput(v);
            resetForm();
          }}
          right={collateral.symbol}
          balanceLabel={`${collateralBalance.toFixed(4)} avail`}
          onMax={() => {
            setColInput(
              atomicToUiString(collateralBalanceAtomic, collateral.decimals),
            );
            resetForm();
          }}
        />
        <NumberField
          label={`Borrow ${BORROW_SYMBOL}`}
          value={borrowInput}
          onChange={(v) => {
            setBorrowInput(v);
            resetForm();
          }}
          right={BORROW_SYMBOL}
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

      {maxNewBorrow > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between text-xs">
            <span className="text-white/50">Borrow amount</span>
            <span className="font-mono tabular-nums text-white">
              {(borrowUi || 0).toFixed(2)} {BORROW_SYMBOL} ·{" "}
              <span className={tooClose ? "text-aeras-negative" : undefined}>
                {projectedLtv.toFixed(1)}% LTV
              </span>
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={maxNewBorrow}
            step={Math.max(maxNewBorrow / 100, 0.01)}
            value={Math.min(Math.max(borrowUi || 0, 0), maxNewBorrow)}
            onChange={(e) => {
              setBorrowInput(Number(e.target.value).toFixed(2));
              resetForm();
            }}
            className="w-full accent-aeras-blue"
          />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/50">
            <span>0</span>
            <span>
              Max {maxNewBorrow.toFixed(2)} {BORROW_SYMBOL}
            </span>
          </div>
        </div>
      )}

      {(collateralUi > 0 || borrowUi > 0) && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs">
          {ticker && oraclePrice != null && liquidationPrice != null && (
            <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
              <PriceChart
                ticker={ticker}
                marker={{ price: liquidationPrice, label: "Safety floor" }}
              />
            </div>
          )}

          {borrowUi > 0 && (
            <div className="flex justify-between">
              <span className="text-white/50">You receive</span>
              <span className="font-mono tabular-nums text-white">
                {borrowUi.toFixed(2)} {BORROW_SYMBOL}
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-white/50">Projected LTV</span>
            <span
              className={`font-mono tabular-nums ${
                tooClose ? "text-aeras-negative" : "text-white"
              }`}
            >
              {projectedLtv.toFixed(1)}% / LT {ltPct.toFixed(0)}%
            </span>
          </div>

          {liquidationPrice != null &&
            drawdownPct != null &&
            drawdownPct > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-white/50">Safety floor</span>
                  <span className="font-mono tabular-nums text-white">
                    ${liquidationPrice.toFixed(2)} · {drawdownPct.toFixed(1)}%
                    below
                  </span>
                </div>
                <p className="text-[11px] text-white/50">
                  {collateral.symbol} would need to fall{" "}
                  {drawdownPct.toFixed(1)}% to ${liquidationPrice.toFixed(2)}{" "}
                  before your position is closed to repay the loan.
                </p>
              </>
            )}

          {tooClose && (
            <p className="text-aeras-negative">
              Borrow exceeds the max LTV ({cfPct.toFixed(0)}%). Reduce the borrow
              amount or add more collateral.
            </p>
          )}
        </div>
      )}

      {formState.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {formState.message}
        </p>
      )}
      {formState.kind === "done" && (
        <a
          href={`${SOLSCAN_TX_BASE}${formState.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">Submitted</div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
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
        {submitting
          ? formState.step
          : borrowUi > 0 && collateralUi > 0
            ? `Deposit ${collateral.symbol} and borrow $${borrowUi.toFixed(2)}`
            : borrowUi > 0
              ? `Borrow $${borrowUi.toFixed(2)} against ${collateral.symbol}`
              : collateralUi > 0
                ? `Deposit ${collateralUi.toFixed(4)} ${collateral.symbol}`
                : existingPosition
                  ? "Update position"
                  : "Open position"}
      </button>
    </div>
  );
}

function KaminoCloseControl({
  collateral,
  position,
  state,
  onClose,
  onReset,
}: {
  collateral: KaminoCollateralReserve;
  position: KaminoPosition;
  state: FormState;
  onClose: () => void;
  onReset: () => void;
}) {
  const debtUi = position.debtUsdc;
  const colUi = position.collateralUi;
  const submitting = state.kind === "submitting";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? state.step
          : `Close · repay ${debtUi.toFixed(2)} ${BORROW_SYMBOL} + withdraw ${colUi.toFixed(4)} ${collateral.symbol}`}
      </button>
      <p className="text-[11px] text-white/50">
        {debtUi > 0
          ? `Needs ≥ ${debtUi.toFixed(2)} ${BORROW_SYMBOL} in your wallet to repay the loan plus accrued interest, then withdraws your collateral.`
          : `Withdraws your ${collateral.symbol} collateral back to your wallet.`}
      </p>
      {state.kind === "error" && (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {state.message}
          <button
            type="button"
            onClick={onReset}
            className="ml-2 text-white/50 underline-offset-2 hover:text-white hover:underline"
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
          className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
        >
          <div className="font-medium text-aeras-positive">Position closed</div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
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
        <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          {label}
        </label>
        {balanceLabel && (
          <span className="font-mono text-[11px] text-white/50">
            {balanceLabel}
            {onMax && (
              <button
                type="button"
                onClick={onMax}
                className="ml-1 text-white/70 underline-offset-2 hover:text-white hover:underline"
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
          className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
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
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  dot?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-white/50">
        {dot && (
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        )}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-white">
        {value}
        {sub && <span className="text-white/50"> · {sub}</span>}
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
