"use client";

// The Strategies page. One row per asset with a borrow market, with the live
// numbers each strategy turns on: what it costs to borrow against, what the
// spread to the best USDC vault is, and how much leverage the venue allows.
// A row opens into the three tickets.
//
// Its own page for now, rather than a strip on the buy ticket, so the three
// flows can be tried end to end before they are folded into Markets. See
// docs/buy-strategies-plan.md.

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { AssetLogo } from "@/components/AssetLogo";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import type { AccountBalances } from "@/lib/solana/balances";
import {
  defaultBorrowRatio,
  earnNetApy,
  maxLeverageForRoute,
} from "@/lib/strategies/math";
import { useStrategyRates, type StrategyRates } from "@/lib/strategies/rates";
import {
  pickRun,
  STRATEGY_NAME,
  useStrategyRuns,
  type StrategyKind,
  type StrategyRun,
} from "@/lib/strategies/runs-client";
import { GLASS_SURFACE } from "@/lib/ui/surface";

import { EarnTicket } from "./EarnTicket";
import { LadderTicket } from "./LadderTicket";
import { LeverageTicket } from "./LeverageTicket";
import { fmtPct, fmtSignedPct } from "./shared";

type Strategy = StrategyKind;

const STRATEGY_LABEL = STRATEGY_NAME;

const STRATEGY_BLURB: Record<Strategy, string> = {
  earn: "Buy the asset, borrow USDC against it, and put the USDC in a vault. You keep the asset and earn the spread between the vault and the loan.",
  leverage:
    "Buy a multiple of what you pay. One transaction on Jupiter Lend: a flashloan buys the whole position, the vault lends the difference.",
  ladder:
    "Buy, borrow against it, and buy again with the loan. You pick what each round buys. Stops at the floor or when you say.",
};

const COL_VENUE = "hidden w-28 sm:block";
const COL_RATE = "w-20 text-right";
const COL_NET = "w-24 text-right";
const COL_LEV = "w-16 text-right";
const COL_CHEV = "w-6";

