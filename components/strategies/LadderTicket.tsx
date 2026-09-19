"use client";

// Buy + Buy more. Buy the asset, post it, borrow USDC, then ask what to buy
// with the USDC. Each round is signed on its own and the aggregate is shown
// after every one. A round that buys something with no borrow market is the
// last round. The ladder ends when the next borrow would be under the floor,
// when the venue runs out of USDC, or when the user says stop.
//
// The run is saved after every step, so a refresh mid-round resumes at the
// step that was next. A finished ladder comes back with its unwind: rounds
// are taken apart in reverse, each one's asset sold to repay the loan that
// bought it, until the first round's asset is back in the wallet.

import { useEffect, useMemo, useRef, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import { borrowRouteFor } from "@/lib/borrow/route";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS, xstockByMint, type XStock } from "@/lib/jupiter/xstocks";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  buyWithUsdc,
  closeLeverage,
  depositAndBorrow,
  readAtaBalanceAtomic,
  readJupiterPosition,
  readKaminoPosition,
  repayAndWithdraw,
  sellForUsdc,
  tokenProgramFor,
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
import {
  newRunId,
  type LadderRound,
  type LadderRunData,
  type StrategyRun,
  type StrategyRunsStore,
} from "@/lib/strategies/runs-client";
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
const UNWIND_SLIPPAGE_BPS = 150;
// Interest on each round's loan, covered by repaying a little over what was
// borrowed. The venue caps the overshoot at the real debt.
const UNWIND_REPAY_PAD = 1.01;

type Phase = "idle" | "running" | "prompt" | "done";

