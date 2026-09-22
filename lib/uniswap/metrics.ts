// Server-only TVL and volume for the registry's pools, and the fee APR they
// imply. Uniswap's interface GraphQL first (one request for all twelve),
// GeckoTerminal per pool for whatever that left blank, and nothing where both
// fail: the card then shows the chain's price and liquidity and a dash for
// the rate rather than a stale or invented figure.
//
// Both sources are keyless and rate-limited, so both go through the circuit
// in lib/upstream.ts under their own keys. Caching and the stale-serve path
// are the pools route's business (app/api/uniswap/pools).

import "server-only";

import { fetchUpstreamJson } from "@/lib/upstream";

import {
  GECKOTERMINAL_API_BASE_URL,
  UNISWAP_GRAPHQL_ORIGIN,
  UNISWAP_GRAPHQL_URL,
  type UniswapChainId,
} from "./constants";
import { feeApr } from "./math";
import { UNISWAP_POOLS, type UniswapPool } from "./pools";

export type VolumeSource = "uniswap" | "geckoterminal" | "none";

export interface PoolVolume {
  tvlUsd: number | null;
  volume24hUsd: number | null;
  volume7dUsd: number | null;
  source: VolumeSource;
}

const GRAPHQL_CHAIN: Readonly<Record<UniswapChainId, string>> = {
  1: "ETHEREUM",
  143: "MONAD",
  4663: "ROBINHOOD",
  8453: "BASE",
};

const GECKO_NETWORK: Readonly<Record<UniswapChainId, string>> = {
  1: "eth",
  143: "monad",
  4663: "robinhood",
  8453: "base",
};

export function volumeKey(pool: UniswapPool): string {
  return `${pool.chainId}:${pool.id.toLowerCase()}`;
}

interface GraphqlPool {
  totalLiquidity?: { value?: number } | null;
  day?: { value?: number } | null;
  week?: { value?: number } | null;
}

function num(v: number | undefined | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function readGraphql(pools: readonly UniswapPool[]): Promise<Map<string, PoolVolume>> {
  const parts = pools.map((p, i) =>
    p.protocol === "V3"
      ? `p${i}: v3Pool(chain: ${GRAPHQL_CHAIN[p.chainId]}, address: "${p.id}") { totalLiquidity { value } day: cumulativeVolume(duration: DAY) { value } week: cumulativeVolume(duration: WEEK) { value } }`
      : `p${i}: v4Pool(chain: ${GRAPHQL_CHAIN[p.chainId]}, poolId: "${p.id}") { totalLiquidity { value } day: cumulativeVolume(duration: DAY) { value } week: cumulativeVolume(duration: WEEK) { value } }`,
  );
  const body = await fetchUpstreamJson<{ data?: Record<string, GraphqlPool | null> }>({
    key: "uniswap-graphql",
    url: UNISWAP_GRAPHQL_URL,
    label: "Uniswap GraphQL",
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: UNISWAP_GRAPHQL_ORIGIN,
      referer: `${UNISWAP_GRAPHQL_ORIGIN}/`,
    },
    body: JSON.stringify({ query: `query { ${parts.join(" ")} }` }),
    timeoutMs: 8_000,
  });
  const out = new Map<string, PoolVolume>();
  pools.forEach((p, i) => {
    const d = body.data?.[`p${i}`];
    if (!d) return;
    out.set(volumeKey(p), {
      tvlUsd: num(d.totalLiquidity?.value),
      volume24hUsd: num(d.day?.value),
      volume7dUsd: num(d.week?.value),
      source: "uniswap",
    });
  });
  return out;
}

async function readGecko(pool: UniswapPool): Promise<PoolVolume> {
  const body = await fetchUpstreamJson<{
    data?: { attributes?: { reserve_in_usd?: string; volume_usd?: { h24?: string } } };
  }>({
    key: "geckoterminal",
    url: `${GECKOTERMINAL_API_BASE_URL}/networks/${GECKO_NETWORK[pool.chainId]}/pools/${pool.id.toLowerCase()}`,
    label: "GeckoTerminal",
    headers: { accept: "application/json" },
    timeoutMs: 6_000,
  });
  const a = body.data?.attributes;
  return {
    tvlUsd: num(Number(a?.reserve_in_usd)),
    volume24hUsd: num(Number(a?.volume_usd?.h24)),
    volume7dUsd: null,
    source: "geckoterminal",
  };
}

// TVL and volumes for every pool, keyed by volumeKey. Never throws: a pool
// neither source could serve is present with `source: "none"`.
export async function readPoolVolumes(
  pools: readonly UniswapPool[] = UNISWAP_POOLS,
): Promise<Map<string, PoolVolume>> {
  let out = new Map<string, PoolVolume>();
  try {
    out = await readGraphql(pools);
  } catch (err) {
    console.warn("[uniswap metrics] GraphQL failed:", err instanceof Error ? err.message : err);
  }
  for (const p of pools) {
    const key = volumeKey(p);
    if (out.get(key)?.tvlUsd != null) continue;
    try {
      out.set(key, await readGecko(p));
    } catch (err) {
      console.warn(`[uniswap metrics] GeckoTerminal failed for ${p.label}:`, err instanceof Error ? err.message : err);
      out.set(key, { tvlUsd: null, volume24hUsd: null, volume7dUsd: null, source: "none" });
    }
  }
  return out;
}

export function feeAprs(pool: UniswapPool, v: PoolVolume | undefined): { feeApr24h: number | null; feeApr7d: number | null } {
  if (!v || v.tvlUsd == null) return { feeApr24h: null, feeApr7d: null };
  return {
    feeApr24h: v.volume24hUsd == null ? null : feeApr(v.volume24hUsd, pool.fee, v.tvlUsd, 1),
    feeApr7d: v.volume7dUsd == null ? null : feeApr(v.volume7dUsd, pool.fee, v.tvlUsd, 7),
  };
}
