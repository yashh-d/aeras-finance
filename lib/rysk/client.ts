// Browser-side read of the Rysk option chain, through our own proxy route.
// Mirrors lib/lighter/client.ts. Rysk sends no CORS headers, so this cannot be
// pointed at their API directly.

import type { RyskCatalog } from "./types";

export async function fetchRyskCatalog(): Promise<RyskCatalog> {
  const res = await fetch("/api/rysk/chain", { cache: "no-store" });
  const body = (await res.json()) as RyskCatalog & { error?: string };

  if (!res.ok) {
    throw new Error(body.error ?? `Rysk catalog failed: ${res.status}`);
  }
  return { underlyings: body.underlyings, fetchedAt: body.fetchedAt };
}
