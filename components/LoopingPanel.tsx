"use client";

// Looping (multiply / unwind). Builds a leveraged xStock position against USDC
// debt in one atomic flashloan transaction, and closes it the same way. The
// preview block shows the resulting leverage, exposure, LTV, liquidation price,
// borrow carry, and live swap price impact before the user signs.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import BN from "bn.js";

import { usePrivy } from "@privy-io/react-auth";

import { AssetLogo } from "@/components/AssetLogo";
import { PriceChart } from "@/components/PriceChart";
import {
  clearLoopRecord,
  EMPTY_LOOP_RECORD,
  fetchLoopRecord,
  loopStorageKey,
  readCachedLoopRecord,
  saveLoopRecord,
  writeCachedLoopRecord,
  type LoopRecord,
} from "@/lib/loops-client";
import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { assetIdentity, xstockByMint } from "@/lib/jupiter/xstocks";
import {
  fetchLiveVaultStateViaProxy,
  fetchPositionState,
  findExistingNftId,
  fromAtomicBN,
  toAtomicBN,
  XSTOCK_BORROW_VAULTS,
  type LiveVaultState,
  type UserPositionState,
  type XStockBorrowVault,
} from "@/lib/jupiter/borrow";
import {
  borrowUsdForLeverage,
  buildMultiplyTx,
  buildUnwindTx,
  fetchSwapQuoteViaProxy,
  maxLeverageForVault,
  SWAP_ACCOUNT_BUDGET,
  type SwapQuote,
} from "@/lib/jupiter/multiply";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import {
  atomicToUiString,
  getConnection,
  type AccountBalances,
} from "@/lib/solana/balances";
import { SolanaSendError, sendAndConfirm } from "@/lib/solana/send-confirm";

// Floor of the leverage slider. 1.0x is not a loop, and the step below it would
// borrow nothing.
const LEVERAGE_MIN = 1.1;

const MULTIPLY_SLIPPAGE_BPS = 100;
const UNWIND_SLIPPAGE_BPS = 150;
const PREVIEW_DEBOUNCE_MS = 450;

interface Props {
  walletAddress: string | undefined;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}

import { GLASS_SURFACE } from "@/lib/ui/surface";

