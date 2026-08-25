import { NextResponse } from "next/server";

import { MORPHO_BLUE_API_URL, MONAD_CHAIN_ID } from "@/lib/morpho/constants";
import { MONAD_USDC_VAULTS } from "@/lib/morpho/vaults";

export const dynamic = "force-dynamic";

// Live net APY and TVL for the curated Monad USDC vaults, from Morpho's indexer.
// netApy is the compounded rate the depositor earns, rewards included and curator
// fee deducted, matching what Morpho's own UI shows.
export interface MorphoVaultMetric {
  address: string;
  // Net supply APY as a decimal (0.05 = 5%). Null if the indexer omits it.
  netApy: number | null;
  // 7-day average net APY, a steadier figure than the spot rate for a young,
  // low-TVL vault. Null if unavailable.
  weeklyNetApy: number | null;
  // Total assets in the vault, USD.
  tvlUsd: number | null;
}

interface RawItem {
  address: string;
  state: {
    netApy?: number | null;
    weeklyNetApy?: number | null;
    totalAssetsUsd?: number | null;
  } | null;
}

const QUERY = `query Vaults($addresses: [String!]!, $chainId: Int!) {
  vaults(first: 50, where: { address_in: $addresses, chainId_in: [$chainId] }) {
    items { address state { netApy weeklyNetApy totalAssetsUsd } }
  }
}`;

let cache: { fetchedAt: number; metrics: MorphoVaultMetric[] } | null = null;
const CACHE_TTL_MS = 60_000;
const STALE_GRACE_MS = 5 * 60 * 1000;

async function fetchUpstream(): Promise<MorphoVaultMetric[]> {
  const res = await fetch(MORPHO_BLUE_API_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        addresses: MONAD_USDC_VAULTS.map((v) => v.address),
        chainId: MONAD_CHAIN_ID,
      },
    }),
  });
  if (!res.ok) throw new Error(`Morpho indexer ${res.status}`);
  const json = (await res.json()) as {
    errors?: { message: string }[];
    data?: { vaults?: { items?: RawItem[] } };
  };
  if (json.errors?.length) {
    throw new Error(`Morpho indexer: ${json.errors[0].message}`);
  }
  const items = json.data?.vaults?.items ?? [];
  const byAddress = new Map(items.map((i) => [i.address.toLowerCase(), i]));
  // Return one entry per curated vault so a vault missing upstream still renders
  // (as nulls) rather than silently dropping out of the list.
  return MONAD_USDC_VAULTS.map((v) => {
    const s = byAddress.get(v.address.toLowerCase())?.state ?? null;
    return {
      address: v.address,
      netApy: s?.netApy ?? null,
      weeklyNetApy: s?.weeklyNetApy ?? null,
      tvlUsd: s?.totalAssetsUsd ?? null,
    };
  });
}

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ metrics: cache.metrics });
  }
  try {
    const metrics = await fetchUpstream();
    cache = { fetchedAt: Date.now(), metrics };
    return NextResponse.json({ metrics });
  } catch (err) {
    // Stale-while-error, matching the Jupiter borrow proxy: keep serving the last
    // good payload through a transient indexer blip instead of blanking the UI.
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[morpho metrics] upstream failed, serving stale:", err);
      return NextResponse.json({ metrics: cache.metrics });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
