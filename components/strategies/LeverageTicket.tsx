"use client";

// Buy + Leverage. One atomic transaction on a Jupiter vault: flashloan the
// whole exposure, swap it into the asset, deposit, borrow the leveraged
// share, pay the flashloan back from the borrow plus the user's USDC. The
// preview is quoted on the same route budget the transaction will use, so
// the exposure and liquidation figures describe what will land.
//
// Kamino has no flashloan through the KTX proxy, so a Kamino-only asset gets
// an explanation here and its leverage through the ladder next door.
//
// A finished run comes back with its close path, which is the same one-shot
// unwind the looping panel uses. The loop record it writes is what makes the
// position show there too.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import BN from "bn.js";
import { usePrivy } from "@privy-io/react-auth";

import {
  fetchLiveVaultStateViaProxy,
  fromAtomicBN,
  toAtomicBN,
  type LiveVaultState,
} from "@/lib/jupiter/borrow";
import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import {
  fetchSwapQuoteViaProxy,
  SWAP_ACCOUNT_BUDGET,
  type SwapQuote,
} from "@/lib/jupiter/multiply";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  clearLoopRecord,
  loopStorageKey,
  saveLoopRecord,
  writeCachedLoopRecord,
  EMPTY_LOOP_RECORD,
} from "@/lib/loops-client";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  closeLeverage,
  openLeverageFromUsdc,
  readJupiterPosition,
} from "@/lib/strategies/execute";
import { leveragePresets, maxLeverageForRoute } from "@/lib/strategies/math";
import type { StrategyRates } from "@/lib/strategies/rates";
import { useStrategyRun } from "@/lib/strategies/run";
import {
  newRunId,
  type LeverageRunData,
  type StrategyRun,
  type StrategyRunsStore,
} from "@/lib/strategies/runs-client";

import {
  floorCents,
  fmtPct,
  fmtUsd,
  Note,
  PreviewBlock,
  PreviewRow,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  StepList,
  UsdcAmount,
  useTicketFlow,
  useVenueNames,
} from "./shared";

const LEVERAGE_MIN = 1.1;
const MIN_EQUITY_USD = 5;
const SLIPPAGE_BPS = 100;
const UNWIND_SLIPPAGE_BPS = 150;
const PREVIEW_DEBOUNCE_MS = 450;

interface Props {
  row: StrategyRates;
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  store: StrategyRunsStore;
  saved: StrategyRun | null;
  onRefresh: () => Promise<void> | void;
  // A play's preset (lib/strategies/plays.ts): the multiple the ticket
  // opens on, or "max" for the route's ceiling. Seeds the slider and
  // nothing else.
  initialLeverage?: number | "max";
}

export function LeverageTicket(props: Props) {
  const { xstock, route } = props.row;
  // False under Trader mode: the copy then names no lending venue.
  const named = useVenueNames();
  if (!route.vault) {
    return (
      <Note>
        {named
          ? `${xstock.symbol} is lent against on Kamino, which has no flashloan in this app, so leverage cannot be opened in one transaction.`
          : `${xstock.symbol}'s lending market has no flashloan, so leverage cannot be opened in one transaction.`}{" "}
        Use Buy more instead: it reaches the same exposure in a few signed rounds.
      </Note>
    );
  }
  return <JupiterLeverage {...props} />;
}

