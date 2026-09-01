"use client";

// Home's "what am I in" card, directly under the wallet's Fund, Receive and
// Send actions.
//
// Everything above it on Home is what the account HOLDS: balances, then assets
// to buy. This is what the account has DONE with those holdings, and until it
// existed the only way to find out was to open each of the four tabs in turn and
// read each venue's own summary.
//
// It is a summary, not a fifth control surface. There is no close, repay or
// withdraw here: every row's group header opens the tab that owns the position,
// where the figures are in that product's own terms and the actions live. The
// four groups deliberately do not add up to one number, because a debt, a
// deposit and a short notional are not the same kind of dollar; each group
// states what its own total means instead.

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { AssetLogo, VenueMark } from "@/components/AssetLogo";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import {
  usePositions,
  type PositionGroup,
  type PositionKind,
  type PositionRow,
} from "@/lib/positions/use-positions";
import type { AccountBalances } from "@/lib/solana/balances";
import { INSET_PANEL } from "@/lib/ui/surface";

const LABEL =
  "text-[10px] font-medium uppercase tracking-[0.12em] text-white/50";

const TONE_CLASS: Record<PositionRow["tone"], string> = {
  neutral: "text-white/50",
  positive: "text-aeras-positive",
  negative: "text-aeras-negative",
  warning: "text-aeras-warning",
};

export function PositionsCard({
  walletAddress,
  evmAddress,
  balances,
  prices,
  onOpen,
}: {
  walletAddress: string | undefined;
  evmAddress: string | undefined;
  balances: AccountBalances | null;
  prices: JupiterPriceMap | null;
  // Opens the tab that owns a group. Home routes this to its section state.
  onOpen: (kind: PositionKind) => void;
}) {
  const { groups, count, loading, refresh } = usePositions({
    walletAddress,
    evmAddress,
    balances,
    prices,
  });
  const [refreshing, setRefreshing] = useState(false);

  const open = groups.filter((g) => g.rows.length > 0);

  // Its own control rather than a ride on the wallet card's Refresh: the wallet
  // reads balances across chains, this reads six venues, and a user who has just
  // borrowed or closed a hedge wants the one they changed.
  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex w-full items-baseline justify-between">
        <div className={LABEL}>
          Positions
          {count > 0 && (
            <span className="ml-2 font-mono text-white/60 normal-case tracking-normal">
              · {count}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <div className={`${INSET_PANEL} px-3.5 py-6 text-center text-xs text-white/50`}>
          Reading your positions…
        </div>
      ) : open.length === 0 ? (
        <div className={`${INSET_PANEL} space-y-1 px-3.5 py-5 text-center`}>
          <p className="text-xs text-white/60">No open positions</p>
          <p className="text-[11px] text-white/40">
            Borrows, deposits, hedges and perps you open show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {open.map((group) => (
            <Group key={group.kind} group={group} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function Group({
  group,
  onOpen,
}: {
  group: PositionGroup;
  onOpen: (kind: PositionKind) => void;
}) {
  return (
    <div className={INSET_PANEL}>
      {/* The whole header is the control, matching how a Markets row opens. */}
      <button
        type="button"
        onClick={() => onOpen(group.kind)}
        className="flex w-full items-baseline justify-between gap-2 rounded-t-xl px-3.5 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span className="flex items-baseline gap-1.5">
          <span className="text-xs font-medium tracking-tight text-white">
            {group.label}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-white/40">
            {group.rows.length}
          </span>
        </span>
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-xs tabular-nums text-white">
            ${group.totalUsd.toFixed(2)}
          </span>
          <span className="text-[10px] text-white/40">{group.totalLabel}</span>
          <ChevronRight
            className="size-3 shrink-0 translate-y-[2px] text-white/30"
            aria-hidden="true"
          />
        </span>
      </button>

      <div className="border-t border-white/[0.07]">
        {group.rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}

function Row({ row }: { row: PositionRow }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <AssetLogo
          xstock={row.asset ?? { symbol: row.symbol, name: row.symbol }}
          size={26}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium tracking-tight text-white">
            {row.symbol}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            {row.venueLogo && <VenueMark src={row.venueLogo} size={11} />}
            <span className="truncate">
              {row.venue} · {row.detail}
            </span>
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-sm tabular-nums text-white">
          ${row.usd.toFixed(2)}
        </div>
        {row.note && (
          <div
            className={`font-mono text-[11px] tabular-nums ${TONE_CLASS[row.tone]}`}
          >
            {row.note}
          </div>
        )}
      </div>
    </div>
  );
}
