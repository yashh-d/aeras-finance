import { NextResponse } from "next/server";

import {
  KAMINO_EARN_VAULTS,
  RATIO_PRECISION,
  decimalToScaled,
  type KaminoVaultState,
} from "@/lib/kamino/kvaults";

export const dynamic = "force-dynamic";

// Rate and size metrics for the curated K-Vault set. Proxied for the same
// reasons as the reserve metrics: a stable User-Agent (Kamino 403s some
// clients), no CORS, and a payload trimmed to what the Earn rows render.
//
// Kamino has no batch metrics endpoint, so this fans out one request per vault.
// With five vaults that is fine, and the cache means the browser's 60s poll
// costs Kamino nothing most of the time.
const DATA_BASE = "https://api.kamino.finance/kvaults/vaults";
const UPSTREAM_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30_000;

interface RawMetrics {
  apy?: string;
  apyIncentives?: string;
  apyReservesIncentives?: string;
  tokensInvestedUsd?: string;
  tokensAvailableUsd?: string;
  sharePrice?: string;
  tokensPerShare?: string;
  numberOfHolders?: number;
}

let cache: { at: number; data: KaminoVaultState[] } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ vaults: cache.data });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const settled = await Promise.allSettled(
      KAMINO_EARN_VAULTS.map(async (vault) => {
        const res = await fetch(`${DATA_BASE}/${vault.address}/metrics`, {
          cache: "no-store",
          signal: controller.signal,
          headers: { "user-agent": "aeras-finance/0.1" },
        });
        if (!res.ok) {
          throw new Error(`${vault.name}: ${res.status}`);
        }
        const raw = (await res.json()) as RawMetrics;
        const state: KaminoVaultState = {
          address: vault.address,
          tokenMint: vault.tokenMint,
          apy: Number(raw.apy ?? 0),
          incentivesApy:
            Number(raw.apyIncentives ?? 0) +
            Number(raw.apyReservesIncentives ?? 0),
          // TVL is the deployed capital plus whatever is sitting idle in the
          // vault between rebalances. Reporting only the invested half would
          // understate a vault that just took a large deposit.
          tvlUsd:
            Number(raw.tokensInvestedUsd ?? 0) +
            Number(raw.tokensAvailableUsd ?? 0),
          sharePriceUsd: Number(raw.sharePrice ?? 0),
          tokensPerShareScaled: decimalToScaled(
            raw.tokensPerShare ?? "1",
            RATIO_PRECISION,
          ),
          holders: Number(raw.numberOfHolders ?? 0),
        };
        return state;
      }),
    );
    clearTimeout(timeout);

    const data = settled
      .filter(
        (r): r is PromiseFulfilledResult<KaminoVaultState> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);

    // One vault failing should not blank the other four, but zero succeeding
    // means the upstream is down and stale data beats an empty table.
    if (data.length === 0) {
      if (cache) return NextResponse.json({ vaults: cache.data });
      return NextResponse.json(
        { error: "Kamino vault metrics unavailable" },
        { status: 502 },
      );
    }

    cache = { at: Date.now(), data };
    return NextResponse.json({ vaults: data });
  } catch (err) {
    clearTimeout(timeout);
    if (cache) return NextResponse.json({ vaults: cache.data });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
