"use client";

// Buy + Buy more. Buy the asset, post it, borrow USDC, then ask what to buy
// with the USDC. Each round is signed on its own and the aggregate is shown
// after every one. A round that buys something with no borrow market is the
// last round. The ladder ends when the next borrow would be under the floor,
// when the venue runs out of USDC, or when the user says stop.

import { useMemo, useRef, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import { borrowRouteFor } from "@/lib/borrow/route";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS, type XStock } from "@/lib/jupiter/xstocks";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  buyWithUsdc,
  depositAndBorrow,
  type BuyResult,
} from "@/lib/strategies/execute";
import {
  defaultBorrowRatio,
  LADDER_FLOOR_USD,
  ladderProjection,
  minHealth,
  type HealthInput,
} from "@/lib/strategies/math";
import type { StrategyRates } from "@/lib/strategies/rates";
import { useStrategyRun, type StepDef } from "@/lib/strategies/run";
import { INSET_PANEL } from "@/lib/ui/surface";

import {
  floorCents,
  fmtHealth,
  fmtUsd,
  Note,
  PreviewBlock,
  PreviewRow,
  PRIMARY_BUTTON,
  RatioSlider,
  SECONDARY_BUTTON,
  StepList,
  UsdcAmount,
} from "./shared";

const MIN_BUY_USD = 5;

interface Round {
  asset: XStock;
  buyUsd: number;
  boughtUi: number;
  borrowedUsd: number;
}

type Phase =
  // Nothing has run. The projection is showing.
  | "idle"
  // A round is landing.
  | "running"
  // The last round borrowed USDC and the user is choosing what to buy.
  | "prompt"
  // The ladder ended: no route, under the floor, or the user stopped.
  | "done";

