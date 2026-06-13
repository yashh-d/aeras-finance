"use client";

// Earn surface. Three sub-products laid out per design.md "institutional lending
// terminal" feel: yield Vaults (Jupiter Lend Earn), Looping (recursive borrow
// against collateral), and direct Lend. All actions are scaffolded but disabled
// until each integration ships.

import { useState } from "react";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";

interface Props {
  prices: JupiterPriceMap | null;
}

export function EarnPanel({ prices }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader />
      <VaultsCard prices={prices} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LoopingCard />
        <DirectLendCard />
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
        Earn
      </div>
      <h2 className="font-light text-2xl tracking-tight text-aeras-900">
        Put idle capital to work
      </h2>
      <p className="text-sm text-aeras-300">
        Three ways to earn yield on assets you already hold — vault deposits,
        leveraged looping, and direct lending. Risk profile increases left to
        right.
      </p>
    </div>
  );
}

// ── Vaults ─────────────────────────────────────────────────────────────────

interface VaultRow {
  symbol: string;
  name: string;
  coingeckoId: string | null;
  apyPct: number;
  tvlUsd: number;
  // Where the deposit goes — surfacing the route in the row text builds trust.
  venue: "Jupiter Lend Earn";
  risk: "Low" | "Medium";
}

// Sourced from a live snapshot of https://api.jup.ag/lend/v1/borrow/vaults +
// https://api.jup.ag/lend/v1/earn/tokens (we read both during borrow research).
// Numbers will be wired to a fetch when we ship the deposit flow.
const STATIC_VAULTS: VaultRow[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    coingeckoId: "usd-coin",
    apyPct: 7.65,
    tvlUsd: 402_900_000,
    venue: "Jupiter Lend Earn",
    risk: "Low",
  },
  {
    symbol: "JupUSD",
    name: "Jupiter USD",
    coingeckoId: "jupusd",
    apyPct: 5.22,
    tvlUsd: 95_400_000,
    venue: "Jupiter Lend Earn",
    risk: "Low",
  },
  {
    symbol: "SOL",
    name: "Solana",
    coingeckoId: "wrapped-solana",
    apyPct: 4.01,
    tvlUsd: 353_000_000,
    venue: "Jupiter Lend Earn",
    risk: "Low",
  },
  {
    symbol: "USDS",
    name: "USDS",
    coingeckoId: null,
    apyPct: 4.58,
    tvlUsd: 12_300_000,
    venue: "Jupiter Lend Earn",
    risk: "Low",
  },
];

function VaultsCard({ prices }: Props) {
  void prices; // currently unused; reserved for live APY display
  return (
    <div className="rounded-2xl border border-aeras-border bg-white p-5 lg:p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            Vaults
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
            Deposit, hold, earn
          </div>
        </div>
        <span className="text-xs text-aeras-300">
          via <span className="text-aeras-blue">Jupiter Lend Earn</span>
        </span>
      </div>

      <div className="mt-5 divide-y divide-aeras-border">
        <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
          <div className="col-span-4">Asset</div>
          <div className="col-span-2 text-right">APY</div>
          <div className="col-span-3 text-right">TVL</div>
          <div className="col-span-1 text-right">Risk</div>
          <div className="col-span-2 text-right" />
        </div>
        {STATIC_VAULTS.map((v) => (
          <VaultRowView key={v.symbol} row={v} />
        ))}
      </div>
    </div>
  );
}

function VaultRowView({ row }: { row: VaultRow }) {
  return (
    <div className="grid grid-cols-12 items-center gap-2 py-2.5 text-sm">
      <div className="col-span-4">
        <div className="font-medium tracking-tight text-aeras-900">
          {row.symbol}
        </div>
        <div className="text-[11px] text-aeras-300">{row.name}</div>
      </div>
      <div className="col-span-2 text-right">
        <span className="font-mono tabular-nums text-aeras-positive">
          {row.apyPct.toFixed(2)}%
        </span>
      </div>
      <div className="col-span-3 text-right font-mono text-xs tabular-nums text-aeras-500">
        ${formatLargeUsd(row.tvlUsd)}
      </div>
      <div className="col-span-1 text-right text-[10px] uppercase tracking-wider text-aeras-300">
        {row.risk}
      </div>
      <div className="col-span-2 text-right">
        <button
          type="button"
          disabled
          className="rounded-lg border border-aeras-border bg-white px-3 py-1.5 text-xs font-medium text-aeras-300 disabled:cursor-not-allowed"
          title="Coming soon"
        >
          Deposit
        </button>
      </div>
    </div>
  );
}

