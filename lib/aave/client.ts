"use client";

import type { AaveVaultMetric } from "@/app/api/aave/metrics/route";
import type { AavePosition, AaveWalletRead } from "@/app/api/aave/position/route";

// Browser-side readers for the Aave venue. Both go through our own API routes,
// so no Ethereum RPC is called from the client and the RPC URL stays
// server-side.

export async function fetchAaveMetrics(): Promise<Map<string, AaveVaultMetric>> {
  const res = await fetch("/api/aave/metrics", { cache: "no-store" });
  if (!res.ok) throw new Error(`Aave metrics failed: ${res.status}`);
  const { metrics } = (await res.json()) as { metrics: AaveVaultMetric[] };
  return new Map(metrics.map((m) => [m.address.toLowerCase(), m]));
}

export interface AavePositionsResult extends Omit<AaveWalletRead, "positions"> {
  // Keyed by lowercased vault address.
  positions: Map<string, AavePosition>;
}

export async function fetchAavePositions(
  evmAddress: string,
): Promise<AavePositionsResult> {
  const url = new URL("/api/aave/position", window.location.origin);
  url.searchParams.set("address", evmAddress);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Aave positions failed: ${res.status}`);
  const body = (await res.json()) as AaveWalletRead;
  return {
    ...body,
    positions: new Map(body.positions.map((p) => [p.address.toLowerCase(), p])),
  };
}

export type { AaveVaultMetric, AavePosition, AaveWalletRead };
