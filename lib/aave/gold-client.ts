"use client";

import type { AaveGoldMarketMetric } from "@/app/api/aave/gold-market/route";
import type { AaveGoldPosition } from "@/app/api/aave/gold-position/route";

// Browser-side readers for the Aave V4 Gold spoke. Both go through our own API
// routes, so no Ethereum RPC is called from the client and the RPC URL stays
// server-side.

export const AAVE_GOLD_POSITION_ROUTE = "/api/aave/gold-position";

export async function fetchAaveGoldMarkets(): Promise<
  Map<string, AaveGoldMarketMetric>
> {
  const res = await fetch("/api/aave/gold-market", { cache: "no-store" });
  if (!res.ok) throw new Error(`Aave gold market metrics failed: ${res.status}`);
  const { metrics } = (await res.json()) as { metrics: AaveGoldMarketMetric[] };
  return new Map(metrics.map((m) => [m.id, m]));
}

export interface AaveGoldPositionsResult {
  // Keyed by market id.
  positions: Map<string, AaveGoldPosition>;
  // Ethereum wallet balances, atomic.
  collateralBalanceAtomic: string;
  loanBalanceAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
}

export async function fetchAaveGoldPositions(
  evmAddress: string,
): Promise<AaveGoldPositionsResult> {
  const url = new URL(AAVE_GOLD_POSITION_ROUTE, window.location.origin);
  url.searchParams.set("address", evmAddress);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Aave gold positions failed: ${res.status}`);
  const body = (await res.json()) as {
    positions: AaveGoldPosition[];
    collateralBalanceAtomic?: string;
    loanBalanceAtomic?: string;
    ethBalanceAtomic?: string;
    gasPriceWei?: string;
  };
  return {
    positions: new Map(body.positions.map((p) => [p.id, p])),
    collateralBalanceAtomic: body.collateralBalanceAtomic ?? "0",
    loanBalanceAtomic: body.loanBalanceAtomic ?? "0",
    ethBalanceAtomic: body.ethBalanceAtomic ?? "0",
    gasPriceWei: body.gasPriceWei ?? "0",
  };
}

export type { AaveGoldMarketMetric, AaveGoldPosition };
