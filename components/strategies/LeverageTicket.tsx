"use client";

// Buy + Leverage. One atomic transaction on a Jupiter vault: flashloan the
// whole exposure, swap it into the asset, deposit, borrow the leveraged
// share, pay the flashloan back from the borrow plus the user's USDC. The
// preview is quoted on the same route budget the transaction will use, so
// the exposure and liquidation figures describe what will land.
//
// Kamino has no flashloan through the KTX proxy, so a Kamino-only asset gets
// an explanation here and its leverage through the ladder next door.

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
  loopStorageKey,
  saveLoopRecord,
  writeCachedLoopRecord,
} from "@/lib/loops-client";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import type { AccountBalances } from "@/lib/solana/balances";
import { openLeverageFromUsdc } from "@/lib/strategies/execute";
import {
  leveragePresets,
  maxLeverageForRoute,
} from "@/lib/strategies/math";
import type { StrategyRates } from "@/lib/strategies/rates";
import { useStrategyRun } from "@/lib/strategies/run";

import {
  floorCents,
  fmtPct,
  fmtUsd,
  Note,
  PreviewBlock,
  PreviewRow,
  PRIMARY_BUTTON,
  StepList,
  UsdcAmount,
} from "./shared";

const LEVERAGE_MIN = 1.1;
const MIN_EQUITY_USD = 5;
const SLIPPAGE_BPS = 100;
const PREVIEW_DEBOUNCE_MS = 450;

export function LeverageTicket({
  row,
  walletAddress,
  balances,
  prices,
  onRefresh,
}: {
  row: StrategyRates;
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  const { xstock, route } = row;
  if (!route.vault) {
    return (
      <Note>
        {xstock.symbol} is lent against on Kamino, which has no flashloan in
        this app, so leverage cannot be opened in one transaction. Use Buy more
        instead: it reaches the same exposure in a few signed rounds.
      </Note>
    );
  }
  return (
    <JupiterLeverage
      row={row}
      walletAddress={walletAddress}
      balances={balances}
      prices={prices}
      onRefresh={onRefresh}
    />
  );
}

function JupiterLeverage({
  row,
  walletAddress,
  balances,
  prices,
  onRefresh,
}: {
  row: StrategyRates;
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  const { xstock, route } = row;
  const vault = route.vault!;
  const signTx = useSignSolanaTxBase64();
  const { getAccessToken } = usePrivy();
  const run = useStrategyRun();

  const maxLeverage = maxLeverageForRoute(route);
  const leverageMax = Math.max(LEVERAGE_MIN + 0.1, Math.floor(maxLeverage * 10) / 10);
  const presets = leveragePresets(route);
  const [leverage, setLeverage] = useState(() => Math.min(2, leverageMax));
  const [amountInput, setAmountInput] = useState("");
  const [live, setLive] = useState<LiveVaultState | null>(null);
  const [previewState, setPreview] = useState<SwapQuote | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

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
  const ltv =
    exposureUsd && borrowUsd != null ? borrowUsd / exposureUsd : null;
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
    run.steps.length === 0;

  async function handleOpen() {
    if (!canOpen || borrowUsd == null) return;
    const ok = await run.start([
      {
        id: "multiply",
        label: `Open ${leverage.toFixed(1)}× ${xstock.symbol} with ${fmtUsd(equityUsd)}`,
        run: async () => {
          const r = await openLeverageFromUsdc({
            vault,
            walletAddress,
            equityUsdc: equityUsd,
            borrowUsdc: borrowUsd,
            slippageBps: SLIPPAGE_BPS,
            signTx,
          });
          // Same bookkeeping the looping panel writes, so the position shows
          // there as a loop with this equity as its basis.
          const record = { managed: true, basisUsd: equityUsd };
          writeCachedLoopRecord(loopStorageKey(walletAddress, vault.vaultId), record);
          saveLoopRecord(getAccessToken, vault.vaultId, equityUsd, "add").catch(() => {});
          return { signatures: [r.signature] };
        },
      },
    ]);
    if (ok) await onRefresh();
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
        <PreviewRow
          label="Liquidation price"
          value={liquidationPrice != null ? fmtUsd(liquidationPrice) : "—"}
        />
        <PreviewRow
          label="Room before liquidation"
          value={drawdown != null ? `−${(drawdown * 100).toFixed(1)}%` : "—"}
          warn={drawdown != null && drawdown < 0.15}
        />
        <PreviewRow
          label="Carry on your equity"
          value={carry != null ? `−${fmtPct(carry)} per year` : "—"}
          muted
        />
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
          Jupiter Lend only has {fmtUsd(live?.borrowableUsd)} left to lend in
          this vault. Lower the amount or the leverage.
        </Note>
      )}

      <StepList run={run} />

      {run.finished ? (
        <Note>
          Open. The position is on the Borrow tab and in the Earn tab&apos;s
          looping card, where it can be unwound in one transaction.
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
