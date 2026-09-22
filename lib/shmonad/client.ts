"use client";

// Browser-side readers for the shMON venue. Everything goes through our own
// API routes so no Monad RPC is called from the client. The MON price comes
// from the native price route the wallet scan already polls.

import type { ShmonMetrics } from "@/app/api/shmonad/metrics/route";
import type { ShmonPosition } from "@/app/api/shmonad/position/route";

export type { ShmonMetrics, ShmonPosition };

export async function fetchShmonMetrics(): Promise<ShmonMetrics> {
  const res = await fetch("/api/shmonad/metrics", { cache: "no-store" });
  if (!res.ok) throw new Error(`shMON metrics failed: ${res.status}`);
  return (await res.json()) as ShmonMetrics;
}

export async function fetchShmonPosition(evmAddress: string): Promise<ShmonPosition> {
  const url = new URL("/api/shmonad/position", window.location.origin);
  url.searchParams.set("address", evmAddress);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`shMON position failed: ${res.status}`);
  return (await res.json()) as ShmonPosition;
}

// USD per MON, from /api/prices/native (Coingecko id "monad"). Null when the
// route has nothing, which every caller treats as "no dollar figure" rather
// than zero.
export async function fetchMonUsd(): Promise<number | null> {
  try {
    const res = await fetch("/api/prices/native", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, number>;
    const p = body.monad;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}