function JupiterLeverage({
  row,
  walletAddress,
  balances,
  prices,
  store,
  saved,
  onRefresh,
  initialLeverage,
}: Props) {
  const { xstock, route } = row;
  const vault = route.vault!;
  const signTx = useSignSolanaTxBase64();
  const { getAccessToken } = usePrivy();
  const run = useStrategyRun();
  const named = useVenueNames();
  // Set under Trader mode: draws the run above the preview.
  const flow = useTicketFlow();
  const savedData = saved?.data.kind === "leverage" ? saved.data : null;

  const maxLeverage = maxLeverageForRoute(route);
  const leverageMax = Math.max(LEVERAGE_MIN + 0.1, Math.floor(maxLeverage * 10) / 10);
  const presets = leveragePresets(route);
  const [leverage, setLeverage] = useState(() =>
    initialLeverage === "max"
      ? leverageMax
      : Math.max(LEVERAGE_MIN, Math.min(initialLeverage ?? 2, leverageMax)),
  );
  const [amountInput, setAmountInput] = useState("");
  const [live, setLive] = useState<LiveVaultState | null>(null);
  const [previewState, setPreview] = useState<SwapQuote | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [mode, setMode] = useState<"open" | "close">("open");
  const runId = useRef<string | null>(null);
  const data = useRef<LeverageRunData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLiveVaultStateViaProxy(vault.vaultId)
      .then((v) => {
        if (!cancelled) setLive(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [vault.vaultId]);

  const { save } = store;
  useEffect(() => {
    // Never while closing: a close that fails part way must leave the saved
    // record as it was (a finished open), not as an interrupted run whose
    // Resume would rebuild and re-send the OPEN steps. Close is retried by
    // pressing Close again; each of its legs re-reads the chain first.
    if (mode === "close") return;
    if (!runId.current || !data.current || run.steps.length === 0) return;
    save({
      id: runId.current,
      strategy: "leverage",
      mint: xstock.mint,
      status: run.finished && mode === "open" ? "done" : "running",
      steps: run.steps.map(({ id, label, status, signatures }) => ({ id, label, status, signatures })),
      data: data.current,
      openedAt: saved?.id === runId.current ? saved.openedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.steps, run.finished, mode, save, xstock.mint]);

  const oraclePrice = live?.oraclePriceUsd ?? prices?.[xstock.mint]?.usdPrice ?? null;
  const borrowApr = live?.borrowRateAnnual ?? row.borrowApr;

  const equityUsd = Number(amountInput);
  const equityValid =
    Number.isFinite(equityUsd) &&
    equityUsd >= MIN_EQUITY_USD &&
    balances != null &&
    equityUsd <= balances.usdc;
  const borrowUsd = equityValid ? floorCents(equityUsd * (leverage - 1)) : null;
  const swapUsd = equityValid && borrowUsd != null ? equityUsd + borrowUsd : null;
  const liquidityShort =
    borrowUsd != null && live?.borrowableUsd != null && borrowUsd > live.borrowableUsd;

  // Debounced quote for the whole swap, on the account budget the
  // transaction will be built with.
  const seq = useRef(0);
  const quotable = swapUsd != null && swapUsd >= 1;
  // Only a quote for the current size counts. A stale one for a size that is
  // no longer typed is masked here rather than cleared in the effect, which
  // keeps state writes out of the effect body.
  const preview = quotable ? previewState : null;
  useEffect(() => {
    if (!quotable || swapUsd == null) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const q = await fetchSwapQuoteViaProxy({
          inputMint: vault.borrowMint,
          outputMint: vault.collateralMint,
          amountAtomic: toAtomicBN(swapUsd, USDC_DECIMALS).toString(),
          slippageBps: SLIPPAGE_BPS,
          maxAccounts: SWAP_ACCOUNT_BUDGET,
        });
        if (mine !== seq.current) return;
        setPreview(q);
        setPreviewErr(null);
      } catch (err) {
        if (mine !== seq.current) return;
        setPreview(null);
        setPreviewErr(err instanceof Error ? err.message : String(err));
      } finally {
        if (mine === seq.current) setPreviewing(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [quotable, swapUsd, vault.borrowMint, vault.collateralMint]);

  const exposureUi = preview
    ? fromAtomicBN(new BN(preview.otherAmountThreshold), vault.collateralDecimals)
    : null;
  const exposureUsd =
    exposureUi != null && oraclePrice != null ? exposureUi * oraclePrice : null;
  const ltv = exposureUsd && borrowUsd != null ? borrowUsd / exposureUsd : null;
  const liquidationPrice =
    exposureUi && borrowUsd != null
      ? borrowUsd / (exposureUi * route.liquidationThreshold)
      : null;
  const drawdown =
    liquidationPrice != null && oraclePrice
      ? (oraclePrice - liquidationPrice) / oraclePrice
      : null;
  const impact = preview ? Number(preview.priceImpactPct) : null;
  const carry = borrowApr != null ? borrowApr * (leverage - 1) : null;

  const canOpen =
    equityValid &&
    borrowUsd != null &&
    borrowUsd >= 1 &&
    !liquidityShort &&
    preview != null &&
    !previewing &&
    !run.running &&
    run.steps.length === 0 &&
    saved == null;

  function openStep(d: LeverageRunData) {
    return {
      id: "multiply",
      label: `Open ${d.leverage.toFixed(1)}× ${xstock.symbol} with ${fmtUsd(d.equityUsd)}`,
      run: async () => {
        const r = await openLeverageFromUsdc({
          vault,
          walletAddress,
          equityUsdc: d.equityUsd,
          borrowUsdc: d.borrowUsd,
          slippageBps: SLIPPAGE_BPS,
          signTx,
        });
        // Same bookkeeping the looping panel writes, so the position shows
        // there as a loop with this equity as its basis.
        const record = { managed: true, basisUsd: d.equityUsd };
        writeCachedLoopRecord(loopStorageKey(walletAddress, vault.vaultId), record);
        saveLoopRecord(getAccessToken, vault.vaultId, d.equityUsd, "add").catch(() => {});
        return { signatures: [r.signature] };
      },
      // One transaction: it landed if the vault now shows debt for us.
      reconcile: async () => {
        const p = await readJupiterPosition(walletAddress, vault);
        return p != null && !p.debtAtomic.isZero();
      },
    };
  }

  async function handleOpen() {
    if (!canOpen || borrowUsd == null) return;
    runId.current = newRunId();
    data.current = { kind: "leverage", equityUsd, leverage, borrowUsd };
    const ok = await run.start([openStep(data.current)]);
    if (ok) await onRefresh();
  }

  async function handleResume() {
    if (!saved || !savedData) return;
    runId.current = saved.id;
    data.current = { ...savedData };
    const ok = await run.resume([openStep(data.current)], saved.steps);
    if (ok) await onRefresh();
  }

  async function handleClose() {
    if (!saved) return;
    setMode("close");
    runId.current = saved.id;
    data.current = savedData ? { ...savedData } : null;
    const ok = await run.start([
      {
        id: "unwind",
        label: `Close the ${xstock.symbol} position in one transaction`,
        run: async () => {
          const r = await closeLeverage({
            vault,
            walletAddress,
            slippageBps: UNWIND_SLIPPAGE_BPS,
            signTx,
          });
          writeCachedLoopRecord(loopStorageKey(walletAddress, vault.vaultId), EMPTY_LOOP_RECORD);
          clearLoopRecord(getAccessToken, vault.vaultId).catch(() => {});
          return { signatures: [r.signature] };
        },
      },
    ]);
    if (ok) {
      store.remove(saved.id);
      runId.current = null;
      data.current = null;
      await onRefresh();
    }
  }

  if (saved && savedData && run.steps.length === 0) {
    if (saved.status === "running") {
      return (
        <div className="space-y-4">
          <Note>
            A {savedData.leverage.toFixed(1)}× {xstock.symbol} open for{" "}
            {fmtUsd(savedData.equityUsd)} was interrupted. Resume checks the
            vault for the position before sending anything.
          </Note>
          <div className="flex gap-2">
            <button type="button" onClick={handleResume} className={PRIMARY_BUTTON}>
              Resume
            </button>
            <button type="button" onClick={() => store.remove(saved.id)} className={SECONDARY_BUTTON}>
              Discard
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <PreviewBlock>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
            Open {savedData.leverage.toFixed(1)}× {xstock.symbol}
          </div>
          <PreviewRow label="Put in" value={fmtUsd(savedData.equityUsd)} />
          <PreviewRow label="Borrowed at open" value={fmtUsd(savedData.borrowUsd)} />
          <PreviewRow label="Opened" value={new Date(saved.openedAt).toLocaleDateString()} muted />
        </PreviewBlock>
        <Note>
          Closing sells enough {xstock.symbol} to repay the loan in one
          flashloan transaction and returns the rest to the wallet. Live P&amp;L
          is on the Earn tab&apos;s looping card.
        </Note>
        <div className="flex gap-2">
          <button type="button" onClick={handleClose} className={PRIMARY_BUTTON}>
            Close position
          </button>
          <button type="button" onClick={() => store.remove(saved.id)} className={SECONDARY_BUTTON} title="Forget this run without touching the position.">
            Forget
          </button>
        </div>
      </div>
    );
  }

  if (mode === "close") {
    return (
      <div className="space-y-4">
        <StepList run={run} />
        {run.finished && <Note>Closed. The remaining {xstock.symbol} is in the wallet.</Note>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <UsdcAmount
        value={amountInput}
        onChange={(v) => {
          setAmountInput(v);
          if (run.finished || run.failedAt != null) run.reset();
        }}
        balanceUsdc={balances?.usdc ?? null}
        autoFocus
      />

      <div>
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="text-white/50">Leverage</span>
          <span className="font-mono tabular-nums text-white">{leverage.toFixed(1)}×</span>
        </div>
        <div className="mb-2 flex gap-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              disabled={run.running}
              onClick={() => setLeverage(Math.min(p, leverageMax))}
              className={`rounded-lg border px-3 py-1 font-mono text-xs tabular-nums transition-colors ${
                Math.abs(leverage - p) < 0.05
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-white/10 text-white/60 hover:text-white"
              }`}
            >
              {p.toFixed(1)}×
            </button>
          ))}
        </div>
        <input
          type="range"
          min={LEVERAGE_MIN}
          max={leverageMax}
          step={0.1}
          value={leverage}
          disabled={run.running}
          onChange={(e) => setLeverage(Number(e.target.value))}
          style={
            {
              "--range-progress": Math.min(
                1,
                Math.max(0, (leverage - LEVERAGE_MIN) / (leverageMax - LEVERAGE_MIN)),
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

      {flow?.({
        kind: "leverage",
        xstock,
        amountUsd: equityValid ? equityUsd : null,
        leverage,
        borrowUsd,
        exposureUsd,
        exposureUi,
      })}

      <PreviewBlock>
        <PreviewRow
          label="Exposure"
          value={
            exposureUsd != null && exposureUi != null
              ? `${fmtUsd(exposureUsd)} · ${exposureUi.toFixed(4)} ${xstock.symbol}`
              : previewing
                ? "Quoting…"
                : "—"
          }
        />
        <PreviewRow
          label="Borrowed"
          value={borrowUsd != null ? `${fmtUsd(borrowUsd)} USDC at ${fmtPct(borrowApr)}` : "—"}
          warn={liquidityShort}
        />
        <PreviewRow label="Loan to value" value={ltv != null ? fmtPct(ltv, 1) : "—"} />
        <PreviewRow label="Liquidation price" value={liquidationPrice != null ? fmtUsd(liquidationPrice) : "—"} />
        <PreviewRow
          label="Room before liquidation"
          value={drawdown != null ? `−${(drawdown * 100).toFixed(1)}%` : "—"}
          warn={drawdown != null && drawdown < 0.15}
        />
        <PreviewRow label="Carry on your equity" value={carry != null ? `−${fmtPct(carry)} per year` : "—"} muted />
        <PreviewRow
          label="Swap price impact"
          value={impact != null ? fmtPct(impact) : "—"}
          warn={impact != null && impact > 0.01}
        />
        <PreviewRow label="Signatures" value="1" muted />
      </PreviewBlock>

      {previewErr && <Note tone="warn">{previewErr}</Note>}
      {liquidityShort && (
        <Note tone="warn">
          {named ? "Jupiter Lend" : "The lending market"} only has{" "}
          {fmtUsd(live?.borrowableUsd)} left to lend in this vault. Lower the
          amount or the leverage.
        </Note>
      )}

      <StepList run={run} />

      {run.finished ? (
        <Note>
          Open.{" "}
          {named
            ? "The position is on the Borrow tab and in the Earn tab's looping card."
            : "The position is open."}{" "}
          Come back here to close it.
        </Note>
      ) : (
        <button type="button" onClick={handleOpen} disabled={!canOpen} className={PRIMARY_BUTTON}>
          {run.running
            ? "Opening…"
            : run.failedAt != null
              ? "Retry above"
              : amountInput === ""
                ? "Enter an amount"
                : !equityValid
                  ? equityUsd < MIN_EQUITY_USD
                    ? `Minimum ${fmtUsd(MIN_EQUITY_USD)}`
                    : "Not enough USDC"
                  : previewing
                    ? "Quoting…"
                    : `Open ${leverage.toFixed(1)}× ${xstock.symbol}`}
        </button>
      )}
    </div>
  );
}
