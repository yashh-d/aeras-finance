"use client";

// The three strategies as buttons under an asset's chart, and the ticket the
// chosen one opens in place of the market ticket.
//
// This is the strip docs/buy-strategies-plan.md describes under "Where it
// lives in the UI", drawn as buttons. The Markets row expansion and the Home
// asset detail in app/app/page.tsx mount it under their PriceChart, and the
// Strategies page draws the same strip and ticket, so the three surfaces
// cannot drift. Each button carries the one live number its strategy turns on
// (the net rate for Buy + Earn, the multiple for Buy + Leverage, the borrow
// rate for Buy + Buy more), or the state of a saved run on it, and nothing
// else: the explanation of what each strategy does lives in the ticket's
// preview, priced on the amount the user typed, not in a paragraph beside it.
//
// The hook composes the two data hooks the Strategies page holds at page level
// (live rates for every borrow market, this wallet's saved runs). It is enabled
// only for an asset with a borrow route and a wallet to sign with, because the
// rates hook reads every market on mount and an asset with no route has
// nothing to show.

import { useState } from "react";

import { borrowRouteFor } from "@/lib/borrow/route";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { XStock } from "@/lib/jupiter/xstocks";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  defaultBorrowRatio,
  earnNetApy,
  maxLeverageForRoute,
} from "@/lib/strategies/math";
import {
  useStrategyRates,
  type StrategyRates,
  type StrategyRatesState,
} from "@/lib/strategies/rates";
import {
  pickRun,
  STRATEGY_NAME,
  useStrategyRuns,
  type StrategyKind,
  type StrategyRun,
  type StrategyRunsStore,
} from "@/lib/strategies/runs-client";

import { EarnTicket } from "./EarnTicket";
import { LadderTicket } from "./LadderTicket";
import { LeverageTicket } from "./LeverageTicket";
import { fmtPct, fmtSignedPct, SECONDARY_BUTTON } from "./shared";

// Button order, left to right.
const STRATEGIES: readonly StrategyKind[] = ["earn", "leverage", "ladder"];

export interface AssetStrategies {
  xstock: XStock;
  walletAddress: string;
  rates: StrategyRatesState;
  // This asset's rates. Present as soon as the route resolves; its live
  // figures are null until the markets have loaded.
  row: StrategyRates | null;
  store: StrategyRunsStore;
  selected: StrategyKind | null;
  select: (strategy: StrategyKind | null) => void;
}

// Null when the asset has no borrow market or there is no wallet to sign with,
// in which case the surface draws no strip and keeps its market ticket.
export function useAssetStrategies(
  xstock: XStock,
  walletAddress: string | null | undefined,
): AssetStrategies | null {
  const enabled = borrowRouteFor(xstock.mint) != null && !!walletAddress;
  const rates = useStrategyRates(enabled);
  const store = useStrategyRuns(enabled ? walletAddress : undefined);
  const [selected, select] = useState<StrategyKind | null>(null);
  if (!enabled || !walletAddress) return null;
  return {
    xstock,
    walletAddress,
    rates,
    row: rates.rows.find((r) => r.xstock.mint === xstock.mint) ?? null,
    store,
    selected,
    select,
  };
}

type Tone = "muted" | "plain" | "positive" | "warn";

const TONE_CLASS: Record<Tone, string> = {
  muted: "text-white/40",
  plain: "text-white/60",
  positive: "text-aeras-positive",
  warn: "text-aeras-warning",
};

// The one figure under each button. A saved run on the strategy wins over the
// rate, because "Resume" or "Open" is what the user needs to know first.
function figure(
  strategy: StrategyKind,
  row: StrategyRates,
  earnApy: number | null,
  runs: StrategyRun[],
): { text: string; tone: Tone } {
  const own = runs.filter((r) => r.strategy === strategy);
  if (own.some((r) => r.status === "running")) return { text: "Resume", tone: "warn" };
  if (own.some((r) => r.status === "done")) return { text: "Open", tone: "plain" };

  if (strategy === "earn") {
    if (earnApy == null || row.borrowApr == null) return { text: "—", tone: "muted" };
    const net = earnNetApy({
      borrowRatio: defaultBorrowRatio(row.route),
      earnApy,
      borrowApr: row.borrowApr,
      collateralSupplyApy: row.collateralSupplyApy,
    });
    return { text: fmtSignedPct(net), tone: net > 0 ? "positive" : "warn" };
  }
  if (strategy === "leverage") {
    const max = maxLeverageForRoute(row.route);
    return {
      text: `${max.toFixed(1)}× max${row.route.venue === "kamino" ? ", in steps" : ""}`,
      tone: "plain",
    };
  }
  return row.borrowApr == null
    ? { text: "—", tone: "muted" }
    : { text: `${fmtPct(row.borrowApr)} borrow`, tone: "plain" };
}

