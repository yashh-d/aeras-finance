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
import { fetchGliderPortfolio } from "@/lib/glider/client";
import {
  GLIDER_LADDER_MINT,
  GLIDER_STRATEGY_NAME,
  MAG7X_MIN_DEPOSIT_USD,
} from "@/lib/glider/constants";
import { XSTOCKS, xstockByMint, type XStock } from "@/lib/jupiter/xstocks";
import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import { VENUE_LOGOS } from "@/lib/tokens/logos";
import { useSignSolanaTxBase64 } from "@/lib/privy/sign";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  buyWithUsdc,
  closeLeverage,
  depositAndBorrow,
  depositUsdcToEarn,
  readAtaBalanceAtomic,
  readJupiterPosition,
  readKaminoPosition,
  repayAndWithdraw,
  sellForUsdc,
  tokenProgramFor,
  withdrawUsdcFromEarn,
  type BuyResult,
  type MonadSigners,
} from "@/lib/strategies/execute";
import {
  defaultBorrowRatio,
  LADDER_FLOOR_USD,
  ladderProjection,
  minHealth,
  type HealthInput,
} from "@/lib/strategies/math";
import type { StrategyRates, UsdcEarnOption } from "@/lib/strategies/rates";
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
  useTicketFlow,
  useVenueNames,
} from "./shared";

const MIN_BUY_USD = 5;