export function LadderTicket({
  row,
  rows,
  walletAddress,
  balances,
  prices,
  onRefresh,
}: {
  row: StrategyRates;
  // Every collateral asset's live rates, for the borrow leg of whatever the
  // user picks next.
  rows: StrategyRates[];
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  const signTx = useSignSolanaTxBase64();
  const run = useStrategyRun();
  const [amountInput, setAmountInput] = useState("");
  const [ratio, setRatio] = useState(() => defaultBorrowRatio(row.route));
  const [phase, setPhase] = useState<Phase>("idle");
  const [rounds, setRounds] = useState<Round[]>([]);
  // USDC the last round borrowed, waiting to be spent.
  const [pendingUsd, setPendingUsd] = useState(0);
  const [nextMint, setNextMint] = useState(row.xstock.mint);
  const bought = useRef<BuyResult | null>(null);

  const amountUsd = Number(amountInput);
  const amountValid =
    Number.isFinite(amountUsd) &&
    amountUsd >= MIN_BUY_USD &&
    balances != null &&
    amountUsd <= balances.usdc;

  const projection = useMemo(
    () =>
      amountValid
        ? ladderProjection({ equityUsd: amountUsd, borrowRatio: ratio })
        : null,
    [amountValid, amountUsd, ratio],
  );

  const priceOf = (mint: string) => prices?.[mint]?.usdPrice ?? null;
  const ratesFor = (mint: string) => rows.find((r) => r.xstock.mint === mint);

  // Aggregate across everything landed so far, at current prices.
  const equityUsd = rounds.length > 0 ? rounds[0].buyUsd : 0;
  const exposureUsd = rounds.reduce((sum, r) => {
    const p = priceOf(r.asset.mint);
    return sum + (p != null ? r.boughtUi * p : r.buyUsd);
  }, 0);
  const debtUsd = rounds.reduce((sum, r) => sum + r.borrowedUsd, 0);
  // Positions are isolated per Jupiter vault; on Kamino one obligation holds
  // every collateral, so those rounds are grouped and judged at the lowest
  // threshold among them, which is the conservative reading.
  const health = useMemo(() => {
    const jupiter = new Map<string, HealthInput>();
    let kamino: HealthInput | null = null;
    for (const r of rounds) {
      const route = borrowRouteFor(r.asset.mint);
      if (!route) continue;
      const p = prices?.[r.asset.mint]?.usdPrice ?? null;
      const collateralUsd = p != null ? r.boughtUi * p : r.buyUsd;
      if (route.venue === "jupiter") {
        const cur = jupiter.get(r.asset.mint) ?? {
          collateralUsd: 0,
          debtUsd: 0,
          liquidationThreshold: route.liquidationThreshold,
        };
        cur.collateralUsd += collateralUsd;
        cur.debtUsd += r.borrowedUsd;
        jupiter.set(r.asset.mint, cur);
      } else {
        kamino = kamino ?? { collateralUsd: 0, debtUsd: 0, liquidationThreshold: 1 };
        kamino.collateralUsd += collateralUsd;
        kamino.debtUsd += r.borrowedUsd;
        kamino.liquidationThreshold = Math.min(
          kamino.liquidationThreshold,
          route.liquidationThreshold,
        );
      }
    }
    const all = [...jupiter.values(), ...(kamino ? [kamino] : [])];
    return all.length ? minHealth(all) : Infinity;
  }, [rounds, prices]);

  // Steps for one round: buy `usd` of `asset`, and if it has a market and the
  // borrow clears the floor, post it and borrow.
  function roundSteps(asset: XStock, usd: number, fromWallet: boolean): StepDef[] {
    const rates = ratesFor(asset.mint);
    const route = rates?.route;
    const price = priceOf(asset.mint);
    const n = rounds.length + 1;
    bought.current = null;

    const steps: StepDef[] = [
      {
        id: `buy-${n}`,
        label: `Round ${n}: buy ${asset.symbol} with ${fmtUsd(usd)}${fromWallet ? "" : " of borrowed USDC"}`,
        run: async () => {
          const r = await buyWithUsdc({
            walletAddress,
            xstock: asset,
            usdcAtomic: BigInt(Math.round(usd * 1_000_000)),
            signTx,
          });
          bought.current = r;
          return { signatures: [r.signature] };
        },
      },
    ];

    const wouldBorrow = price != null ? floorCents(usd * ratio) : 0;
    const borrows = route != null && price != null && wouldBorrow >= LADDER_FLOOR_USD;
    if (borrows) {
      steps.push({
        id: `borrow-${n}`,
        label: `Round ${n}: deposit ${asset.symbol} and borrow USDC on ${route.venueLabel}`,
        run: async (report) => {
          const b = bought.current;
          if (!b) throw new Error("The buy has not landed yet.");
          let borrow = floorCents(b.boughtUi * price * ratio);
          if (rates?.liquidityUsd != null) {
            borrow = Math.min(borrow, floorCents(rates.liquidityUsd));
          }
          if (borrow < LADDER_FLOOR_USD) {
            // Under the floor after sizing off the real fill: keep the asset,
            // skip the borrow, and the ladder ends here.
            setRounds((prev) => [...prev, { asset, buyUsd: usd, boughtUi: b.boughtUi, borrowedUsd: 0 }]);
            setPendingUsd(0);
            setPhase("done");
            return { signatures: [] };
          }
          const r = await depositAndBorrow({
            route,
            walletAddress,
            collateralAtomic: b.boughtAtomic,
            borrowUsdc: borrow,
            signTx,
            onProgress: report,
          });
          setRounds((prev) => [...prev, { asset, buyUsd: usd, boughtUi: b.boughtUi, borrowedUsd: borrow }]);
          setPendingUsd(borrow);
          setPhase("prompt");
          return { signatures: r.signatures };
        },
      });
    } else {
      // No market, or the borrow would be under the floor: this round ends
      // the ladder once the buy lands.
      const last = steps[0].run;
      steps[0].run = async (report) => {
        const out = await last(report);
        const b = bought.current!;
        setRounds((prev) => [...prev, { asset, buyUsd: usd, boughtUi: b.boughtUi, borrowedUsd: 0 }]);
        setPendingUsd(0);
        setPhase("done");
        return out;
      };
    }
    return steps;
  }

  async function handleStart() {
    if (!amountValid || phase !== "idle") return;
    setRounds([]);
    setPendingUsd(0);
    setNextMint(row.xstock.mint);
    setPhase("running");
    // On failure the phase stays "running": the step list with its retry
    // button is what the user needs to see, and the step's own success handler
    // moves the phase on once the retry lands.
    await run.start(roundSteps(row.xstock, amountUsd, true));
    await onRefresh();
  }

  async function handleContinue() {
    if (phase !== "prompt" || pendingUsd <= 0) return;
    const asset = XSTOCKS.find((x) => x.mint === nextMint);
    if (!asset) return;
    setPhase("running");
    await run.extend(roundSteps(asset, pendingUsd, false));
    await onRefresh();
  }

  function handleStop() {
    setPhase("done");
  }

  function handleReset() {
    run.reset();
    setRounds([]);
    setPendingUsd(0);
    setPhase("idle");
  }

  const nextAsset = XSTOCKS.find((x) => x.mint === nextMint) ?? row.xstock;
  const nextRoute = borrowRouteFor(nextMint);
  const nextBorrow = floorCents(pendingUsd * ratio);
  const nextContinues = nextRoute != null && nextBorrow >= LADDER_FLOOR_USD;

  return (
    <div className="space-y-4">
      {phase === "idle" && (
        <>
          <UsdcAmount
            value={amountInput}
            onChange={setAmountInput}
            balanceUsdc={balances?.usdc ?? null}
            autoFocus
          />
          <RatioSlider route={row.route} value={ratio} onChange={setRatio} />

          {projection && (
            <PreviewBlock>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
                If every round buys {row.xstock.symbol}
              </div>
              {projection.rounds.map((r) => (
                <PreviewRow
                  key={r.round}
                  label={`Round ${r.round}: buy ${fmtUsd(r.buyUsd)}`}
                  value={r.borrowUsd > 0 ? `borrow ${fmtUsd(r.borrowUsd)}` : "stop"}
                  muted={r.borrowUsd === 0}
                />
              ))}
              <div className="border-t border-white/10 pt-2">
                <PreviewRow label="Exposure" value={`${fmtUsd(projection.exposureUsd)} · ${projection.leverage.toFixed(2)}×`} />
                <PreviewRow label="Debt" value={fmtUsd(projection.debtUsd)} />
                <PreviewRow
                  label="Signatures"
                  value={String(
                    projection.rounds.reduce(
                      (n, r) => n + 1 + (r.borrowUsd > 0 ? (row.route.venue === "jupiter" ? 1 : 2) : 0),
                      0,
                    ),
                  )}
                  muted
                />
              </div>
            </PreviewBlock>
          )}

          <Note>
            You choose what each round buys once the USDC is borrowed. Buying
            something with no borrow market ends the ladder there. Rounds under{" "}
            {fmtUsd(LADDER_FLOOR_USD)} are skipped.
          </Note>

          <button
            type="button"
            onClick={handleStart}
            disabled={!amountValid || run.running}
            className={PRIMARY_BUTTON}
          >
            {amountInput === ""
              ? "Enter an amount"
              : !amountValid
                ? amountUsd < MIN_BUY_USD
                  ? `Minimum ${fmtUsd(MIN_BUY_USD)}`
                  : "Not enough USDC"
                : `Start with ${fmtUsd(amountUsd)} of ${row.xstock.symbol}`}
          </button>
        </>
      )}

      {phase !== "idle" && (
        <>
          <StepList run={run} />

          {rounds.length > 0 && (
            <PreviewBlock>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
                So far
              </div>
              {rounds.map((r, i) => (
                <PreviewRow
                  key={i}
                  label={`${r.boughtUi.toFixed(4)} ${r.asset.symbol}`}
                  value={r.borrowedUsd > 0 ? `borrowed ${fmtUsd(r.borrowedUsd)}` : "held"}
                  muted={r.borrowedUsd === 0}
                />
              ))}
              <div className="border-t border-white/10 pt-2">
                <PreviewRow label="Put in" value={fmtUsd(equityUsd)} />
                <PreviewRow
                  label="Exposure now"
                  value={`${fmtUsd(exposureUsd)} · ${equityUsd > 0 ? (exposureUsd / equityUsd).toFixed(2) : "—"}×`}
                />
                <PreviewRow label="Debt" value={fmtUsd(debtUsd)} />
                <PreviewRow
                  label="Weakest position health"
                  value={fmtHealth(health)}
                  warn={health < 1.2}
                />
              </div>
            </PreviewBlock>
          )}

          {phase === "prompt" && (
            <div className={`space-y-3 ${INSET_PANEL} px-3 py-3`}>
              <div className="text-sm text-white">
                {fmtUsd(pendingUsd)} USDC is in your wallet. Buy what with it?
              </div>
              <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
                {XSTOCKS.map((x) => {
                  const collateral = borrowRouteFor(x.mint) != null;
                  const active = x.mint === nextMint;
                  return (
                    <button
                      key={x.mint}
                      type="button"
                      onClick={() => setNextMint(x.mint)}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
                        active
                          ? "border-white/20 bg-white/10 text-white"
                          : "border-white/10 text-white/60 hover:text-white"
                      }`}
                    >
                      <AssetLogo xstock={x} size={18} />
                      <span className="truncate">{x.symbol}</span>
                      {!collateral && (
                        <span className="ml-auto text-[9px] uppercase tracking-wider text-white/30">
                          ends
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <PreviewRow
                label={`Then borrow on ${nextRoute?.venueLabel ?? "—"}`}
                value={
                  nextRoute == null
                    ? `nothing, ${nextAsset.symbol} has no market`
                    : nextContinues
                      ? fmtUsd(nextBorrow)
                      : `nothing, under ${fmtUsd(LADDER_FLOOR_USD)}`
                }
                muted={!nextContinues}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={run.running}
                  className={PRIMARY_BUTTON}
                >
                  Buy {nextAsset.symbol} with {fmtUsd(pendingUsd)}
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={run.running}
                  className={SECONDARY_BUTTON}
                >
                  Stop here
                </button>
              </div>
            </div>
          )}

          {phase === "running" && run.failedAt != null && rounds.length === 0 && (
            <button type="button" onClick={handleReset} className={SECONDARY_BUTTON}>
              Cancel
            </button>
          )}

          {phase === "done" && (
            <div className="space-y-3">
              <Note>
                Ladder finished.{" "}
                {pendingUsd > 0
                  ? `${fmtUsd(pendingUsd)} of borrowed USDC stays in the wallet.`
                  : "Every position is on the Borrow tab."}
              </Note>
              <button type="button" onClick={handleReset} className={SECONDARY_BUTTON}>
                Start another
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
