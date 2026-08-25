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

export async function fetchMorphoPositions(
  evmAddress: string,
): Promise<Map<string, MorphoPosition>> {
  const url = new URL("/api/morpho/position", window.location.origin);
  url.searchParams.set("address", evmAddress);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Morpho positions failed: ${res.status}`);
  const { positions } = (await res.json()) as { positions: MorphoPosition[] };
  return new Map(positions.map((p) => [p.address.toLowerCase(), p]));
}

export type { MorphoVaultMetric, MorphoPosition };
