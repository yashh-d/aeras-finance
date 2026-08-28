"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import type { MarketStat } from "@/lib/borrow/use-market-stats";
import { createPortal } from "react-dom";

import {
  BORROW_PILL_CLASS,
  MarketDetailHeader,
  type BorrowMode,
} from "@/components/BorrowMarketDetail";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  getConnection,
} from "@/lib/solana/balances";
import { sendAndConfirm } from "@/lib/solana/send-confirm";

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
  // Rate and size for this market, already fetched for the collapsed row. Passed
  // down so the detail's stat grid renders with the list's figures rather than
  // reading the reserve a second time.
  stat: MarketStat | undefined;
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
  stat,
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

  // Which of the two actions is on screen. Borrow first: a user opening a market
  // they have no position in is here to draw, not to repay.
  const [mode, setMode] = useState<BorrowMode>("borrow");
  // Header cell the borrow form portals its submit into. See BorrowMarketDetail.
  const [borrowSlot, setBorrowSlot] = useState<HTMLDivElement | null>(null);

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

  // Derive this card's position from the parent's single obligation fetch rather
  // than every card round-tripping on mount. With the full market catalog
  // rendered, self-fetching would fire one identical request per card (and could
  // paint several "couldn't load position" boxes if the API hiccups). Only the
  // one card matching the user's actual collateral shows a live position; the
  // rest stay inert. After an open/close, the acting card still calls
  // refreshPosition directly for an immediate update.
  useEffect(() => {
    setPosition(
      initialPosition &&
        initialPosition.collateral.collateralMint === collateral.collateralMint
        ? initialPosition
        : null,
    );
    setPositionError(null);
  }, [initialPosition, collateral.collateralMint]);

  const oraclePrice =
    position?.oraclePriceUsd ??
    prices?.[collateral.collateralMint]?.usdPrice ??
    null;

  // What this market will lend against collateral deposited here plus the same
  // stock sitting in the wallet, less what is already drawn. Wallet stock counts
  // because the form below deposits it as part of the borrow.
  //
  // Capped by undrawn USDC in the reserve: earned headroom is not drawable from
  // a reserve that has already lent everything out, and quoting it would let the
  // user submit a borrow that fails on chain.
  const availableUsd = useMemo(() => {
    if (oraclePrice == null) return null;
    const collateralUi = (position?.collateralUi ?? 0) + collateralBalance;
    const headroomUsd =
      collateralUi * oraclePrice * collateral.maxLtvSnapshot -
      (position?.debtUsdc ?? 0);
    const liquidityUsd = stat?.liquidityUsd ?? Infinity;
    return Math.max(0, Math.min(headroomUsd, liquidityUsd));
  }, [
    oraclePrice,
    position?.collateralUi,
    position?.debtUsdc,
    collateralBalance,
    collateral.maxLtvSnapshot,
    stat?.liquidityUsd,
  ]);

  // Sign, submit, and confirm one base64 transaction. Shared by both legs of the
  // open and close flows.
  const signSend = useCallback(
    async (base64Tx: string): Promise<string> => {
      const conn = getConnection();
      const signed = await signTxBase64(base64Tx);
      const bytes = base64ToBytes(signed);
      return sendAndConfirm(conn, bytes);
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
    <div className="space-y-5 rounded-xl border border-white/10 bg-white/5 p-5">
      <MarketDetailHeader
        mint={collateral.collateralMint}
        symbol={collateral.symbol}
        borrowSymbol={BORROW_SYMBOL}
        availableUsd={availableUsd}
        owedUsd={position?.debtUsdc ?? 0}
        mode={mode}
        onModeChange={setMode}
        canRepay={hasPosition}
        borrowActionSlot={setBorrowSlot}
      />

      {positionError ? (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
          <div className="font-medium text-white">
            Couldn&apos;t load position
          </div>
          <div className="mt-1 break-all text-white/50">{positionError}</div>
        </div>
      ) : hasPosition && position ? (
        <KaminoPositionCard
          collateral={collateral}
          position={position}
          oraclePrice={oraclePrice}
        />
      ) : null}

      {mode === "repay" && hasPosition && position ? (
        <KaminoCloseControl
          collateral={collateral}
          position={position}
          state={closingState}
          onClose={handleClose}
          onReset={() => setClosingState({ kind: "idle" })}
        />
      ) : mode === "borrow" ? (
        <KaminoOperateForm
          collateral={collateral}
          existingPosition={hasPosition ? position : null}
          collateralBalance={collateralBalance}
          collateralBalanceAtomic={collateralBalanceAtomic}
          oraclePrice={oraclePrice}
          aprPct={stat?.borrowAprPct ?? null}
          onSubmit={handleSubmit}
          formState={formState}
          resetForm={() => setFormState({ kind: "idle" })}
          actionSlot={borrowSlot}
        />
      ) : null}
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
  aprPct,
  onSubmit,
  formState,
  resetForm,
  actionSlot,
}: {
  collateral: KaminoCollateralReserve;
  existingPosition: KaminoPosition | null;
  collateralBalance: number;
  collateralBalanceAtomic: string;
  oraclePrice: number | null;
  // Annual borrow rate, shown against the amount being drawn rather than as a
  // standalone market figure.
  aprPct: number | null;
  onSubmit: (args: { collateralUi: number; borrowUi: number }) => void;
  formState: FormState;
  resetForm: () => void;
  // Header cell to render the submit into; falls back in place when absent.
  actionSlot: HTMLElement | null;
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
    // The button borrows, so it waits for an amount to borrow. See the Jupiter
    // card's matching change.
    borrowUi <= 0;
  const submitButton = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSubmit({ collateralUi, borrowUi })}
      className={BORROW_PILL_CLASS}
    >
      {/* See the Jupiter card: one word until there is an amount to borrow. */}
      {submitting
        ? formState.step
        : borrowUi > 0
          ? `Borrow $${borrowUi.toFixed(2)} against ${collateral.symbol}`
          : "Borrow"}
    </button>
  );

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

          {borrowUi > 0 && aprPct != null && (
            <div className="flex justify-between">
              <span className="text-white/50">Interest</span>
              <span className="font-mono tabular-nums text-white">
                {aprPct.toFixed(2)}% APY
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-white/50">Loan vs collateral</span>
            <span
              className={`font-mono tabular-nums ${
                tooClose ? "text-aeras-negative" : "text-white"
              }`}
            >
              {projectedLtv.toFixed(1)}% · closes at {ltPct.toFixed(0)}%
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

      {/* Rendered here, shown in the header's Borrow pill. Same reasoning as
          the Jupiter card: the label and the enabled state are decided by this
          form, only the position on screen belongs to the header. */}
      {actionSlot ? createPortal(submitButton, actionSlot) : submitButton}
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
