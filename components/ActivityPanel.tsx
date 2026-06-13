"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SOLSCAN_TX_BASE } from "@/lib/jupiter/constants";
import {
  fetchRecentActivity,
  type ActivityEntry,
  type ActivityKind,
} from "@/lib/solana/activity";
import { getConnection } from "@/lib/solana/balances";

// Slow background poll: each refresh fans out into getSignaturesForAddress plus
// per-tx parsing for the page, which is what tripped the RPC's 413 "Too many
// requests". The feed isn't latency-critical, so 2 minutes is plenty.
const POLL_MS = 120_000;
const PAGE_SIZE = 25;

export function ActivityPanel({ walletAddress }: { walletAddress: string }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const epochRef = useRef(0);

  const refresh = useCallback(async () => {
    const myEpoch = ++epochRef.current;
    setRefreshing(true);
    try {
      const next = await fetchRecentActivity(
        walletAddress,
        getConnection(),
        PAGE_SIZE,
      );
      if (epochRef.current !== myEpoch) return;
      setEntries(next);
      setError(null);
    } catch (err) {
      if (epochRef.current !== myEpoch) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error("[ActivityPanel]", err);
    } finally {
      if (epochRef.current === myEpoch) setRefreshing(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    epochRef.current++;
    setEntries(null);
    setError(null);
  }, [walletAddress]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-aeras-300">
              Activity
            </div>
            <h2 className="font-light text-2xl tracking-tight text-aeras-900">
              Recent on-chain activity
            </h2>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            disabled={refreshing}
            className="text-xs text-aeras-300 underline-offset-2 hover:text-aeras-900 hover:underline disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="text-sm text-aeras-300">
          Latest {PAGE_SIZE} signatures for your wallet. Reads from the same RPC
          as your balances. Use the Solscan link to see the full transaction.
        </p>
      </div>

      <div className="rounded-2xl border border-aeras-border bg-white">
        {error && (
          <div className="border-b border-aeras-border bg-aeras-surface px-5 py-3 text-xs text-aeras-500">
            Activity fetch interrupted. {error}
          </div>
        )}
        {entries == null ? (
          <div className="px-5 py-10 text-center text-sm text-aeras-300">
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-aeras-300">
            No transactions yet for this wallet.
          </div>
        ) : (
          <ul className="divide-y divide-aeras-border">
            {entries.map((e) => (
              <ActivityRow key={e.signature} entry={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const { kind, deltas, signature, blockTime, succeeded } = entry;
  const label = KIND_LABEL[kind];
  return (
    <li className="grid grid-cols-12 items-center gap-3 px-5 py-3.5">
      <div className="col-span-1">
        <KindIcon kind={kind} succeeded={succeeded} />
      </div>
      <div className="col-span-4 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium tracking-tight text-aeras-900">
            {label}
          </span>
          {!succeeded && (
            <span className="rounded-md bg-aeras-surface px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-aeras-negative">
              Failed
            </span>
          )}
        </div>
        <div className="font-mono text-[11px] text-aeras-300 truncate">
          {signature.slice(0, 8)}…{signature.slice(-6)}
        </div>
      </div>
      <div className="col-span-5 text-right">
        <DeltaList deltas={deltas} />
      </div>
      <div className="col-span-2 text-right">
        <div className="text-xs text-aeras-300">{formatTime(blockTime)}</div>
        <a
          href={`${SOLSCAN_TX_BASE}${signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-aeras-blue underline-offset-2 hover:underline"
        >
          Solscan ↗
        </a>
      </div>
    </li>
  );
}

function DeltaList({ deltas }: { deltas: ActivityEntry["deltas"] }) {
  if (deltas.length === 0) {
    return <span className="font-mono text-[11px] text-aeras-300">—</span>;
  }
  return (
    <div className="space-y-0.5">
      {deltas.slice(0, 3).map((d) => {
        const positive = d.deltaUi > 0;
        return (
          <div
            key={d.mint}
            className={`font-mono text-sm tabular-nums ${
              positive ? "text-aeras-positive" : "text-aeras-negative"
            }`}
          >
            {positive ? "+" : ""}
            {formatAmount(d.deltaUi)} {d.symbol}
          </div>
        );
      })}
      {deltas.length > 3 && (
        <div className="text-[11px] text-aeras-300">
          +{deltas.length - 3} more
        </div>
      )}
    </div>
  );
}

function KindIcon({
  kind,
  succeeded,
}: {
  kind: ActivityKind;
  succeeded: boolean;
}) {
  const bg = succeeded
    ? KIND_STYLE[kind].bg
    : "bg-aeras-surface text-aeras-300";
  return (
    <span
      className={`inline-flex size-7 items-center justify-center rounded-full text-xs font-medium ${bg}`}
      aria-hidden="true"
    >
      {KIND_STYLE[kind].glyph}
    </span>
  );
}

const KIND_LABEL: Record<ActivityKind, string> = {
  swap: "Swap",
  send: "Send",
  receive: "Receive",
  borrow: "Borrow op",
  other: "Transaction",
};

const KIND_STYLE: Record<ActivityKind, { bg: string; glyph: string }> = {
  swap: { bg: "bg-aeras-blue-wash text-aeras-blue", glyph: "⇄" },
  send: { bg: "bg-aeras-surface text-aeras-negative", glyph: "↑" },
  receive: { bg: "bg-aeras-surface text-aeras-positive", glyph: "↓" },
  borrow: { bg: "bg-aeras-blue-wash text-aeras-blue", glyph: "$" },
  other: { bg: "bg-aeras-surface text-aeras-500", glyph: "•" },
};

function formatAmount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatTime(blockTime: number | null): string {
  if (blockTime == null) return "—";
  const ms = blockTime * 1000;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
