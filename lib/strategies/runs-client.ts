"use client";

// Browser half of the strategy run store. Pairs with lib/strategy-runs.ts and
// app/api/strategies/runs.
//
// The server is the source of truth. localStorage is a first-paint hint and
// a fallback when the server is unreachable, because a run that is mid-way
// through its signatures must not vanish from the page because a request
// failed. Where the two disagree the server wins.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import type { EarnVenue } from "./rates";
import type { StepStatus } from "./run";

export type StrategyKind = "earn" | "leverage" | "ladder";
export type RunStatus = "running" | "done";

export interface StepSnapshot {
  id: string;
  label: string;
  status: StepStatus;
  signatures: string[];
}

export interface BoughtSnapshot {
  // Wallet balance of the asset before the buy, atomic, as a decimal string.
  // Lets a resume tell whether an interrupted buy landed.
  beforeAtomic: string;
  boughtAtomic?: string;
  boughtUi?: number;
  signature?: string;
}

export interface EarnRunData {
  kind: "earn";
  amountUsd: number;
  ratio: number;
  earnVenue: EarnVenue;
  earnLabel: string;
  bought?: BoughtSnapshot;
  borrowedUsd?: number;
}

export interface LeverageRunData {
  kind: "leverage";
  equityUsd: number;
  leverage: number;
  borrowUsd: number;
}

export interface LadderRound {
  mint: string;
  buyUsd: number;
  boughtUi: number;
  boughtAtomic: string;
  borrowedUsd: number;
}

export interface LadderRunData {
  kind: "ladder";
  equityUsd: number;
  ratio: number;
  rounds: LadderRound[];
  pendingUsd: number;
  phase: "running" | "prompt" | "done";
  // The round whose steps are on screen. Present while a round is landing.
  inFlight?: { mint: string; usd: number; bought?: BoughtSnapshot };
}

export type RunData = EarnRunData | LeverageRunData | LadderRunData;

export interface StrategyRun {
  id: string;
  strategy: StrategyKind;
  mint: string;
  status: RunStatus;
  steps: StepSnapshot[];
  data: RunData;
  openedAt: string;
  updatedAt: string;
}

export function newRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers. Format matches what the route validates.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function cacheKey(walletAddress: string): string {
  return `aeras:strategy-runs:${walletAddress}`;
}

function readCache(walletAddress: string): StrategyRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(cacheKey(walletAddress));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StrategyRun[]) : [];
  } catch {
    return [];
  }
}

function writeCache(walletAddress: string, runs: StrategyRun[]): void {
  try {
    localStorage.setItem(cacheKey(walletAddress), JSON.stringify(runs));
  } catch {}
}

type Token = () => Promise<string | null>;

async function call(
  getAccessToken: Token,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch("/api/strategies/runs", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string })?.error ?? `Request failed (${res.status}).`,
    );
  }
  return data;
}

interface ServerRun {
  id: string;
  strategy: StrategyKind;
  mint: string;
  status: RunStatus;
  state: { steps?: StepSnapshot[]; data?: RunData };
  openedAt: string;
  updatedAt: string;
}

function fromServer(r: ServerRun): StrategyRun | null {
  if (!r.state?.data) return null;
  return {
    id: r.id,
    strategy: r.strategy,
    mint: r.mint,
    status: r.status,
    steps: r.state.steps ?? [],
    data: r.state.data,
    openedAt: r.openedAt,
    updatedAt: r.updatedAt,
  };
}

export interface StrategyRunsStore {
  runs: StrategyRun[];
  loading: boolean;
  // Insert or replace by id, locally at once and on the server best-effort.
  save: (run: StrategyRun) => void;
  remove: (id: string) => void;
  refresh: () => Promise<void>;
}

export function useStrategyRuns(walletAddress: string | undefined): StrategyRunsStore {
  const { getAccessToken } = usePrivy();
  const [runs, setRuns] = useState<StrategyRun[]>(() =>
    walletAddress ? readCache(walletAddress) : [],
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const data = (await call(getAccessToken, "GET")) as { runs?: ServerRun[] };
      const next = (data.runs ?? [])
        .map(fromServer)
        .filter((r): r is StrategyRun => r != null);
      setRuns(next);
      writeCache(walletAddress, next);
    } catch {
      // Keep whatever the cache had. The server wins only when it answers.
    } finally {
      setLoading(false);
    }
  }, [walletAddress, getAccessToken]);

  useEffect(() => {
    // Deferred a tick so the state writes land in a callback rather than in
    // the effect body, which is what the lint rule on effects asks for.
    const id = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(id);
  }, [refresh]);

  const save = useCallback(
    (run: StrategyRun) => {
      if (!walletAddress) return;
      setRuns((prev) => {
        const next = [run, ...prev.filter((r) => r.id !== run.id)];
        writeCache(walletAddress, next);
        return next;
      });
      call(getAccessToken, "POST", {
        id: run.id,
        strategy: run.strategy,
        mint: run.mint,
        status: run.status,
        state: { steps: run.steps, data: run.data },
      }).catch(() => {
        // The cache carries it until the next successful save or load.
      });
    },
    [walletAddress, getAccessToken],
  );

  const remove = useCallback(
    (id: string) => {
      if (!walletAddress) return;
      setRuns((prev) => {
        const next = prev.filter((r) => r.id !== id);
        writeCache(walletAddress, next);
        return next;
      });
      call(getAccessToken, "DELETE", { id }).catch(() => {});
    },
    [walletAddress, getAccessToken],
  );

  return useMemo(
    () => ({ runs, loading, save, remove, refresh }),
    [runs, loading, save, remove, refresh],
  );
}

// The one run that matters for a ticket: a run of this strategy on this asset
// that is still going, else the most recent finished one, else none.
export function pickRun(
  runs: StrategyRun[],
  strategy: StrategyKind,
  mint: string,
): StrategyRun | null {
  const mine = runs.filter((r) => r.strategy === strategy && r.mint === mint);
  return mine.find((r) => r.status === "running") ?? mine[0] ?? null;
}

export const STRATEGY_NAME: Record<StrategyKind, string> = {
  earn: "Buy + Earn",
  leverage: "Buy + Leverage",
  ladder: "Buy + Buy more",
};
