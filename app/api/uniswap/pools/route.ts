import { NextResponse } from "next/server";

import { POOLS_CACHE_TTL_MS, POOLS_STALE_GRACE_MS, type UniswapChainId, type UniswapProtocol } from "@/lib/uniswap/constants";
import { baseUsdFromPool, priceToken1PerToken0 } from "@/lib/uniswap/math";
import { feeAprs, readPoolVolumes, volumeKey, type VolumeSource } from "@/lib/uniswap/metrics";
import { UNISWAP_POOLS } from "@/lib/uniswap/pools";
import { poolStateKey, pricesFromStates, readPoolStates } from "@/lib/uniswap/server";
import { dedupe } from "@/lib/upstream";

export const dynamic = "force-dynamic";

// Every listed pool's figures: TVL and volume from Uniswap's indexer (or
// GeckoTerminal), the fee APR they imply, and the price and liquidity from
// the chain. One cached body for the whole registry, stale-served through an
// upstream failure with `x-aeras-stale: 1`, matching app/api/jupiter/prices.
// See docs/uniswap-lp-plan.md D13.

export interface UniswapPoolMetric {
  id: string;
  chainId: UniswapChainId;
  protocol: UniswapProtocol;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  volume7dUsd: number | null;
  feeApr24h: number | null;
  feeApr7d: number | null;
  source: VolumeSource;
  // From the chain. Null when the chain did not answer.
  sqrtPriceX96: string | null;
  tick: number | null;
  liquidity: string | null;
  // token1 per token0, and dollars per the non-dollar side (null when the
  // pool has none or the chain did not answer).
  price: number | null;
  baseUsd: number | null;
}

export interface UniswapPoolsPayload {
  pools: UniswapPoolMetric[];
  // USD per registry token, keyed `${chainId}:${address lowercased}`.
  prices: Record<string, number>;
  readAt: number;
}

let cache: { fetchedAt: number; body: UniswapPoolsPayload } | null = null;

async function build(): Promise<UniswapPoolsPayload> {
  const [volumes, states] = await Promise.all([readPoolVolumes(), readPoolStates()]);
  if (states.size === 0) throw new Error("No chain answered the pool state read.");
  const prices = pricesFromStates(states);
  const pools = UNISWAP_POOLS.map((p): UniswapPoolMetric => {
    const v = volumes.get(volumeKey(p));
    const s = states.get(poolStateKey(p));
    return {
      id: p.id,
      chainId: p.chainId,
      protocol: p.protocol,
      tvlUsd: v?.tvlUsd ?? null,
      volume24hUsd: v?.volume24hUsd ?? null,
      volume7dUsd: v?.volume7dUsd ?? null,
      ...feeAprs(p, v),
      source: v?.source ?? "none",
      sqrtPriceX96: s ? s.sqrtPriceX96.toString() : null,
      tick: s ? s.tick : null,
      liquidity: s ? s.liquidity.toString() : null,
      price: s ? priceToken1PerToken0(s.sqrtPriceX96, p.token0.decimals, p.token1.decimals) : null,
      baseUsd: s ? baseUsdFromPool(p, s.sqrtPriceX96) : null,
    };
  });
  return { pools, prices: Object.fromEntries(prices), readAt: Date.now() };
}

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < POOLS_CACHE_TTL_MS) {
    return NextResponse.json(cache.body);
  }
  try {
    const body = await dedupe("uniswap-pools", build);
    cache = { fetchedAt: Date.now(), body };
    return NextResponse.json(body);
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < POOLS_CACHE_TTL_MS + POOLS_STALE_GRACE_MS) {
      console.warn("[uniswap pools] read failed, serving stale:", err instanceof Error ? err.message : err);
      return NextResponse.json(cache.body, { headers: { "x-aeras-stale": "1" } });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
