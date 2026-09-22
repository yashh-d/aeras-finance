"use client";

// Trader mode, Strategies: the plays in lib/strategies/plays.ts as cards,
// each priced live and each showing its exposures as marks, and a detail
// that puts the thesis beside the ticket the play pre-fills. The ticket is
// the one the Strategies page opens, on the play's venue alone; a play
// changes what it starts on, not what it signs.

import { useMemo, useState } from "react";

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
import {
  PLAYS,
  playPool,
  resolvePlay,
  type Play,
  type PlayTag,
  type ResolvedPlay,
} from "@/lib/strategies/plays";
import {
  useStrategyRates,
  type StrategyRates,
  type StrategyRatesState,
  type UsdcEarnOption,
} from "@/lib/strategies/rates";
import { pickRun, useStrategyRuns, type StrategyRun, type StrategyRunsStore } from "@/lib/strategies/runs-client";
import { assetMark, destinationMarks, type Mark } from "@/lib/trader/exposures";

import { ExposureStrip } from "./ExposureStrip";
import { PositionSummary } from "./PositionSummary";
import {
  BackLink,
  BigFigure,
  CARD_GRID,
  ChoicePills,
  DetailCard,
  DetailColumns,
  EmptyState,
  fmtSignedPct,
  GridCard,
  Pill,
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
  { id: "Fees", label: "Fees" },
];

// The venue a play's loan goes to, when it is an earn play. A play naming a
// Uniswap pool resolves to that pool's option, not to the venue's
// best-paying one.
function playOption(play: Play, rates: StrategyRatesState): UsdcEarnOption | null {
  if (play.preset.kind !== "earn") return null;
  const pool = playPool(play);
  if (pool) {
    return (
      rates.uniswapOptions.find(
        (o) => o.uniswapPool?.id.toLowerCase() === pool.id.toLowerCase(),
      ) ?? null
    );
  }
  const venue = play.preset.venue;
  return (venue ? rates.earnOptions.find((o) => o.venue === venue) : null) ?? rates.defaultEarn;
}

// What the play ends up holding, as marks: the asset bought, then what the
// loan becomes. Leverage is the same asset again; a ladder is its next pick.
function playMarks(r: ResolvedPlay, rates: StrategyRatesState): { from: Mark; to: Mark[] } {
  const from = assetMark(r.xstock);
  const { play } = r;
  if (play.preset.kind === "earn") {
    const option = playOption(play, rates);
    const venue = option?.venue ?? play.preset.venue;
    // A pool draws as its pair. The play's own pool stands in before the
    // rates land, so the marks do not change under the reader.
    const pool = option?.uniswapPool ?? r.pool;
    return { from, to: venue ? destinationMarks(venue, pool) : [] };
  }
  if (play.preset.kind === "leverage") {
    return { from, to: [assetMark(r.xstock, `${r.xstock.mint}-again`)] };
  }
  return { from, to: [r.next ? assetMark(r.next) : assetMark(r.xstock, `${r.xstock.mint}-again`)] };
}

// A play's headline figure: the strategy's own figure from
// lib/strategies/math.ts, at the play's preset, on the live rates. A play
// that names no ratio borrows at the safe maximum, as every Trader borrow
// does (docs/trader-mode-plan.md, D11). The figure and its label, nothing
// under it (D16); the exposures are the strip.
interface Headline {
  label: string;
  value: string;
  tone: "plain" | "positive" | "warn" | "muted";
}

function headline(r: ResolvedPlay, row: StrategyRates | null, rates: StrategyRatesState): Headline {
  const { play } = r;
  const route = row?.route ?? borrowRouteFor(r.xstock.mint)!;
  if (r.blocked) return { label: r.blocked, value: "—", tone: "muted" };
  if (play.preset.kind === "earn") {
    const option = playOption(play, rates);
    const borrowApr = row?.borrowApr ?? null;
    if (!option || borrowApr == null) {
      return { label: "Net on what you put in", value: "—", tone: "muted" };
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
    };
  }
  if (play.preset.kind === "leverage") {
    const max = maxLeverageForRoute(route);
    const lev = play.preset.leverage === "max" ? max : Math.min(play.preset.leverage, max);
    return { label: "Exposure", value: `${lev.toFixed(1)}×`, tone: "plain" };
  }
  const ratio = play.preset.ratio ?? maxBorrowRatio(route);
  const nextHasMarket = r.next ? borrowRouteFor(r.next.mint) != null : true;
  if (!nextHasMarket) {
    return { label: "Exposure", value: `${(1 + ratio).toFixed(2)}×`, tone: "plain" };
  }
  const p = ladderProjection({ equityUsd: 100, borrowRatio: ratio });
  return { label: "Exposure", value: `${p.leverage.toFixed(2)}×`, tone: "plain" };
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
        A stock, a loan and a destination, chosen for a reason. Open one to
        read it, then run it in one press.
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
        and can be liquidated if the price falls past the threshold the ticket
        shows.
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
  const { play } = resolved;
  const h = headline(resolved, row, rates);
  const marks = playMarks(resolved, rates);
  return (
    <GridCard onClick={onOpen} muted={resolved.blocked != null}>
      <div className="flex items-start justify-between gap-3">
        <ExposureStrip from={marks.from} to={marks.to} size={32} max={8} />
        <div className="flex shrink-0 gap-1.5">
          {saved && (
            <Pill tone={saved.status === "running" ? "warn" : "positive"}>
              {saved.status === "running" ? "Resume" : "Open"}
            </Pill>
          )}
          <Pill>{play.tag}</Pill>
        </div>
      </div>

      <div>
        <div className="text-base font-medium tracking-tight text-white">{play.name}</div>
        <p className="mt-1.5 text-xs leading-relaxed text-white/55">{play.thesis}</p>
      </div>

      <div className="mt-auto pt-1">
        <BigFigure label={h.label} value={h.value} tone={h.tone} />
      </div>
    </GridCard>
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
  const marks = playMarks(resolved, rates);
  const [tick, setTick] = useState(0);
  const settled = async () => {
    await onRefresh();
    setTick((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      <BackLink label="All plays" onClick={onBack} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ExposureStrip from={marks.from} to={marks.to} size={40} max={8} />
          <div>
            <div className="text-xl font-light tracking-tight text-white">{play.name}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <Pill>{play.tag}</Pill>
              <Pill>{xstock.symbol}</Pill>
            </div>
          </div>
        </div>
        <BigFigure label={h.label} value={h.value} tone={h.tone} align="right" />
      </div>

      <DetailColumns
        left={
          <DetailCard title="Run it">
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
              <p className="mt-3 text-xs leading-relaxed text-white/50">
                <span className="text-aeras-warning/90">Risk.</span> {play.risk}
              </p>
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

// The strategy's own ticket, opened on the play's preset and, for an earn
// play, on the play's venue alone. Keyed by play so a different play on the
// same asset mounts fresh.
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
    const option = playOption(play, rates);
    // A saved run's own venue always rides along, so its close path
    // withdraws from the venue that holds the money.
    const savedVenue = saved?.data.kind === "earn" ? saved.data.earnVenue : null;
    const savedOption = savedVenue
      ? (rates.earnOptions.find((o) => o.venue === savedVenue) ?? null)
      : null;
    const earnOptions =
      option && savedOption && savedOption.venue !== option.venue
        ? [option, savedOption]
        : option
          ? [option]
          : savedOption
            ? [savedOption]
            : [];
    return (
      <EarnTicket
        key={play.id}
        {...common}
        earn={option ?? savedOption}
        earnOptions={earnOptions}
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
