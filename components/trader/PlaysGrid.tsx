"use client";

// Trader mode, Strategies: the plays in lib/strategies/plays.ts as cards,
// each priced live, and a detail that puts the thesis beside the ticket the
// play pre-fills. The ticket is the one the Strategies page opens; a play
// changes what it starts on, not what it signs.

import { useMemo, useState } from "react";

import { AssetLogo } from "@/components/AssetLogo";
import { EarnTicket } from "@/components/strategies/EarnTicket";
import { LadderTicket } from "@/components/strategies/LadderTicket";
import { LeverageTicket } from "@/components/strategies/LeverageTicket";
import { borrowRouteFor } from "@/lib/borrow/route";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { xstockBySymbol } from "@/lib/jupiter/xstocks";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  earnNetApy,
  ladderProjection,
  maxBorrowRatio,
  maxLeverageForRoute,
} from "@/lib/strategies/math";
import { PLAYS, resolvePlay, type Play, type PlayTag, type ResolvedPlay } from "@/lib/strategies/plays";
import { useStrategyRates, type StrategyRates, type StrategyRatesState } from "@/lib/strategies/rates";
import { pickRun, STRATEGY_NAME, useStrategyRuns, type StrategyRun, type StrategyRunsStore } from "@/lib/strategies/runs-client";
import { INSET_PANEL } from "@/lib/ui/surface";

import { PositionSummary } from "./PositionSummary";
import {
  BackLink,
  BigFigure,
  CARD_GRID,
  ChoicePills,
  DetailCard,
  DetailColumns,
  EmptyState,
  fmtPct,
  fmtSignedPct,
  GridCard,
  Pill,
  SmallFigure,
  TraderHeader,
} from "./shared";

type Filter = "all" | PlayTag;

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "Carry", label: "Carry" },
  { id: "Leverage", label: "Leverage" },
  { id: "Conviction", label: "Conviction" },
  { id: "Diversify", label: "Diversify" },
  { id: "Crypto", label: "Crypto" },
  { id: "Rotation", label: "Rotation" },
];

// A play's headline figure: the strategy's own figure from
// lib/strategies/math.ts, at the play's preset, on the live rates. A play
// that names no ratio borrows at the safe maximum, as every Trader borrow
// does (docs/trader-mode-plan.md, D11).
interface Headline {
  label: string;
  value: string;
  tone: "plain" | "positive" | "warn" | "muted";
  sub: string;
}

function headline(r: ResolvedPlay, row: StrategyRates | null, rates: StrategyRatesState): Headline {
  const { play } = r;
  const route = row?.route ?? borrowRouteFor(r.xstock.mint)!;
  if (r.blocked) return { label: "Not available", value: "—", tone: "muted", sub: r.blocked };
  if (play.preset.kind === "earn") {
    const venue = play.preset.venue;
    const option =
      (venue ? rates.earnOptions.find((o) => o.venue === venue) : null) ?? rates.defaultEarn;
    const borrowApr = row?.borrowApr ?? null;
    if (!option || borrowApr == null) {
      return { label: "Net on what you put in", value: "—", tone: "muted", sub: "reading rates" };
    }
    const ratio = play.preset.ratio ?? maxBorrowRatio(route);
    const net = earnNetApy({
      borrowRatio: ratio,
      earnApy: option.apy,
      borrowApr,
      collateralSupplyApy: row?.collateralSupplyApy ?? 0,
    });
    return {
      label: option.monDenominated ? "Net, in MON terms" : "Net on what you put in",
      value: fmtSignedPct(net),
      tone: net > 0 ? "positive" : "warn",
      sub: `borrow ${fmtPct(borrowApr)}, earn ${fmtPct(option.apy)} in ${option.label}`,
    };
  }
  if (play.preset.kind === "leverage") {
    const max = maxLeverageForRoute(route);
    const lev = play.preset.leverage === "max" ? max : Math.min(play.preset.leverage, max);
    return {
      label: "Exposure",
      value: `${lev.toFixed(1)}×`,
      tone: "plain",
      sub:
        row?.borrowApr != null
          ? `one transaction, borrowing at ${fmtPct(row.borrowApr)}`
          : "one transaction",
    };
  }
  const ratio = play.preset.ratio ?? maxBorrowRatio(route);
  const nextHasMarket = r.next ? borrowRouteFor(r.next.mint) != null : true;
  if (!nextHasMarket) {
    return {
      label: "Exposure",
      value: `${(1 + ratio).toFixed(2)}×`,
      tone: "plain",
      sub: `${Math.round(ratio * 100)}% of the stock's value into ${r.next?.symbol}, one round`,
    };
  }
  const p = ladderProjection({ equityUsd: 100, borrowRatio: ratio });
  return {
    label: "Exposure if run to the floor",
    value: `${p.leverage.toFixed(2)}×`,
    tone: "plain",
    sub: `${p.rounds.length} rounds, each signed on its own`,
  };
}

