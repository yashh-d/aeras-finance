"use client";

// The Strategies page. One row per asset with a borrow market, with the live
// numbers each strategy turns on: what it costs to borrow against, what the
// spread to the best USDC vault is, and how much leverage the venue allows.
// A row opens into the three strategy buttons and the chosen ticket, the same
// two pieces the Markets row expansion and the Home asset detail draw under
// their chart (components/strategies/AssetStrategies.tsx). See
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
  STRATEGY_NAME,
  useStrategyRuns,
  type StrategyKind,
  type StrategyRun,
} from "@/lib/strategies/runs-client";
import { GLASS_SURFACE } from "@/lib/ui/surface";

import { StrategyStrip, StrategyTicket } from "./AssetStrategies";
import { fmtPct, fmtSignedPct } from "./shared";

type Strategy = StrategyKind;

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
          the loan does. Every step signs automatically: one click runs the
          whole strategy.
          {rates.defaultEarn && (
            <>
              {" "}
              Borrowed USDC earns {fmtPct(rates.defaultEarn.apy)} in{" "}
              {rates.defaultEarn.label} right now.
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
                  earnApy={rates.defaultEarn?.apy ?? null}
                  runs={store.runs.filter((r) => r.mint === row.xstock.mint)}
                  expanded={expanded}
                  onToggle={() => setOpenMint(expanded ? null : row.xstock.mint)}
                />
                {expanded && (
                  // Capped in width: the ticket is a column of fields and a
                  // preview, and stretched across the whole card it read as a
                  // form with nothing on its right.
                  <div className="space-y-4 border-t border-white/10 px-1 py-5 lg:max-w-2xl">
                    <StrategyStrip
                      row={row}
                      earnApy={rates.defaultEarn?.apy ?? null}
                      runs={store.runs.filter((r) => r.mint === row.xstock.mint)}
                      selected={strategy}
                      // No market ticket here to return to, so pressing the
                      // chosen strategy again keeps it.
                      onSelect={(s) => s && setStrategy(s)}
                    />
                    <StrategyTicket
                      strategy={strategy}
                      row={row}
                      rates={rates}
                      store={store}
                      walletAddress={walletAddress}
                      balances={balances}
                      prices={prices}
                      onRefresh={onRefresh}
                    />
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