export function LoopingCard({
  walletAddress,
  balances,
  prices,
  onRefresh,
}: Props) {
  const [selectedVaultId, setSelectedVaultId] = useState<number | null>(null);
  const [vaultsWithPosition, setVaultsWithPosition] = useState<Set<number>>(
    () => new Set(),
  );

  // Show a vault if the user holds its collateral or already has a loop open in
  // it (so an open loop stays visible after the wallet balance is deposited).
  // Keyed on the loop marker, not the shared borrow NFT: a plain borrow in a
  // vault should not pull that vault into the looping surface.
  useEffect(() => {
    if (typeof window === "undefined" || !walletAddress) return;
    const ids = new Set<number>();
    for (const v of XSTOCK_BORROW_VAULTS) {
      // Via the shared reader, not a literal "1": the cached record is JSON now,
      // and a string compare here silently dropped open loops off this list once
      // their wallet balance had been deposited.
      if (readCachedLoopRecord(loopStorageKey(walletAddress, v.vaultId)).managed) {
        ids.add(v.vaultId);
      }
    }
    setVaultsWithPosition(ids);
  }, [walletAddress]);

  const eligible = XSTOCK_BORROW_VAULTS.filter(
    (v) =>
      (balances?.xstocks[v.collateralMint] ?? 0) > 0 ||
      vaultsWithPosition.has(v.vaultId),
  );

  const activeVaultId =
    selectedVaultId ?? (eligible.length > 0 ? eligible[0].vaultId : null);
  const activeVault =
    XSTOCK_BORROW_VAULTS.find((v) => v.vaultId === activeVaultId) ?? null;

  return (
    <div className={`space-y-4 ${GLASS_SURFACE} p-5 lg:p-6`}>
      {/* Section label only. "Leveraged exposure" was the title here and is now
          the hero's label further down, where it sits on the number it names. */}
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Looping
        </div>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aeras-warning">
          Medium risk
        </span>
      </div>

      <p className="text-xs text-white/50">
        Borrow USDC against your tokenized stock, buy more of the same stock, and
        deposit it as collateral. One transaction multiplies your exposure. Your
        liquidation price rises with leverage.
      </p>

      {eligible.length === 0 ? (
        <p className="rounded-xl border border-aeras-blue/30 bg-aeras-blue/15 px-4 py-3 text-sm text-white/60">
          Buy{" "}
          {XSTOCK_BORROW_VAULTS.map((v, i) => (
            <span key={v.vaultId}>
              {i > 0 && ", "}
              <span className="font-medium text-aeras-blue">
                {v.collateralSymbol}
              </span>
            </span>
          ))}{" "}
          to open a leveraged position.
        </p>
      ) : (
        <>
          {eligible.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {eligible.map((v) => (
                <button
                  key={v.vaultId}
                  type="button"
                  onClick={() => setSelectedVaultId(v.vaultId)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    v.vaultId === activeVaultId
                      ? "bg-white/15 text-white"
                      : "bg-white/5 text-white/50 hover:text-white"
                  }`}
                >
                  {v.collateralSymbol}
                </button>
              ))}
            </div>
          )}

          {activeVault && walletAddress && (
            <LoopController
              key={activeVault.vaultId}
              vault={activeVault}
              walletAddress={walletAddress}
              collateralBalance={
                balances?.xstocks[activeVault.collateralMint] ?? 0
              }
              collateralBalanceAtomic={
                balances?.xstocksAtomic[activeVault.collateralMint] ?? "0"
              }
              prices={prices}
              onRefresh={onRefresh}
            />
          )}
        </>
      )}
    </div>
  );
}

type TxState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

// Loop bookkeeping — whether a vault is leverage-managed, and the equity that
// went in — lives in Supabase. See lib/loops-client.ts and lib/loops.ts.
//
// **Cost basis is not on chain.** Jupiter Lend's position carries collateral,
// debt and liquidation status and nothing else, so the basis has to be recorded
// when the loop opens or it does not exist. It used to be recorded in
// localStorage, which meant it died with the browser: a position opened on a
// phone showed no P&L on a laptop, and read as a plain borrow besides.
//
// localStorage is still read for the first paint and still written as a cache,
// but the server is authoritative and overwrites it on load.

function LoopController({
  vault,
  walletAddress,
  collateralBalance,
  collateralBalanceAtomic,
  prices,
  onRefresh,
}: {
  vault: XStockBorrowVault;
  walletAddress: string;
  collateralBalance: number;
  collateralBalanceAtomic: string;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  const signTxBase64 = useSignSolanaTxBase64();
  const { getAccessToken } = usePrivy();
  const [live, setLive] = useState<LiveVaultState | null>(null);
  const [position, setPosition] = useState<UserPositionState | null>(null);
  const [nftId, setNftId] = useState<number | null>(null);
  const [recovering, setRecovering] = useState(true);

  const maxLeverage = maxLeverageForVault(vault);
  // The slider's own ceiling: the vault max, floored to a whole step, and never
  // below one step above the minimum so the track cannot collapse to zero width.
  const leverageMax = Math.max(
    LEVERAGE_MIN + 0.1,
    Math.floor(maxLeverage * 10) / 10,
  );
  const [leverage, setLeverage] = useState(() => Math.min(2, maxLeverage));
  const [baseInput, setBaseInput] = useState<string>(() =>
    collateralBalance > 0 ? collateralBalance.toFixed(4) : "0",
  );
  const [preview, setPreview] = useState<SwapQuote | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [openState, setOpenState] = useState<TxState>({ kind: "idle" });
  const [closeState, setCloseState] = useState<TxState>({ kind: "idle" });

  const storageKey = `aeras:borrow:${walletAddress}:${vault.vaultId}`;
  const persistNftId = useCallback(
    (id: number) => {
      localStorage.setItem(storageKey, String(id));
      setNftId(id);
    },
    [storageKey],
  );

  // Flag that this vault's position is leverage-managed. The borrow and loop
  // surfaces share one position NFT per vault, so this is the only thing that
  // distinguishes a loop from a plain borrow. Absence is treated as a plain
  // borrow, which under-labels a loop whose localStorage was cleared but never
  // presents an unchosen leverage figure as if the user had picked it.
  const loopKey = loopStorageKey(walletAddress, vault.vaultId);
  const [loopRecord, setLoopRecord] = useState<LoopRecord>(() =>
    readCachedLoopRecord(loopKey),
  );
  const loopManaged = loopRecord.managed;

  // Reconcile the cached hint with the server, and carry a pre-Supabase local
  // record up on the way past. A failure here is not surfaced: the cache is a
  // usable answer, and a banner about bookkeeping sync would be noise on a
  // screen about money.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await fetchLoopRecord(getAccessToken, vault.vaultId);
        if (cancelled) return;
        const cached = readCachedLoopRecord(loopKey);
        // Local knows something the server does not: a loop opened before this
        // table existed. Push it up once, then adopt the server's answer.
        if (!remote.managed && cached.managed) {
          const saved = await saveLoopRecord(
            getAccessToken,
            vault.vaultId,
            cached.basisUsd,
            "seed",
          );
          if (cancelled) return;
          setLoopRecord(saved);
          writeCachedLoopRecord(loopKey, saved);
          return;
        }
        setLoopRecord(remote);
        writeCachedLoopRecord(loopKey, remote);
      } catch {
        // Keep the cached value.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken, loopKey, vault.vaultId]);

  const markLoopManaged = useCallback(
    async (basisUsd: number | null) => {
      const optimistic: LoopRecord = {
        managed: true,
        basisUsd: basisUsd != null && basisUsd > 0 ? basisUsd : null,
      };
      setLoopRecord(optimistic);
      writeCachedLoopRecord(loopKey, optimistic);
      try {
        const saved = await saveLoopRecord(
          getAccessToken,
          vault.vaultId,
          optimistic.basisUsd,
          "add",
        );
        setLoopRecord(saved);
        writeCachedLoopRecord(loopKey, saved);
      } catch {
        // The loop is open either way. The cache carries it until the next load
        // reconciles, which is better than failing a successful transaction.
      }
    },
    [getAccessToken, loopKey, vault.vaultId],
  );

  const clearLoopManaged = useCallback(async () => {
    setLoopRecord(EMPTY_LOOP_RECORD);
    writeCachedLoopRecord(loopKey, EMPTY_LOOP_RECORD);
    try {
      await clearLoopRecord(getAccessToken, vault.vaultId);
    } catch {}
  }, [getAccessToken, loopKey, vault.vaultId]);

  // Discover an existing position NFT (shared with the plain-borrow flow).
  useEffect(() => {
    let cancelled = false;
    const raw =
      typeof window === "undefined" ? null : localStorage.getItem(storageKey);
    const stored = raw ? Number(raw) : NaN;
    if (Number.isInteger(stored) && stored > 0) {
      setNftId(stored);
      setRecovering(false);
      return;
    }
    setRecovering(true);
    (async () => {
      try {
        const found = await findExistingNftId(walletAddress, vault, getConnection());
        if (!cancelled && found != null) persistNftId(found);
      } catch (err) {
        console.error("[loop recover]", err);
      } finally {
        if (!cancelled) setRecovering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, vault, storageKey, persistNftId]);

  const refreshLive = useCallback(async () => {
    try {
      setLive(await fetchLiveVaultStateViaProxy(vault.vaultId));
    } catch (err) {
      console.error("[loop live]", err);
    }
  }, [vault.vaultId]);

  const refreshPosition = useCallback(async () => {
    if (!nftId) {
      setPosition(null);
      return;
    }
    try {
      const state = await fetchPositionState(vault, nftId, getConnection());
      setPosition(state);
    } catch (err) {
      console.error("[loop position]", err);
    }
  }, [nftId, vault]);

  useEffect(() => {
    refreshLive();
  }, [refreshLive]);
  useEffect(() => {
    refreshPosition();
  }, [refreshPosition]);

  const oraclePrice =
    live?.oraclePriceUsd ?? prices?.[vault.collateralMint]?.usdPrice ?? null;
  const borrowRatePct = live ? live.borrowRateAnnual * 100 : null;
  const ltPct = vault.liquidationThreshold / 10;

  const baseUi = Number(baseInput);
  const baseUsd = oraclePrice != null ? baseUi * oraclePrice : null;
  const borrowUsd =
    baseUsd != null ? borrowUsdForLeverage(baseUsd, leverage) : null;

  // Debounced live preview quote (USDC -> collateral for the borrow leg).
  const previewSeq = useRef(0);
  useEffect(() => {
    if (baseUsd == null || borrowUsd == null || borrowUsd < 1) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const quote = await fetchSwapQuoteViaProxy({
          inputMint: vault.borrowMint,
          outputMint: vault.collateralMint,
          amountAtomic: toAtomicBN(borrowUsd, vault.borrowDecimals).toString(),
          slippageBps: MULTIPLY_SLIPPAGE_BPS,
          // Same account budget the open path quotes with, so the figures below
          // describe the route that will actually be sent.
          maxAccounts: SWAP_ACCOUNT_BUDGET,
        });
        if (seq !== previewSeq.current) return;
        setPreview(quote);
        setPreviewErr(null);
      } catch (err) {
        if (seq !== previewSeq.current) return;
        setPreview(null);
        setPreviewErr(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [baseUsd, borrowUsd, vault.borrowMint, vault.collateralMint, vault.borrowDecimals]);

  // Resulting position math from the live quote's guaranteed minimum output.
  const swappedUi = preview
    ? fromAtomicBN(new BN(preview.otherAmountThreshold), vault.collateralDecimals)
    : null;
  const exposureUi = swappedUi != null ? baseUi + swappedUi : null;
  const exposureUsd =
    exposureUi != null && oraclePrice != null ? exposureUi * oraclePrice : null;
  const projectedLtv =
    exposureUsd && exposureUsd > 0 && borrowUsd != null
      ? (borrowUsd / exposureUsd) * 100
      : null;
  const liquidationPrice =
    exposureUi && exposureUi > 0 && borrowUsd != null
      ? borrowUsd / (exposureUi * (vault.liquidationThreshold / 1000))
      : null;
  const drawdownPct =
    liquidationPrice != null && oraclePrice != null && oraclePrice > 0
      ? ((oraclePrice - liquidationPrice) / oraclePrice) * 100
      : null;
  const priceImpactPct = preview ? Number(preview.priceImpactPct) * 100 : null;
  const carryPct = borrowRatePct != null ? borrowRatePct * (leverage - 1) : null;

  const ticker = xstockByMint(vault.collateralMint);
  const baseValid = Number.isFinite(baseUi) && baseUi > 0 && baseUi <= collateralBalance;
  const submitting = openState.kind === "submitting";
  const canOpen =
    baseValid &&
    borrowUsd != null &&
    borrowUsd >= 1 &&
    preview != null &&
    !previewing &&
    !recovering &&
    !submitting;

  async function handleOpen() {
    if (borrowUsd == null) return;
    setOpenState({ kind: "submitting" });
    try {
      const conn = getConnection();
      const { base64Tx, nftId: newNft } = await buildMultiplyTx({
        vault,
        positionId: nftId ?? 0,
        initialCollateralAtomic: clampToBalance(
          toAtomicBN(baseUi, vault.collateralDecimals),
          collateralBalanceAtomic,
        ),
        borrowUsdcAtomic: toAtomicBN(borrowUsd, vault.borrowDecimals),
        signerAddress: walletAddress,
        connection: conn,
        slippageBps: MULTIPLY_SLIPPAGE_BPS,
      });
      const signed = await signTxBase64(base64Tx);
      const sig = await sendAndConfirm(conn, base64ToBytes(signed));
      const finalNft = newNft ?? nftId;
      if (finalNft) persistNftId(finalNft);
      // The basis is what the user put in, not what the position is worth a
      // moment later. Swap cost, price impact and fees land between the two, and
      // they are real money spent — counting them as an immediate small loss is
      // correct, not an artefact.
      markLoopManaged(baseUsd);
      setOpenState({ kind: "done", signature: sig });
      await onRefresh();
      await Promise.all([refreshLive(), refreshPosition()]);
    } catch (err) {
      console.error("[loop open]", err);
      setOpenState({ kind: "error", message: readableError(err) });
    }
  }

  async function handleClose() {
    if (!position || !nftId || oraclePrice == null) return;
    setCloseState({ kind: "submitting" });
    try {
      const conn = getConnection();
      const { base64Tx } = await buildUnwindTx({
        vault,
        positionId: nftId,
        collateralAtomic: position.collateralAtomic,
        debtAtomic: position.debtAtomic,
        oraclePriceUsd: oraclePrice,
        signerAddress: walletAddress,
        connection: conn,
        slippageBps: UNWIND_SLIPPAGE_BPS,
      });
      const signed = await signTxBase64(base64Tx);
      const sig = await sendAndConfirm(conn, base64ToBytes(signed));
      // This vault is no longer leverage-managed; drop the tag so a later plain
      // borrow in the same vault closes via repay+withdraw, not an unwind.
      clearLoopManaged();
      setCloseState({ kind: "done", signature: sig });
      await onRefresh();
      await Promise.all([refreshLive(), refreshPosition()]);
    } catch (err) {
      console.error("[loop close]", err);
      setCloseState({ kind: "error", message: readableError(err) });
    }
  }

  // Only surface a position here when this vault is leverage-managed. The borrow
  // and loop surfaces share one NFT per vault, so an on-chain position alone is
  // not enough: a plain borrow belongs to the Borrow panel, not looping.
  const hasPosition =
    loopManaged &&
    position != null &&
    (position.collateralAtomic.gtn(0) || position.debtAtomic.gtn(0));

  return (
    <div className="space-y-4">
      {/* Hero, matching the borrow market header in components/BorrowMarketDetail.
          Exposure is the figure the leverage slider exists to move, and it used
          to be the first of six small preview rows that appeared only once an
          amount had been typed. Borrow leads with its headline number; this now
          does the same. */}
      <div className="flex flex-col items-center gap-3 text-center">
        <AssetLogo
          xstock={assetIdentity(vault.collateralMint, vault.collateralSymbol)}
          size={44}
        />
        <div className="font-light text-xl tracking-tight text-white">
          {vault.collateralSymbol}
        </div>
      </div>

      <div className="space-y-1 text-center">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          Leveraged exposure
        </div>
        <div className="font-mono text-[2.25rem] font-light leading-none tracking-tight tabular-nums text-white">
          {/* The quote's figure, not base × leverage. Exposure is sized from the
              swap's guaranteed minimum out, so the headline is what the position
              will actually be worth rather than what was asked for. That is why
              it waits for the route instead of showing an idealised number and
              correcting it a beat later. */}
          {exposureUsd != null
            ? `$${exposureUsd.toFixed(2)}`
            : previewing
              ? "…"
              : "—"}
        </div>
        <div className="text-xs text-white/50">
          {baseValid ? (
            <>
              <span className="font-mono tabular-nums text-white">
                {baseUi.toFixed(4)}
              </span>{" "}
              {vault.collateralSymbol} at{" "}
              <span className="font-mono tabular-nums text-white">
                {leverage.toFixed(1)}×
              </span>
            </>
          ) : (
            <>Set an amount and leverage below</>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          label="Oracle price"
          value={oraclePrice != null ? `$${oraclePrice.toFixed(2)}` : "…"}
        />
        <Stat
          label="Borrow APY"
          value={borrowRatePct != null ? `${borrowRatePct.toFixed(2)}%` : "…"}
        />
      </div>

      {hasPosition && position && (
        <OpenPositionCard
          vault={vault}
          position={position}
          oraclePrice={oraclePrice}
          basisUsd={loopRecord.basisUsd}
          state={closeState}
          onClose={handleClose}
          onReset={() => setCloseState({ kind: "idle" })}
        />
      )}

      {/* Base collateral to seed the loop. */}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Collateral to loop
          </label>
          <span className="font-mono text-[11px] text-white/50">
            {collateralBalance.toFixed(4)} {vault.collateralSymbol}
            <button
              type="button"
              onClick={() => {
                setBaseInput(
                  atomicToUiString(
                    collateralBalanceAtomic,
                    vault.collateralDecimals,
                  ),
                );
                setOpenState({ kind: "idle" });
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
            value={baseInput}
            onChange={(e) => {
              setBaseInput(e.target.value);
              if (openState.kind !== "idle") setOpenState({ kind: "idle" });
            }}
            className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 pr-16 font-mono text-sm tabular-nums text-white placeholder:text-white/30 focus:border-aeras-blue focus:outline-none focus:ring-2 focus:ring-aeras-blue-soft"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-white/50">
            {vault.collateralSymbol}
          </span>
        </div>
      </div>

      {/* Leverage slider. */}
      <div>
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="text-white/50">Target leverage</span>
          <span className="font-mono tabular-nums text-white">
            {leverage.toFixed(1)}×
          </span>
        </div>
        <input
          type="range"
          min={LEVERAGE_MIN}
          max={leverageMax}
          step={0.1}
          value={leverage}
          onChange={(e) => {
            setLeverage(Number(e.target.value));
            if (openState.kind !== "idle") setOpenState({ kind: "idle" });
          }}
          // Unitless 0-1, read by .aeras-range to place the fill edge under the
          // thumb's centre. Clamped because `leverage` is state and a cap that
          // drops (the vault's max moves with its collateral factor) can leave it
          // briefly above the current maximum.
          style={
            {
              "--range-progress": Math.min(
                1,
                Math.max(
                  0,
                  (leverage - LEVERAGE_MIN) / (leverageMax - LEVERAGE_MIN),
                ),
              ),
            } as CSSProperties
          }
          className="aeras-range"
        />
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-white/50">
          <span>{LEVERAGE_MIN.toFixed(1)}×</span>
          <span>Max {maxLeverage.toFixed(1)}×</span>
        </div>
      </div>

      {/* Preview before entering. */}
      {baseValid && borrowUsd != null && borrowUsd >= 1 && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs">
          {ticker && oraclePrice != null && liquidationPrice != null && (
            <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
              <PriceChart
                ticker={ticker}
                marker={{ price: liquidationPrice, label: "Liquidation" }}
              />
            </div>
          )}

          {/* Quantity only. The dollar value of the same exposure is the
              headline above, and printing it twice invites the two to drift. */}
          <PreviewRow
            label="Exposure"
            value={
              exposureUi != null
                ? `${exposureUi.toFixed(4)} ${vault.collateralSymbol}`
                : previewing
                  ? "…"
                  : "—"
            }
          />
          <PreviewRow
            label="Borrow"
            value={`${borrowUsd.toFixed(2)} ${vault.borrowSymbol}`}
          />
          <PreviewRow
            label="Loan vs collateral"
            value={
              projectedLtv != null
                ? `${projectedLtv.toFixed(1)}% · closes at ${ltPct.toFixed(0)}%`
                : "—"
            }
            warn={projectedLtv != null && projectedLtv >= ltPct * 0.9}
          />
          {liquidationPrice != null && drawdownPct != null && (
            <PreviewRow
              label="Liquidation price"
              value={`$${liquidationPrice.toFixed(2)} · ${drawdownPct.toFixed(1)}% below`}
            />
          )}
          {carryPct != null && (
            <PreviewRow
              label="Borrow carry"
              value={`-${carryPct.toFixed(2)}% APY`}
            />
          )}
          {priceImpactPct != null && (
            <PreviewRow
              label="Price impact"
              value={`${priceImpactPct < 0.01 ? "<0.01" : priceImpactPct.toFixed(2)}%`}
              warn={priceImpactPct >= 1}
            />
          )}
          {previewErr && (
            <p className="text-aeras-warning">
              Live route unavailable right now. Try again in a moment.
            </p>
          )}
        </div>
      )}

      {openState.kind === "error" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-aeras-negative">
          {openState.message}
        </p>
      )}
      {openState.kind === "done" && (
        <TxLink signature={openState.signature} label="Position opened" />
      )}

      <button
        type="button"
        disabled={!canOpen}
        onClick={handleOpen}
        className="w-full rounded-xl bg-aeras-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-aeras-blue-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {recovering
          ? "Checking for an existing position…"
          : submitting
            ? "Signing and submitting…"
            : hasPosition
              ? "Add leverage"
              : "Open looped position"}
      </button>
    </div>
  );
}

// Only rendered for a leverage-managed position (see `hasPosition`). A plain
// borrow shares the same position NFT but belongs to the Borrow panel, so it is
// filtered out before it reaches this card.
function OpenPositionCard({
  vault,
  position,
  oraclePrice,
  basisUsd,
  state,
  onClose,
  onReset,
}: {
  vault: XStockBorrowVault;
  position: UserPositionState;
  oraclePrice: number | null;
  // Equity put in at open. Null when it was never recorded, in which case no
  // P&L is shown at all. See LoopRecord.
  basisUsd: number | null;
  state: TxState;
  onClose: () => void;
  onReset: () => void;
}) {
  const colUi = fromAtomicBN(position.collateralAtomic, vault.collateralDecimals);
  const debtUi = fromAtomicBN(position.debtAtomic, vault.borrowDecimals);
  const colUsd = oraclePrice != null ? colUi * oraclePrice : null;
  const ltvPct = colUsd && colUsd > 0 ? (debtUi / colUsd) * 100 : 0;
  const equityUsd = colUsd != null ? colUsd - debtUi : null;
  // Current leverage = exposure / equity.
  const currentLeverage =
    colUsd != null && equityUsd != null && equityUsd > 0
      ? colUsd / equityUsd
      : null;
  const ltPct = vault.liquidationThreshold / 10;
  const submitting = state.kind === "submitting";

  // Price at which this position's collateral no longer covers the debt at the
  // liquidation threshold. Drawn on the chart so the user sees the gap to spot.
  const ticker = xstockByMint(vault.collateralMint);
  const liquidationPrice =
    colUi > 0
      ? debtUi / (colUi * (vault.liquidationThreshold / 1000))
      : null;
  const drawdownPct =
    liquidationPrice != null && oraclePrice != null && oraclePrice > 0
      ? ((oraclePrice - liquidationPrice) / oraclePrice) * 100
      : null;

  // P&L against what went in. Only when a basis was recorded: without one the
  // card shows the net value and stops there.
  const pnlUsd =
    equityUsd != null && basisUsd != null ? equityUsd - basisUsd : null;
  const pnlPct =
    pnlUsd != null && basisUsd != null && basisUsd > 0
      ? (pnlUsd / basisUsd) * 100
      : null;
  // Zero is not a gain. Below half a cent the sign is noise, so it reads flat
  // rather than picking a colour a rounding error chose.
  const pnlFlat = pnlUsd != null && Math.abs(pnlUsd) < 0.005;

  return (
    // Neutral surface, matching the asset panel on Home. The blue wash used to
    // mark this card as special, but "you are leveraged" is not a state the UI
    // should be cheerful about, and it fought the chart's own colour.
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
        Open loop · #{position.nftId}
      </div>

      {/* Identity left, the two numbers right — the same header row the asset
          panel on Home uses above its chart. Price/change maps cleanly onto net
          value/P&L: a current figure and how far it has moved.

          The one deviation is the "Net value" label. An unlabelled figure works
          on Home because a number above a price chart reads as the price; here
          it is the position's equity while the chart below plots the asset, and
          leaving those two to be told apart by context is not a risk worth
          taking on a screen about money. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {ticker && <AssetLogo xstock={ticker} size={32} />}
          <div>
            <div className="text-sm font-medium tracking-tight text-white">
              {ticker?.name ?? vault.collateralSymbol}
            </div>
            <div className="text-xs text-white/50">
              {vault.collateralSymbol}
              {currentLeverage != null && ` · ${currentLeverage.toFixed(2)}×`}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Net value
          </div>
          <div className="font-mono text-sm tabular-nums text-white">
            {equityUsd != null ? `$${equityUsd.toFixed(2)}` : "—"}
          </div>
          {pnlUsd != null ? (
            <div
              className={`font-mono text-xs tabular-nums ${
                pnlFlat
                  ? "text-white/50"
                  : pnlUsd > 0
                    ? "text-aeras-positive"
                    : "text-aeras-negative"
              }`}
            >
              {pnlFlat ? "" : pnlUsd > 0 ? "+" : "−"}$
              {Math.abs(pnlUsd).toFixed(2)}
              {pnlPct != null &&
                ` (${Math.abs(pnlPct).toFixed(1)}%)`}
            </div>
          ) : (
            <div className="text-xs text-white/50">No entry recorded</div>
          )}
        </div>
      </div>

      {/* Unboxed and headingless, as on Home: the row above already names the
          asset, and the card around this is border enough. */}
      {ticker && (
        <PriceChart
          ticker={ticker}
          heightClass="h-40"
          showHeading={false}
          marker={
            liquidationPrice != null
              ? { price: liquidationPrice, label: "Liquidation" }
              : undefined
          }
        />
      )}

      {/* Liquidation keeps its own full-width row rather than joining the grid.
          It is the number that decides whether the position survives, and it
          reads as one more statistic when it sits among them. */}
      {liquidationPrice != null && drawdownPct != null && (
        <div className="flex items-baseline justify-between rounded-lg bg-white/5 px-3 py-2 text-[11px]">
          <span className="text-white/50">Liquidation price</span>
          <span className="font-mono tabular-nums text-aeras-warning">
            ${liquidationPrice.toFixed(2)} · {drawdownPct.toFixed(1)}% below
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          label="Exposure"
          value={`${colUi.toFixed(4)} ${vault.collateralSymbol}`}
          sub={colUsd != null ? `$${colUsd.toFixed(2)}` : undefined}
        />
        <Stat label="Debt" value={`${debtUi.toFixed(2)} ${vault.borrowSymbol}`} />
        <Stat
          label="LTV"
          value={`${ltvPct.toFixed(1)}% / LT ${ltPct.toFixed(0)}%`}
        />
        {/* Equity is the headline. Its counterpart — what went in — is the
            useful thing to sit beside it, since the two are what the P&L is the
            difference of. */}
        <Stat
          label="Entry"
          value={basisUsd != null ? `$${basisUsd.toFixed(2)}` : "—"}
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Unwinding position…" : "Unwind position"}
      </button>
      <p className="text-[11px] text-white/50">
        This sells enough {vault.collateralSymbol} to repay the{" "}
        {debtUi.toFixed(2)} {vault.borrowSymbol} debt in one transaction. No USDC
        needed in your wallet. Remaining {vault.collateralSymbol} returns to you.
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
        <TxLink signature={state.signature} label="Position unwound" />
      )}
    </div>
  );
}

function PreviewRow({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-white/50">{label}</span>
      <span
        className={`font-mono tabular-nums ${warn ? "text-aeras-warning" : "text-white"}`}
      >
        {value}
      </span>
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
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-white">
        {value}
        {sub && <span className="text-white/50"> · {sub}</span>}
      </div>
    </div>
  );
}

function TxLink({ signature, label }: { signature: string; label: string }) {
  return (
    <a
      href={`${SOLSCAN_TX_BASE}${signature}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
    >
      <div className="font-medium text-aeras-positive">{label}</div>
      <div className="mt-0.5 break-all font-mono text-[10px] text-white/50">
        {signature}
      </div>
    </a>
  );
}

// Never request more collateral than the wallet actually holds, defeating float
// drift between the displayed balance and the on-chain ATA.
function clampToBalance(requested: BN, balanceAtomic: string): BN {
  const bal = new BN(balanceAtomic);
  return requested.gt(bal) ? bal : requested;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readableError(err: unknown): string {
  // sendAndConfirm already decided what happened and phrased it.
  if (
    err instanceof SolanaSendError &&
    (err.kind === "expired" || err.kind === "unknown")
  ) {
    return err.message;
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/insufficient funds|0x1\b/i.test(raw)) {
    return "Not enough balance to cover this position plus fees.";
  }
  if (/slippage|0x1771|exceeded/i.test(raw)) {
    return "Price moved past the slippage limit. Try again.";
  }
  if (/blockhash not found|block height exceeded/i.test(raw)) {
    return "The transaction expired before it landed. Try again.";
  }
  if (/User rejected|declined|denied/i.test(raw)) {
    return "Signature request was declined.";
  }
  return `Transaction failed: ${raw}`;
}
