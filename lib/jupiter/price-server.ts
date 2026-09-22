// Server-only fetch for Jupiter's price API, behind app/api/jupiter/prices.
// Imported only from the route handler, never from client code, because it
// reads JUPITER_API_KEY.
//
// This is the single most load-bearing read in the app. One poll feeds every
// USD figure on screen at once: the Markets rows, the Assets tiles, the
// portfolio total, and the ticket. When it fails they all blank together,
// which is exactly what happened to the Lend panels on 2026-09-09 before
// lib/jupiter/lend-server.ts was written. This route had none of that
// treatment, so it gets it here.
//
// Two changes from what it replaced. It calls `api.jup.ag` with the API key
// rather than `lite-api.jup.ag` keyless: Jupiter is retiring the lite host,
// and keyless traffic is limited to 0.5 requests a second against 1 for the
// free keyed tier. And it goes through the circuit in lib/upstream.ts, so a
// slow origin costs one 6-second wait per cooldown rather than one per poll.
// Verified 2026-09-14 that both hosts return identical payloads, the keyed one
// slightly faster (96ms against 126ms).

import "server-only";

import { fetchUpstreamJson, dedupe } from "@/lib/upstream";

// The payload types live in ./prices, which carries no server-only import,
// because twenty-odd client components type-import JupiterPriceMap from there.
import type { JupiterPriceMap } from "./prices";

const PRICE_BASE = "https://api.jup.ag/price/v3";
// The lite host stays as the fallback for a deployment with no key configured,
// so a missing JUPITER_API_KEY degrades to the old behaviour rather than to no
// prices at all.
const PRICE_BASE_KEYLESS = "https://lite-api.jup.ag/price/v3";

// One circuit for the endpoint. Deliberately not keyed by the mint list: the
// list is fixed per deployment, and a circuit keyed by a URL that varies never
// opens twice for the same thing and so protects nothing.
const CIRCUIT_KEY = "jupiter:price/v3";

export async function fetchJupiterPrices(
  mints: readonly string[],
): Promise<JupiterPriceMap> {
  if (mints.length === 0) return {};

  const key = process.env.JUPITER_API_KEY;
  const base = key ? PRICE_BASE : PRICE_BASE_KEYLESS;
  const url = `${base}?ids=${mints.join(",")}`;

  // Concurrent requests for the same mint set share one upstream call. On a
  // per-second rate limit two panels mounting together would otherwise spend
  // two of the budget for one payload.
  return dedupe(`${CIRCUIT_KEY}:${mints.length}`, () =>
    fetchUpstreamJson<JupiterPriceMap>({
      key: CIRCUIT_KEY,
      url,
      label: "Jupiter prices",
      headers: key
        ? { "x-api-key": key, "user-agent": "aeras-finance/0.1" }
        : { "user-agent": "aeras-finance/0.1" },
    }),
  );
}

export { circuitCooldownMs } from "@/lib/upstream";
export const PRICE_CIRCUIT_KEY = CIRCUIT_KEY;