export function StrategiesPanel({
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
  const [openMint, setOpenMint] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("earn");

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
          Strategies
        </div>
        <h2 className="font-light text-2xl tracking-tight text-white">
          Buy an asset and put it to work in one go
        </h2>
        <p className="text-sm text-white/45">
          Every asset here can be borrowed against. Pick one, then pick what
          the loan does.
          {rates.bestEarn && (
            <>
              {" "}
              Borrowed USDC earns {fmtPct(rates.bestEarn.apy)} in{" "}
              {rates.bestEarn.label} right now.
            </>
          )}
        </p>
      </div>

      <div className={`${GLASS_SURFACE} p-5 text-white lg:p-6`}>
        <div className="flex items-center gap-3 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
          <div className="min-w-0 flex-1">Asset</div>
          <div className={COL_VENUE}>Venue</div>
          <div className={COL_RATE}>Borrow</div>
          <div className={COL_NET}>Buy + Earn</div>
          <div className={COL_LEV}>Max</div>
          <div className={COL_CHEV} />
        </div>

        {rates.rows.length === 0 && (
          <p className="py-6 text-sm text-white/50">
            {rates.loading ? "Loading markets…" : "No asset has a borrow market."}
          </p>
        )}

        <div className="divide-y divide-white/[0.06]">
          {rates.rows.map((row) => {
            const expanded = openMint === row.xstock.mint;
            return (
              <div key={row.xstock.mint}>
                <Row
                  row={row}
                  earnApy={rates.bestEarn?.apy ?? null}
                  runs={store.runs.filter((r) => r.mint === row.xstock.mint)}
                  expanded={expanded}
                  onToggle={() => setOpenMint(expanded ? null : row.xstock.mint)}
                />
                {expanded && (
                  <div className="border-t border-white/10 px-1 py-5">
                    <div className="mb-4 inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
                      {(Object.keys(STRATEGY_LABEL) as Strategy[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setStrategy(s)}
                          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                            strategy === s
                              ? "bg-white/10 text-white"
                              : "text-white/50 hover:text-white"
                          }`}
                        >
                          {STRATEGY_LABEL[s]}
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-6 lg:grid-cols-5">
                      <div className="space-y-3 lg:col-span-2">
                        <div className="text-sm text-white/60">
                          {STRATEGY_BLURB[strategy]}
                        </div>
                        <Mechanics row={row} strategy={strategy} />
                      </div>
                      <div className="lg:col-span-3">
                        {/* Keyed so switching asset or strategy mounts a fresh
                            ticket; a half-run ladder must not carry its rounds
                            over to another asset. */}
                        {strategy === "earn" ? (
                          <EarnTicket
                            key={`earn-${row.xstock.mint}`}
                            row={row}
                            earn={rates.bestEarn}
                            earnOptions={rates.earnOptions}
                            walletAddress={walletAddress}
                            balances={balances}
                            prices={prices}
                            store={store}
                            saved={pickRun(store.runs, "earn", row.xstock.mint)}
                            onRefresh={onRefresh}
                          />
                        ) : strategy === "leverage" ? (
                          <LeverageTicket
                            key={`lev-${row.xstock.mint}`}
                            row={row}
                            walletAddress={walletAddress}
                            balances={balances}
                            prices={prices}
                            store={store}
                            saved={pickRun(store.runs, "leverage", row.xstock.mint)}
                            onRefresh={onRefresh}
                          />
                        ) : (
                          <LadderTicket
                            key={`ladder-${row.xstock.mint}`}
                            row={row}
                            rows={rates.rows}
                            walletAddress={walletAddress}
                            balances={balances}
                            prices={prices}
                            store={store}
                            saved={pickRun(store.runs, "ladder", row.xstock.mint)}
                            onRefresh={onRefresh}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-white/40">
        xStocks are tokenized representations issued by Backed Finance. Holders
        do not have direct shareholder rights. Borrowing against them can be
        liquidated if the price falls past the venue&apos;s threshold.
      </p>
    </div>
  );
}

function Row({
  row,
  earnApy,
  runs,
  expanded,
  onToggle,
}: {
  row: StrategyRates;
  earnApy: number | null;
  // Saved runs on this asset, so the row can say a strategy is open or
  // waiting to be resumed before the user opens it.
  runs: StrategyRun[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const interrupted = runs.find((r) => r.status === "running");
  const open = runs.filter((r) => r.status === "done");
  const ratio = defaultBorrowRatio(row.route);
  const net =
    earnApy != null && row.borrowApr != null
      ? earnNetApy({
          borrowRatio: ratio,
          earnApy,
          borrowApr: row.borrowApr,
          collateralSupplyApy: row.collateralSupplyApy,
        })
      : null;
  const maxLev = maxLeverageForRoute(row.route);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`group flex w-full items-center gap-3 py-3 text-left text-sm transition-colors ${
        expanded ? "bg-white/[0.03]" : "hover:bg-white/5"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <AssetLogo xstock={row.xstock} size={32} />
        <div className="min-w-0">
          <div className="truncate font-medium tracking-tight text-white">
            {row.xstock.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45">
            {row.xstock.symbol}
            {interrupted ? (
              <span className="rounded bg-aeras-warning/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-aeras-warning">
                Resume {STRATEGY_NAME[interrupted.strategy]}
              </span>
            ) : (
              open.map((r) => (
                <span
                  key={r.id}
                  className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/70"
                >
                  {STRATEGY_NAME[r.strategy]} open
                </span>
              ))
            )}
          </div>
        </div>
      </div>
      <div className={`${COL_VENUE} text-xs text-white/60`}>{row.route.venueLabel}</div>
      <div className={`${COL_RATE} font-mono text-xs tabular-nums text-white`}>
        {fmtPct(row.borrowApr)}
      </div>
      <div
        className={`${COL_NET} font-mono text-xs tabular-nums ${
          net == null ? "text-white/40" : net > 0 ? "text-aeras-positive" : "text-aeras-warning"
        }`}
      >
        {net == null ? "—" : fmtSignedPct(net)}
      </div>
      <div className={`${COL_LEV} font-mono text-xs tabular-nums text-white`}>
        {maxLev.toFixed(1)}×
        {row.route.venue === "kamino" && (
          <span className="text-white/40" title="In steps, not one transaction">
            *
          </span>
        )}
      </div>
      <div className={COL_CHEV}>
        <ChevronDown
          className={`size-4 text-white/40 transition-transform group-hover:text-white/70 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </div>
    </button>
  );
}

// The numbers the selected strategy turns on for this asset, beside the
// ticket, so the user is not reading them off the row above.
function Mechanics({ row, strategy }: { row: StrategyRates; strategy: Strategy }) {
  const lines: [string, string][] = [
    ["Venue", row.route.venueLabel],
    ["Collateral factor", fmtPct(row.route.collateralFactor, 0)],
    ["Liquidation threshold", fmtPct(row.route.liquidationThreshold, 0)],
    ["USDC borrow rate", fmtPct(row.borrowApr)],
  ];
  if (strategy === "leverage") {
    lines.push([
      "Max leverage",
      `${maxLeverageForRoute(row.route).toFixed(1)}×${row.route.venue === "kamino" ? " in steps" : ""}`,
    ]);
  }
  if (row.liquidityUsd != null) {
    lines.push(["USDC left to lend", `$${Math.floor(row.liquidityUsd).toLocaleString()}`]);
  }
  return (
    <dl className="space-y-1.5 text-xs">
      {lines.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="text-white/50">{k}</dt>
          <dd className="font-mono tabular-nums text-white">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
