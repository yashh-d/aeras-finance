// Browser-side reads of the Ondo catalog, through our own proxy route. Mirrors
// lib/trustware/client.ts: nothing in the browser talks to Ondo directly.

import type { OndoCatalog } from "./markets";

export async function fetchOndoCatalog(): Promise<OndoCatalog> {
  const res = await fetch("/api/ondo/markets", { cache: "no-store" });
  const body = (await res.json()) as OndoCatalog & { error?: string };

  if (!res.ok) {
    throw new Error(body.error ?? `Ondo catalog failed: ${res.status}`);
  }
  return {
    environment: body.environment,
    markets: body.markets,
    collateral: body.collateral,
  };
}
