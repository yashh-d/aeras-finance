"use client";

import type { GoldMarketMetric } from "@/app/api/morpho/gold-market/route";
import type { GoldPosition } from "@/app/api/morpho/gold-position/route";

// Browser-side readers for the Morpho Blue gold market. Both go through our own
// API routes, so no Ethereum RPC is called from the client and the RPC URL
// stays server-side.

export async function fetchGoldMarkets(): Promise<Map<string, GoldMarketMetric>> {
  const res = await fetch("/api/morpho/gold-market", { cache: "no-store" });
  if (!res.ok) throw new Error(`Gold market metrics failed: ${res.status}`);
  const { metrics } = (await res.json()) as { metrics: GoldMarketMetric[] };
  return new Map(metrics.map((m) => [m.id.toLowerCase(), m]));
}

export interface GoldPositionsResult {
  // Keyed by lowercased market id.
  positions: Map<string, GoldPosition>;
  // Ethereum wallet balances, atomic.
  collateralBalanceAtomic: string;
  loanBalanceAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
}

export async function fetchGoldPositions(
  evmAddress: string,
): Promise<GoldPositionsResult> {
  const url = new URL("/api/morpho/gold-position", window.location.origin);
  url.searchParams.set("address", evmAddress);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Gold positions failed: ${res.status}`);
  const body = (await res.json()) as {
    positions: GoldPosition[];
    collateralBalanceAtomic?: string;
    loanBalanceAtomic?: string;
    ethBalanceAtomic?: string;
    gasPriceWei?: string;
  };
  return {
    positions: new Map(body.positions.map((p) => [p.id.toLowerCase(), p])),
    collateralBalanceAtomic: body.collateralBalanceAtomic ?? "0",
    loanBalanceAtomic: body.loanBalanceAtomic ?? "0",
    ethBalanceAtomic: body.ethBalanceAtomic ?? "0",
    gasPriceWei: body.gasPriceWei ?? "0",
  };
}

export type { GoldMarketMetric, GoldPosition };