export function LadderTicket({
  row,
  rows,
  walletAddress,
  balances,
  prices,
  store,
  saved,
  onRefresh,
}: {
  row: StrategyRates;
  // Every collateral asset's live rates, for the borrow leg of whatever the
  // user picks next.
  rows: StrategyRates[];
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  store: StrategyRunsStore;
  saved: StrategyRun | null;
  onRefresh: () => Promise<void> | void;
}) {
  const signTx = useSignSolanaTxBase64();
  const run = useStrategyRun();
  const savedData = saved?.data.kind === "ladder" ? saved.data : null;
  const [amountInput, setAmountInput] = useState("");
  const [ratio, setRatio] = useState(() => defaultBorrowRatio(row.route));
  const [phase, setPhase] = useState<Phase>("idle");
  const [rounds, setRounds] = useState<LadderRound[]>([]);
  // USDC the last round borrowed, waiting to be spent.
  const [pendingUsd, setPendingUsd] = useState(0);
  const [nextMint, setNextMint] = useState(row.xstock.mint);
  const [mode, setMode] = useState<"open" | "close">("open");
  const bought = useRef<BuyResult | null>(null);
  const runId = useRef<string | null>(null);
  const data = useRef<LadderRunData | null>(null);

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
  const assetOf = (mint: string) => xstockByMint(mint);

  // Persist after every step and every phase change.
  const { save } = store;
  useEffect(() => {
    // Never while closing: a close that fails part way must leave the saved
    // record as it was (a finished open), not as an interrupted run whose
    // Resume would rebuild and re-send the OPEN steps. Close is retried by
    // pressing Close again; each of its legs re-reads the chain first.
    if (mode === "close") return;
    if (!runId.current || !data.current || run.steps.length === 0) return;
    data.current = { ...data.current, rounds, pendingUsd, phase: phase === "idle" ? "running" : phase };
    save({
      id: runId.current,
      strategy: "ladder",
      mint: row.xstock.mint,
      status: phase === "done" && mode === "open" ? "done" : "running",
      steps: run.steps.map(({ id, label, status, signatures }) => ({ id, label, status, signatures })),
      data: data.current,
      openedAt: saved?.id === runId.current ? saved.openedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.steps, rounds, pendingUsd, phase, mode, save, row.xstock.mint]);

  // Aggregate across everything landed so far, at current prices.
  const shownRounds = rounds;
  const equityUsd = shownRounds.length > 0 ? shownRounds[0].buyUsd : 0;
  const exposureUsd = shownRounds.reduce((sum, r) => {
    const p = priceOf(r.mint);
    return sum + (p != null ? r.boughtUi * p : r.buyUsd);
  }, 0);
  const debtUsd = shownRounds.reduce((sum, r) => sum + r.borrowedUsd, 0);
  // Positions are isolated per Jupiter vault; on Kamino one obligation holds
  // every collateral, so those rounds are grouped and judged at the lowest
  // threshold among them, which is the conservative reading.
  const health = useMemo(() => {
    const jupiter = new Map<string, HealthInput>();
    let kamino: HealthInput | null = null;
    for (const r of shownRounds) {
      const route = borrowRouteFor(r.mint);
      if (!route) continue;
      const p = prices?.[r.mint]?.usdPrice ?? null;
      const collateralUsd = p != null ? r.boughtUi * p : r.buyUsd;
      if (route.venue === "jupiter") {
        const cur = jupiter.get(r.mint) ?? {
          collateralUsd: 0,
          debtUsd: 0,
          liquidationThreshold: route.liquidationThreshold,
        };
        cur.collateralUsd += collateralUsd;
        cur.debtUsd += r.borrowedUsd;
        jupiter.set(r.mint, cur);
      } else {
        kamino = kamino ?? { collateralUsd: 0, debtUsd: 0, liquidationThreshold: 1 };
        kamino.collateralUsd += collateralUsd;
        kamino.debtUsd += r.borrowedUsd;
        kamino.liquidationThreshold = Math.min(kamino.liquidationThreshold, route.liquidationThreshold);
      }
    }
    const all = [...jupiter.values(), ...(kamino ? [kamino] : [])];
    return all.length ? minHealth(all) : Infinity;
  }, [shownRounds, prices]);

  function finishRound(asset: XStock, usd: number, b: BuyResult, borrowed: number) {
    const round: LadderRound = {
      mint: asset.mint,
      buyUsd: usd,
      boughtUi: b.boughtUi,
      boughtAtomic: b.boughtAtomic.toString(),
      borrowedUsd: borrowed,
    };
    setRounds((prev) => [...prev, round]);
    setPendingUsd(borrowed);
    if (data.current) data.current.inFlight = undefined;
    setPhase(borrowed > 0 ? "prompt" : "done");
  }

  // Steps for one round: buy `usd` of `asset`, and if it has a market and the
  // borrow clears the floor, post it and borrow. `n` is the round number.
  function roundSteps(asset: XStock, usd: number, n: number, fromWallet: boolean): StepDef[] {
    const rates = ratesFor(asset.mint);
    const route = rates?.route;
    const price = priceOf(asset.mint);
    const programId = tokenProgramFor(asset);
    const d = data.current!;
    d.inFlight = d.inFlight?.mint === asset.mint && d.inFlight.usd === usd ? d.inFlight : { mint: asset.mint, usd };
    const wouldBorrow = price != null ? floorCents(usd * ratio) : 0;
    const borrows = route != null && price != null && wouldBorrow >= LADDER_FLOOR_USD;

    const buy: StepDef = {
      id: `buy-${n}`,
      label: `Round ${n}: buy ${asset.symbol} with ${fmtUsd(usd)}${fromWallet ? "" : " of borrowed USDC"}`,
      run: async (report) => {
        const before = await readAtaBalanceAtomic({ mint: asset.mint, owner: walletAddress, programId });
        d.inFlight = { mint: asset.mint, usd, bought: { beforeAtomic: before.toString() } };
        // Patches the step, which saves the run with the balance just read,
        // so a resume can tell whether the order below landed.
        report("Placing the order");
        const r = await buyWithUsdc({
          walletAddress,
          xstock: asset,
          usdcAtomic: BigInt(Math.round(usd * 1_000_000)),
          signTx,
        });
        bought.current = r;
        d.inFlight.bought = {
          beforeAtomic: before.toString(),
          boughtAtomic: r.boughtAtomic.toString(),
          boughtUi: r.boughtUi,
          signature: r.signature,
        };
        if (!borrows) finishRound(asset, usd, r, 0);
        return { signatures: [r.signature] };
      },
      reconcile: async () => {
        const snap = d.inFlight?.bought;
        if (!snap) return false;
        const now = await readAtaBalanceAtomic({ mint: asset.mint, owner: walletAddress, programId });
        const gained = now - BigInt(snap.beforeAtomic);
        if (gained <= 0n) return false;
        const r: BuyResult = {
          signature: snap.signature ?? "",
          boughtAtomic: gained,
          boughtUi: Number(gained) / 10 ** asset.decimals,
          outUsdValue: usd,
        };
        bought.current = r;
        d.inFlight!.bought = { ...snap, boughtAtomic: gained.toString(), boughtUi: r.boughtUi };
        if (!borrows) finishRound(asset, usd, r, 0);
        return true;
      },
    };
    if (!borrows) return [buy];

    const restored = (): BuyResult | null => {
      const snap = d.inFlight?.bought;
      if (!snap?.boughtAtomic || snap.boughtUi == null) return null;
      return { signature: snap.signature ?? "", boughtAtomic: BigInt(snap.boughtAtomic), boughtUi: snap.boughtUi, outUsdValue: usd };
    };

    const borrow: StepDef = {
      id: `borrow-${n}`,
      label: `Round ${n}: deposit ${asset.symbol} and borrow USDC on ${route.venueLabel}`,
      run: async (report) => {
        const b = bought.current ?? restored();
        if (!b) throw new Error("The buy has not landed yet.");
        let amount = floorCents(b.boughtUi * price * ratio);
        if (rates?.liquidityUsd != null) amount = Math.min(amount, floorCents(rates.liquidityUsd));
        if (amount < LADDER_FLOOR_USD) {
          // Under the floor once sized off the real fill: keep the asset,
          // skip the borrow, and the ladder ends here.
          finishRound(asset, usd, b, 0);
          return { signatures: [] };
        }
        const r = await depositAndBorrow({
          route,
          walletAddress,
          collateralAtomic: b.boughtAtomic,
          borrowUsdc: amount,
          signTx,
          onProgress: report,
        });
        finishRound(asset, usd, b, amount);
        return { signatures: r.signatures };
      },
      // Landed if the asset has left the wallet and the venue shows debt.
      reconcile: async () => {
        const b = restored();
        const snap = d.inFlight?.bought;
        if (!b || !snap) return false;
        const now = await readAtaBalanceAtomic({ mint: asset.mint, owner: walletAddress, programId });
        if (now >= BigInt(snap.beforeAtomic) + b.boughtAtomic) return false;
        if (route.vault) {
          const p = await readJupiterPosition(walletAddress, route.vault);
          if (!p || p.debtAtomic.isZero()) return false;
        } else {
          const p = await readKaminoPosition(walletAddress);
          if (!p || p.debtUsdc <= 0) return false;
        }
        // The borrow size is not on chain per round. Take what was planned.
        finishRound(asset, usd, b, floorCents(b.boughtUi * price * ratio));
        return true;
      },
    };
    return [buy, borrow];
  }

  async function handleStart() {
    if (!amountValid || phase !== "idle") return;
    runId.current = newRunId();
    data.current = { kind: "ladder", equityUsd: amountUsd, ratio, rounds: [], pendingUsd: 0, phase: "running" };
    bought.current = null;
    setRounds([]);
    setPendingUsd(0);
    setNextMint(row.xstock.mint);
    setPhase("running");
    // On failure the phase stays "running": the step list with its retry
    // button is what the user needs to see, and the step's own success handler
    // moves the phase on once the retry lands.
    await run.start(roundSteps(row.xstock, amountUsd, 1, true));
    await onRefresh();
  }

  async function handleContinue() {
    if (phase !== "prompt" || pendingUsd <= 0) return;
    const asset = assetOf(nextMint);
    if (!asset) return;
    bought.current = null;
    setPhase("running");
    await run.extend(roundSteps(asset, pendingUsd, rounds.length + 1, false));
    await onRefresh();
  }

  async function handleResume() {
    if (!saved || !savedData) return;
    runId.current = saved.id;
    data.current = { ...savedData };
    setRatio(savedData.ratio);
    setRounds(savedData.rounds);
    setPendingUsd(savedData.pendingUsd);
    setNextMint(row.xstock.mint);
    bought.current = null;
    // Steps of rounds that finished are stubs: resume never runs a step
    // that was saved as done, it only needs the ids to line up. The round
    // that was in flight gets real steps, rebuilt from the saved snapshot.
    const n = savedData.rounds.length + 1;
    const stubs: StepDef[] = saved.steps
      .filter((s) => !s.id.endsWith(`-${n}`))
      .map((s) => ({ id: s.id, label: s.label, run: async () => ({ signatures: s.signatures }) }));
    const inFlight = savedData.inFlight;
    if (inFlight && savedData.phase === "running") {
      const asset = assetOf(inFlight.mint);
      if (!asset) return;
      setPhase("running");
      const live = roundSteps(asset, inFlight.usd, n, n === 1);
      await run.resume([...stubs, ...live], saved.steps);
    } else {
      setPhase(savedData.phase === "done" ? "done" : "prompt");
      await run.resume(stubs, saved.steps);
    }
    await onRefresh();
  }

  // Unwind in reverse. Rounds of one Jupiter asset merged into one position,
  // so a same-asset Jupiter ladder is a loop and closes in one transaction.
  async function handleClose() {
    if (!saved || !savedData) return;
    const rs = savedData.rounds;
    if (rs.length === 0) {
      store.remove(saved.id);
      return;
    }
    setMode("close");
    runId.current = saved.id;
    data.current = { ...savedData };
    const first = assetOf(rs[0].mint);
    const firstRoute = borrowRouteFor(rs[0].mint);
    const steps: StepDef[] = [];

    if (first && firstRoute?.vault && rs.every((r) => r.mint === rs[0].mint) && rs.some((r) => r.borrowedUsd > 0)) {
      const vault = firstRoute.vault;
      steps.push({
        id: "unwind",
        label: `Close the ${first.symbol} position in one transaction`,
        run: async () => {
          const r = await closeLeverage({ vault, walletAddress, slippageBps: UNWIND_SLIPPAGE_BPS, signTx });
          return { signatures: [r.signature] };
        },
      });
    } else {
      for (let i = rs.length - 1; i >= 0; i--) {
        const r = rs[i];
        const asset = assetOf(r.mint);
        const route = borrowRouteFor(r.mint);
        if (!asset) continue;
        const n = i + 1;
        if (r.borrowedUsd > 0 && route) {
          steps.push({
            id: `repay-${n}`,
            label: `Round ${n}: repay ${fmtUsd(r.borrowedUsd)} and withdraw ${asset.symbol} from ${route.venueLabel}`,
            run: async (report) => {
              const out = await repayAndWithdraw({
                route,
                walletAddress,
                repay: { kind: "usdc", amount: floorCents(r.borrowedUsd * UNWIND_REPAY_PAD) },
                withdraw: { kind: "atomic", amount: BigInt(r.boughtAtomic) },
                signTx,
                onProgress: report,
              });
              return { signatures: out.signatures };
            },
          });
        }
        if (i > 0) {
          steps.push({
            id: `sell-${n}`,
            label: `Round ${n}: sell ${asset.symbol} for USDC`,
            run: async () => {
              const held = await readAtaBalanceAtomic({ mint: asset.mint, owner: walletAddress, programId: tokenProgramFor(asset) });
              const amount = held < BigInt(r.boughtAtomic) ? held : BigInt(r.boughtAtomic);
              if (amount <= 0n) throw new Error(`No ${asset.symbol} in the wallet to sell.`);
              const out = await sellForUsdc({ walletAddress, xstock: asset, amountAtomic: amount, signTx });
              return { signatures: [out.signature] };
            },
          });
        }
      }
    }

    if (steps.length === 0) {
      store.remove(saved.id);
      setMode("open");
      return;
    }
    const ok = await run.start(steps);
    if (ok) {
      store.remove(saved.id);
      runId.current = null;
      data.current = null;
      await onRefresh();
    }
  }

  function handleReset() {
    run.reset();
    setRounds([]);
    setPendingUsd(0);
    setPhase("idle");
    runId.current = null;
    data.current = null;
  }

  const nextAsset = assetOf(nextMint) ?? row.xstock;
  const nextRoute = borrowRouteFor(nextMint);
  const nextBorrow = floorCents(pendingUsd * ratio);
  const nextContinues = nextRoute != null && nextBorrow >= LADDER_FLOOR_USD;

  // ── Saved run views ────────────────────────────────────────────────────────

  if (saved && savedData && run.steps.length === 0 && phase === "idle") {
    const summary = (
      <PreviewBlock>
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
          {saved.status === "running" ? "Ladder in progress" : "Open ladder"} from {fmtUsd(savedData.equityUsd)}
        </div>
        {savedData.rounds.map((r, i) => (
          <PreviewRow
            key={i}
            label={`${r.boughtUi.toFixed(4)} ${assetOf(r.mint)?.symbol ?? "?"}`}
            value={r.borrowedUsd > 0 ? `borrowed ${fmtUsd(r.borrowedUsd)}` : "held"}
            muted={r.borrowedUsd === 0}
          />
        ))}
        {savedData.pendingUsd > 0 && (
          <PreviewRow label="Borrowed USDC not yet spent" value={fmtUsd(savedData.pendingUsd)} />
        )}
        <PreviewRow label="Opened" value={new Date(saved.openedAt).toLocaleDateString()} muted />
      </PreviewBlock>
    );
    if (saved.status === "running") {
      return (
        <div className="space-y-4">
          <Note>
            This ladder was interrupted. Resume checks the chain for anything
            that landed while the page was away, then carries on from the
            step that was next.
          </Note>
          {summary}
          <div className="flex gap-2">
            <button type="button" onClick={handleResume} className={PRIMARY_BUTTON}>
              Resume
            </button>
            <button type="button" onClick={() => store.remove(saved.id)} className={SECONDARY_BUTTON} title="Forget this run. Positions already opened stay on the Borrow tab.">
              Discard
            </button>
          </div>
        </div>
      );
    }
    const sameJupiter =
      savedData.rounds.length > 0 &&
      savedData.rounds.every((r) => r.mint === savedData.rounds[0].mint) &&
      borrowRouteFor(savedData.rounds[0].mint)?.venue === "jupiter";
    return (
      <div className="space-y-4">
        {summary}
        <Note>
          {sameJupiter
            ? "Unwinding sells enough of the asset to repay the loan in one flashloan transaction and returns the rest to the wallet."
            : "Unwinding takes the rounds apart in reverse: each round's asset is sold to repay the loan that bought it, and the first round's asset is returned to the wallet. If a price has fallen, a repay can come up short; add USDC and retry that step."}
        </Note>
        <div className="flex gap-2">
          <button type="button" onClick={handleClose} className={PRIMARY_BUTTON}>
            Unwind ladder
          </button>
          <button type="button" onClick={() => store.remove(saved.id)} className={SECONDARY_BUTTON} title="Forget this run without touching the positions.">
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
        {run.finished && <Note>Unwound. What is left is in the wallet.</Note>}
      </div>
    );
  }

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
            disabled={!amountValid || run.running || saved != null}
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

          {shownRounds.length > 0 && (
            <PreviewBlock>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
                So far
              </div>
              {shownRounds.map((r, i) => (
                <PreviewRow
                  key={i}
                  label={`${r.boughtUi.toFixed(4)} ${assetOf(r.mint)?.symbol ?? "?"}`}
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
                <PreviewRow label="Weakest position health" value={fmtHealth(health)} warn={health < 1.2} />
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
                <button type="button" onClick={handleContinue} disabled={run.running} className={PRIMARY_BUTTON}>
                  Buy {nextAsset.symbol} with {fmtUsd(pendingUsd)}
                </button>
                <button type="button" onClick={() => setPhase("done")} disabled={run.running} className={SECONDARY_BUTTON}>
                  Stop here
                </button>
              </div>
            </div>
          )}

          {phase === "running" && run.failedAt != null && shownRounds.length === 0 && (
            <button
              type="button"
              onClick={() => {
                if (runId.current) store.remove(runId.current);
                handleReset();
              }}
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
          )}

          {phase === "done" && (
            <div className="space-y-3">
              <Note>
                Ladder finished.{" "}
                {pendingUsd > 0
                  ? `${fmtUsd(pendingUsd)} of borrowed USDC stays in the wallet.`
                  : "Every position is on the Borrow tab."}{" "}
                Come back here to unwind it.
              </Note>
            </div>
          )}
        </>
      )}
    </div>
  );
}