export function PlaysGrid({
  walletAddress,
  balances,
  prices,
  onRefresh,
}: {
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  const rates = useStrategyRates();
  const store = useStrategyRuns(walletAddress);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const resolved = useMemo(() => PLAYS.map((p) => resolvePlay(p, rates)), [rates]);
  const cards = filter === "all" ? resolved : resolved.filter((r) => r.play.tag === filter);
  const opened = open ? resolved.find((r) => r.play.id === open) : null;

  if (opened) {
    return (
      <PlayDetail
        resolved={opened}
        rates={rates}
        store={store}
        walletAddress={walletAddress}
        balances={balances}
        prices={prices}
        onRefresh={onRefresh}
        onBack={() => setOpen(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <TraderHeader eyebrow="Strategies" title="Plays with a thesis">
        Each one is a stock, a loan and a destination, chosen for a stated
        reason. Open a play to read the reason and the numbers, then run it in
        one press. Every step signs on its own and a refresh resumes where it
        stopped.
      </TraderHeader>

      <ChoicePills options={FILTERS} value={filter} onChange={setFilter} label="Filter plays" />

      {cards.length === 0 ? (
        <EmptyState>No play carries that tag.</EmptyState>
      ) : (
        <div className={CARD_GRID}>
          {cards.map((r) => (
            <PlayCard
              key={r.play.id}
              resolved={r}
              row={rates.rows.find((x) => x.xstock.mint === r.xstock.mint) ?? null}
              rates={rates}
              saved={pickRun(store.runs, r.kind, r.xstock.mint)}
              onOpen={() => setOpen(r.play.id)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-white/40">
        xStocks are tokenized representations issued by Backed Finance. Holders
        do not have direct shareholder rights. Every play borrows against them
        and can be liquidated if the price falls past the venue&apos;s
        threshold.
      </p>
    </div>
  );
}

function PlayCard({
  resolved,
  row,
  rates,
  saved,
  onOpen,
}: {
  resolved: ResolvedPlay;
  row: StrategyRates | null;
  rates: StrategyRatesState;
  saved: StrategyRun | null;
  onOpen: () => void;
}) {
  const { play, xstock, next } = resolved;
  const h = headline(resolved, row, rates);
  return (
    <GridCard onClick={onOpen} muted={resolved.blocked != null}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-medium tracking-tight text-white">{play.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill>{play.tag}</Pill>
            <Pill>{STRATEGY_NAME[resolved.kind]}</Pill>
            {saved && (
              <Pill tone={saved.status === "running" ? "warn" : "positive"}>
                {saved.status === "running" ? "Resume" : "Open"}
              </Pill>
            )}
          </div>
        </div>
        <AssetLogo xstock={xstock} size={36} />
      </div>

      <p className="text-xs leading-relaxed text-white/60">{play.thesis}</p>

      <Composition resolved={resolved} rates={rates} />

      <div className="mt-auto flex items-end justify-between gap-4 border-t border-white/[0.06] pt-4">
        <BigFigure label={h.label} value={h.value} tone={h.tone} sub={h.sub} />
        {next && <SmallFigure label="Then" value={next.symbol} />}
      </div>
    </GridCard>
  );
}

// The play as a chain of marks: the stock, the loan, where it goes.
function Composition({ resolved, rates }: { resolved: ResolvedPlay; rates: StrategyRatesState }) {
  const { play, xstock, next } = resolved;
  let end: string;
  if (play.preset.kind === "earn") {
    const venue = play.preset.venue;
    const option = venue ? rates.earnOptions.find((o) => o.venue === venue) : rates.defaultEarn;
    end = option?.label ?? (venue === "glider" ? "Mag7X on Base" : venue === "shmonad" ? "shMON on Monad" : "USDC vault");
  } else if (play.preset.kind === "leverage") {
    end = `more ${xstock.symbol}`;
  } else {
    end = next?.symbol ?? xstock.symbol;
  }
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-white/50">
      {xstock.symbol} <span className="text-white/25">→</span> USDC{" "}
      <span className="text-white/25">→</span> {end}
    </div>
  );
}

function PlayDetail({
  resolved,
  rates,
  store,
  walletAddress,
  balances,
  prices,
  onRefresh,
  onBack,
}: {
  resolved: ResolvedPlay;
  rates: StrategyRatesState;
  store: StrategyRunsStore;
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
  onBack: () => void;
}) {
  const { play, xstock, kind } = resolved;
  const row = rates.rows.find((r) => r.xstock.mint === xstock.mint) ?? null;
  const saved = pickRun(store.runs, kind, xstock.mint);
  const h = headline(resolved, row, rates);
  const [tick, setTick] = useState(0);
  const settled = async () => {
    await onRefresh();
    setTick((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      <BackLink label="All plays" onClick={onBack} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <AssetLogo xstock={xstock} size={40} />
          <div>
            <div className="text-lg font-light tracking-tight text-white">{play.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Pill>{play.tag}</Pill>
              <Pill>{STRATEGY_NAME[kind]}</Pill>
              <Pill>{xstock.symbol}</Pill>
            </div>
          </div>
        </div>
        <BigFigure label={h.label} value={h.value} tone={h.tone} sub={h.sub} align="right" />
      </div>

      <DetailColumns
        left={
          <DetailCard title={STRATEGY_NAME[kind]}>
            {row ? (
              <PlayTicket
                play={play}
                row={row}
                rates={rates}
                store={store}
                saved={saved}
                walletAddress={walletAddress}
                balances={balances}
                prices={prices}
                onRefresh={settled}
              />
            ) : (
              <p className="text-sm text-white/50">
                {rates.loading ? "Loading markets…" : `${xstock.symbol} has no market right now.`}
              </p>
            )}
          </DetailCard>
        }
        right={
          <div className="space-y-6">
            <DetailCard title="The thesis">
              <p className="text-sm leading-relaxed text-white/75">{play.thesis}</p>
              <ol className={`${INSET_PANEL} mt-4 space-y-2 px-3 py-3 text-xs`}>
                {play.steps.map((s, i) => (
                  <li key={s} className="flex gap-2.5">
                    <span className="font-mono text-white/40">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-white/70">{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 rounded-xl border border-aeras-warning/30 bg-aeras-warning/10 px-4 py-3 text-xs leading-relaxed text-white/70">
                <span className="font-medium text-aeras-warning">What loses money here.</span>{" "}
                {play.risk}
              </div>
            </DetailCard>
            {row && (
              <PositionSummary
                row={row}
                walletAddress={walletAddress}
                prices={prices}
                saved={saved}
                earnOptions={rates.earnOptions}
                refreshKey={tick}
              />
            )}
          </div>
        }
      />
    </div>
  );
}

// The strategy's own ticket, opened on the play's preset. Keyed by play so a
// different play on the same asset mounts fresh.
function PlayTicket({
  play,
  row,
  rates,
  store,
  saved,
  walletAddress,
  balances,
  prices,
  onRefresh,
}: {
  play: Play;
  row: StrategyRates;
  rates: StrategyRatesState;
  store: StrategyRunsStore;
  saved: StrategyRun | null;
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  const common = { row, walletAddress, balances, prices, store, saved, onRefresh };
  if (play.preset.kind === "earn") {
    return (
      <EarnTicket
        key={play.id}
        {...common}
        earn={rates.defaultEarn}
        earnOptions={rates.earnOptions}
        initialVenue={play.preset.venue}
        initialRatio={play.preset.ratio ?? maxBorrowRatio(row.route)}
      />
    );
  }
  if (play.preset.kind === "leverage") {
    return <LeverageTicket key={play.id} {...common} initialLeverage={play.preset.leverage} />;
  }
  // The first pick, by mint. Resolved through the catalog rather than the
  // rates rows because a ladder-ending pick (gold) has no borrow row.
  const nextSymbol = play.preset.nextSymbol;
  const next = nextSymbol ? xstockBySymbol(nextSymbol)?.mint : undefined;
  return (
    <LadderTicket
      key={play.id}
      {...common}
      rows={rates.rows}
      initialRatio={play.preset.ratio ?? maxBorrowRatio(row.route)}
      initialNextMint={next}
    />
  );
}