// What the Mag7X round hands to the shared deposit and exit path in
// lib/strategies/execute.ts. `apy` is not read there; the pick is an
// exposure, and its boost is drawn from the strategy view, not from here.
const GLIDER_OPTION: UsdcEarnOption = {
  venue: "glider",
  label: `${GLIDER_STRATEGY_NAME} on Base`,
  apy: 0,
};
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
  initialRatio,
  initialNextMint,
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
  // A play's preset (lib/strategies/plays.ts): the ratio and the first
  // pick the ticket opens on. Seeds the state below and nothing else.
  initialRatio?: number;
  initialNextMint?: string;
}) {
  const signTx = useSignSolanaTxBase64();
  const run = useStrategyRun();
  // False under Trader mode: the copy then names no lending venue.
  const named = useVenueNames();
  // Set under Trader mode: draws the ladder above the preview.
  const flow = useTicketFlow();
  const savedData = saved?.data.kind === "ladder" ? saved.data : null;
  const [amountInput, setAmountInput] = useState("");
  const [ratio, setRatio] = useState(() => initialRatio ?? defaultBorrowRatio(row.route));
  const [phase, setPhase] = useState<Phase>("idle");
  const [rounds, setRounds] = useState<LadderRound[]>([]);
  // USDC the last round borrowed, waiting to be spent.
  const [pendingUsd, setPendingUsd] = useState(0);
  const [nextMint, setNextMint] = useState(initialNextMint ?? row.xstock.mint);
  const [mode, setMode] = useState<"open" | "close">("open");
  // The Mag7X eligibility statement, required by the enroll route the first
  // time borrowed USDC is sent there.
  const [attested, setAttested] = useState(false);
  const evm = useEmbeddedEvmWallet();
  const solanaSignAndSend = useSendSolanaTxBase64();
  const monad: MonadSigners | undefined = evm.address
    ? {
        evm: { address: evm.address, switchChain: evm.switchChain, getProvider: evm.getProvider },
        solanaSignAndSend,
      }
    : undefined;
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
  const symbolOf = (mint: string) =>
    mint === GLIDER_LADDER_MINT ? "Mag7X" : (assetOf(mint)?.symbol ?? "?");

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
      label: `Round ${n}: deposit ${asset.symbol} and borrow USDC${named ? ` on ${route.venueLabel}` : ""}`,
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

  // A round whose borrowed USDC goes into Bitwise Mag7X on Glider rather
  // than into a catalog asset. One step, and the last: nothing on Base can be
  // posted as collateral here, so there is no borrow and the ladder ends.
  // Goes through the same deposit path Buy + Earn uses, so there is one.
  function gliderRoundSteps(usd: number, n: number): StepDef[] {
    const d = data.current!;
    d.inFlight = { mint: GLIDER_LADDER_MINT, usd };
    const finish = () => {
      const round: LadderRound = {
        mint: GLIDER_LADDER_MINT,
        buyUsd: usd,
        boughtUi: usd,
        boughtAtomic: String(Math.round(usd * 1_000_000)),
        borrowedUsd: 0,
      };
      setRounds((prev) => [...prev, round]);
      setPendingUsd(0);
      if (data.current) data.current.inFlight = undefined;
      setPhase("done");
    };
    return [
      {
        id: `buy-${n}`,
        label: `Round ${n}: put ${fmtUsd(usd)} of borrowed USDC into ${GLIDER_STRATEGY_NAME} on Base`,
        run: async (report) => {
          const r = await depositUsdcToEarn({
            option: GLIDER_OPTION,
            walletAddress,
            amountUsdc: usd,
            signTx,
            monad,
            gliderAttested: attested,
            onProgress: report,
          });
          finish();
          return { signatures: [r.signature] };
        },
        // Landed if Glider values the portfolio at most of what was sent.
        // A resume after an interrupted deposit cannot tell an older
        // position from this one; the ladder ends here either way, so the
        // worst case is a round recorded as landed that a second press of
        // Resume would otherwise have re-sent.
        reconcile: async () => {
          const read = await fetchGliderPortfolio();
          const ok = (read.portfolio?.totalValueUsd ?? 0) >= usd * 0.5;
          if (ok) finish();
          return ok;
        },
      },
    ];
  }

  async function handleStart() {
    if (!amountValid || phase !== "idle") return;
    runId.current = newRunId();
    data.current = { kind: "ladder", equityUsd: amountUsd, ratio, rounds: [], pendingUsd: 0, phase: "running" };
    bought.current = null;
    setRounds([]);
    setPendingUsd(0);
    // The play's first pick survives the start; without it a play that
    // opened on gold prompted for the collateral again after round one.
    setNextMint(initialNextMint ?? row.xstock.mint);
    setPhase("running");
    // On failure the phase stays "running": the step list with its retry
    // button is what the user needs to see, and the step's own success handler
    // moves the phase on once the retry lands.
    await run.start(roundSteps(row.xstock, amountUsd, 1, true));
    await onRefresh();
  }

  async function handleContinue() {
    if (phase !== "prompt" || pendingUsd <= 0) return;
    bought.current = null;
    if (nextMint === GLIDER_LADDER_MINT) {
      setPhase("running");
      await run.extend(gliderRoundSteps(pendingUsd, rounds.length + 1));
      await onRefresh();
      return;
    }
    const asset = assetOf(nextMint);
    if (!asset) return;
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
      let live: StepDef[];
      if (inFlight.mint === GLIDER_LADDER_MINT) {
        live = gliderRoundSteps(inFlight.usd, n);
      } else {
        const asset = assetOf(inFlight.mint);
        if (!asset) return;
        live = roundSteps(asset, inFlight.usd, n, n === 1);
      }
      setPhase("running");
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
        const n = i + 1;
        if (r.mint === GLIDER_LADDER_MINT) {
          steps.push({
            id: `exit-${n}`,
            label: `Round ${n}: sell the Mag7X holdings on Base and bring the USDC back to Solana`,
            run: async (report) => {
              const out = await withdrawUsdcFromEarn({
                option: GLIDER_OPTION,
                walletAddress,
                amountUsdc: r.buyUsd,
                signTx,
                monad,
                onProgress: report,
              });
              return { signatures: out.signature ? [out.signature] : [] };
            },
          });
          continue;
        }
        const asset = assetOf(r.mint);
        const route = borrowRouteFor(r.mint);
        if (!asset) continue;
        if (r.borrowedUsd > 0 && route) {
          steps.push({
            id: `repay-${n}`,
            label: `Round ${n}: repay ${fmtUsd(r.borrowedUsd)} and withdraw ${asset.symbol}${named ? ` from ${route.venueLabel}` : ""}`,
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

  const nextIsGlider = nextMint === GLIDER_LADDER_MINT;
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
            label={r.mint === GLIDER_LADDER_MINT ? `${fmtUsd(r.buyUsd)} in Mag7X` : `${r.boughtUi.toFixed(4)} ${symbolOf(r.mint)}`}
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
            <button type="button" onClick={() => store.remove(saved.id)} className={SECONDARY_BUTTON} title={named ? "Forget this run. Positions already opened stay on the Borrow tab." : "Forget this run. Positions already opened stay open."}>
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

          {flow?.({
            kind: "ladder",
            xstock: row.xstock,
            amountUsd: amountValid ? amountUsd : null,
            ratio,
            next: nextIsGlider ? null : nextAsset,
            nextIsGlider,
            nextHasMarket: nextRoute != null,
            rounds: projection?.rounds ?? null,
          })}

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
                  label={r.mint === GLIDER_LADDER_MINT ? `${fmtUsd(r.buyUsd)} in Mag7X` : `${r.boughtUi.toFixed(4)} ${symbolOf(r.mint)}`}
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
                <button
                  type="button"
                  onClick={() => setNextMint(GLIDER_LADDER_MINT)}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
                    nextIsGlider
                      ? "border-white/20 bg-white/10 text-white"
                      : "border-white/10 text-white/60 hover:text-white"
                  }`}
                  title={`${GLIDER_STRATEGY_NAME}: Mag7 + SpaceX at equal weight on Base, via Glider`}
                >
                  <AssetLogo xstock={{ symbol: "MAG7X", name: GLIDER_STRATEGY_NAME, logo: VENUE_LOGOS.glider }} size={18} />
                  <span className="truncate">Mag7X</span>
                  <span className="ml-auto text-[9px] uppercase tracking-wider text-white/30">ends</span>
                </button>
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
                label={named ? `Then borrow on ${nextRoute?.venueLabel ?? "—"}` : "Then borrow"}
                value={
                  nextIsGlider
                    ? "nothing, Mag7X is not collateral here"
                    : nextRoute == null
                      ? `nothing, ${nextAsset.symbol} has no market`
                      : nextContinues
                        ? fmtUsd(nextBorrow)
                        : `nothing, under ${fmtUsd(LADDER_FLOOR_USD)}`
                }
                muted={!nextContinues}
              />
              {nextIsGlider && (
                <>
                  <Note>
                    Mag7X is equity exposure on Base, not a cash deposit: eight Coinbase
                    tokenized stocks at equal weight, plus Glider&apos;s boost campaign paid in
                    dollars while it runs. Minimum {fmtUsd(MAG7X_MIN_DEPOSIT_USD)}, because Glider
                    skips any slice under its $5 swap threshold.
                  </Note>
                  <label className="flex items-start gap-2 text-xs text-white/60">
                    <input
                      type="checkbox"
                      checked={attested}
                      onChange={(e) => setAttested(e.target.checked)}
                      disabled={run.running}
                      className="mt-0.5"
                    />
                    <span>
                      I am not a US person and not in a restricted jurisdiction. Coinbase
                      tokenized stocks are offered under Regulation S.
                    </span>
                  </label>
                </>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={run.running || (nextIsGlider && (!attested || !monad || pendingUsd < MAG7X_MIN_DEPOSIT_USD))}
                  className={PRIMARY_BUTTON}
                >
                  {nextIsGlider ? `Put ${fmtUsd(pendingUsd)} into Mag7X` : `Buy ${nextAsset.symbol} with ${fmtUsd(pendingUsd)}`}
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
                  : named
                    ? "Every position is on the Borrow tab."
                    : "Every position is open."}{" "}
                Come back here to unwind it.
              </Note>
            </div>
          )}
        </>
      )}
    </div>
  );
}