// ── Looping ────────────────────────────────────────────────────────────────

function LoopingCard() {
  const [leverage, setLeverage] = useState(2);
  // Naive APY model. Real numbers will come from Kamino multiply / Jupiter
  // recursive borrow math once the integration lands.
  const baseDepositApy = 7.65; // USDC vault APY
  const borrowApr = 6.5; // approximate USDC borrow rate against TSLAx
  const projectedApy = baseDepositApy * leverage - borrowApr * (leverage - 1);
  const ltvAtLeverage = ((leverage - 1) / leverage) * 100;
  const risky = ltvAtLeverage >= 65;

  return (
    <div className="space-y-4 rounded-2xl border border-aeras-border bg-white p-5 lg:p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            Looping
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
            Leveraged yield
          </div>
        </div>
        <span className="rounded-md bg-aeras-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aeras-warning">
          Medium risk
        </span>
      </div>

      <p className="text-xs text-aeras-300">
        Deposit collateral, borrow USDC against it, redeposit, repeat. Compounds
        your yield up to the vault&apos;s collateral factor.
      </p>

      <div>
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="text-aeras-300">Target leverage</span>
          <span className="font-mono tabular-nums text-aeras-900">
            {leverage.toFixed(1)}×
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full accent-aeras-blue"
        />
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-aeras-300">
          <span>1×</span>
          <span>2×</span>
          <span>3×</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          label="Projected APY"
          value={`${projectedApy.toFixed(2)}%`}
          highlight
        />
        <Stat
          label="Final LTV"
          value={`${ltvAtLeverage.toFixed(1)}%`}
          warning={risky}
        />
      </div>

      <button
        type="button"
        disabled
        className="w-full rounded-xl border border-aeras-border bg-white px-4 py-2.5 text-sm font-medium text-aeras-300 disabled:cursor-not-allowed"
        title="Coming soon — needs Kamino multiply integration"
      >
        Open looped position
      </button>
    </div>
  );
}

// ── Direct lend ────────────────────────────────────────────────────────────

function DirectLendCard() {
  return (
    <div className="space-y-4 rounded-2xl border border-aeras-border bg-white p-5 lg:p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
            Lend
          </div>
          <div className="mt-1 text-sm font-medium tracking-tight text-aeras-900">
            Direct lending
          </div>
        </div>
        <span className="rounded-md bg-aeras-blue-wash px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aeras-blue">
          Low risk
        </span>
      </div>

      <p className="text-xs text-aeras-300">
        Lend stables and SOL to xStock borrowers. Variable rate tied to vault
        utilization. Withdraw at any time, subject to liquidity.
      </p>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat label="USDC supply APR" value="7.65%" highlight />
        <Stat label="Utilization" value="74%" />
        <Stat label="SOL supply APR" value="4.01%" />
        <Stat label="Total supplied" value="$402.9M" />
      </div>

      <button
        type="button"
        disabled
        className="w-full rounded-xl border border-aeras-border bg-white px-4 py-2.5 text-sm font-medium text-aeras-300 disabled:cursor-not-allowed"
        title="Coming soon — direct lend launches with Kamino integration"
      >
        Lend USDC or SOL
      </button>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  highlight,
  warning,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warning?: boolean;
}) {
  let valueClass = "font-mono tabular-nums text-sm text-aeras-900";
  if (highlight) valueClass = "font-mono tabular-nums text-sm text-aeras-positive";
  if (warning) valueClass = "font-mono tabular-nums text-sm text-aeras-warning";

  return (
    <div className="rounded-lg border border-aeras-border bg-aeras-surface px-3 py-2">
      <div className="text-[11px] text-aeras-300">{label}</div>
      <div className={`mt-0.5 ${valueClass}`}>{value}</div>
    </div>
  );
}

function formatLargeUsd(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