// The three buttons. `runs` are this wallet's saved runs on the asset.
export function StrategyStrip({
  row,
  earnApy,
  runs,
  selected,
  onSelect,
}: {
  row: StrategyRates;
  // Where borrowed USDC goes by default, for the Buy + Earn figure.
  earnApy: number | null;
  runs: StrategyRun[];
  selected: StrategyKind | null;
  // Called with null when the pressed button is pressed again, which is how a
  // surface with a market ticket returns to it.
  onSelect: (strategy: StrategyKind | null) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {STRATEGIES.map((strategy) => {
        const active = selected === strategy;
        const f = figure(strategy, row, earnApy, runs);
        return (
          <button
            key={strategy}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : strategy)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              active
                ? "border-white/40 bg-white/10"
                : "border-white/10 hover:bg-white/5"
            }`}
          >
            <div className="text-xs font-medium text-white">
              {STRATEGY_NAME[strategy]}
            </div>
            <div className={`mt-0.5 font-mono text-[11px] tabular-nums ${TONE_CLASS[f.tone]}`}>
              {f.text}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// The chosen strategy's ticket. `onBack` returns the surface to its market
// ticket; the Strategies page, which has none, passes nothing.
export function StrategyTicket({
  strategy,
  row,
  rates,
  store,
  walletAddress,
  balances,
  prices,
  onRefresh,
  onBack,
}: {
  strategy: StrategyKind;
  row: StrategyRates;
  rates: StrategyRatesState;
  store: StrategyRunsStore;
  walletAddress: string;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
  onBack?: () => void;
}) {
  const common = {
    row,
    walletAddress,
    balances,
    prices,
    store,
    saved: pickRun(store.runs, strategy, row.xstock.mint),
    onRefresh,
  };
  // Keyed so switching asset or strategy mounts a fresh ticket; a half-run
  // ladder must not carry its rounds over to another asset.
  const key = `${strategy}-${row.xstock.mint}`;
  return (
    <div className="space-y-4">
      {onBack && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-medium text-white">
            {STRATEGY_NAME[strategy]}
          </div>
          <button type="button" onClick={onBack} className={SECONDARY_BUTTON}>
            Market order
          </button>
        </div>
      )}
      {strategy === "earn" ? (
        <EarnTicket
          key={key}
          {...common}
          earn={rates.defaultEarn}
          earnOptions={rates.earnOptions}
        />
      ) : strategy === "leverage" ? (
        <LeverageTicket key={key} {...common} />
      ) : (
        <LadderTicket key={key} {...common} rows={rates.rows} />
      )}
    </div>
  );
}

// The two pieces the asset surfaces mount, fed from useAssetStrategies.

export function AssetStrategyStrip({ strategies }: { strategies: AssetStrategies }) {
  if (!strategies.row) return null;
  return (
    <StrategyStrip
      row={strategies.row}
      earnApy={strategies.rates.defaultEarn?.apy ?? null}
      runs={strategies.store.runs.filter((r) => r.mint === strategies.xstock.mint)}
      selected={strategies.selected}
      onSelect={strategies.select}
    />
  );
}

export function AssetStrategyTicket({
  strategies,
  balances,
  prices,
  onRefresh,
}: {
  strategies: AssetStrategies;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  onRefresh: () => Promise<void> | void;
}) {
  if (!strategies.selected || !strategies.row) return null;
  return (
    <StrategyTicket
      strategy={strategies.selected}
      row={strategies.row}
      rates={strategies.rates}
      store={strategies.store}
      walletAddress={strategies.walletAddress}
      balances={balances}
      prices={prices}
      onRefresh={onRefresh}
      onBack={() => strategies.select(null)}
    />
  );
}
