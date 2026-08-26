"use client";

import type { MorphoVaultMetric } from "@/app/api/morpho/metrics/route";
import type { MorphoPosition } from "@/app/api/morpho/position/route";

// Browser-side readers for the Morpho earn data. Both go through our own API
// routes (indexer for metrics, Monad RPC for positions) so no third-party
// endpoint or RPC is called from the client directly.

export async function fetchMorphoMetrics(): Promise<
  Map<string, MorphoVaultMetric>
> {
  const res = await fetch("/api/morpho/metrics", { cache: "no-store" });
  if (!res.ok) throw new Error(`Morpho metrics failed: ${res.status}`);
  const { metrics } = (await res.json()) as { metrics: MorphoVaultMetric[] };
  return new Map(metrics.map((m) => [m.address.toLowerCase(), m]));
}

export interface MorphoPositionsResult {
  // Keyed by lowercased vault address.
  positions: Map<string, MorphoPosition>;
  // The wallet's spendable USDC on Monad, 6-decimal atomic.
  usdcBalanceAtomic: string;
  // Native MON for gas, 18-decimal atomic.
  monBalanceAtomic: string;
}

export async function fetchMorphoPositions(
  evmAddress: string,
): Promise<MorphoPositionsResult> {
  const url = new URL("/api/morpho/position", window.location.origin);
  url.searchParams.set("address", evmAddress);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Morpho positions failed: ${res.status}`);
  const { positions, usdcBalanceAtomic, monBalanceAtomic } =
    (await res.json()) as {
      positions: MorphoPosition[];
      usdcBalanceAtomic: string;
      monBalanceAtomic?: string;
    };
  return {
    positions: new Map(positions.map((p) => [p.address.toLowerCase(), p])),
    usdcBalanceAtomic: usdcBalanceAtomic ?? "0",
    monBalanceAtomic: monBalanceAtomic ?? "0",
  };
}

export type { MorphoVaultMetric, MorphoPosition };
