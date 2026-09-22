// The strategy view the Markets card reads: composition, the boost campaign,
// live figures and performance, composed from Glider's two APIs and cached.
//
// Works without GLIDER_API_KEY. Every figure on the card comes from the
// keyless reads; the key adds one thing, a cross-check of the live B2B
// allocation against the registry in constants.ts, and it is the enrollment
// side that cannot run without it. `keyConfigured` tells the ticket which.

import "server-only";

import { dedupe } from "@/lib/upstream";

import {
  GLIDER_STRATEGY_ID,
  GLIDER_STRATEGY_NAME,
  MAG7X_HOLDINGS,
  MAG7X_STRATEGY_FEE,
  type Mag7xHolding,
} from "./constants";
import {
  baseErc20FromAssetId,
  fetchBoost,
  fetchPublicBlueprint,
  fetchPublicPerformance,
  fetchPublicStats,
  fetchStrategy,
  gliderKeyConfigured,
} from "./server";
import type { GliderStrategyView } from "./types";

const TTL_MS = 60_000;
const STALE_MAX_MS = 30 * 60_000;

let cache: { view: GliderStrategyView; fetchedAt: number } | null = null;

async function settled<T>(work: Promise<T>, label: string, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (err) {
    console.error(`[glider strategy] ${label}`, err);
    return fallback;
  }
}

// The registry, reordered and reweighted to match a live allocation when one
// is available. A contract the registry does not know is logged and dropped
// rather than shown without a name or a price: the check script is what
// catches that, and it fails loudly.
function holdingsFrom(
  live: { contract: string; weight: number }[] | null,
): Mag7xHolding[] {
  if (!live || live.length === 0) return [...MAG7X_HOLDINGS];
  const out: Mag7xHolding[] = [];
  for (const entry of live) {
    const known = MAG7X_HOLDINGS.find((h) => h.contract === entry.contract);
    if (!known) {
      console.warn(`[glider strategy] unknown holding ${entry.contract}; registry needs updating`);
      continue;
    }
    out.push({ ...known, weight: entry.weight });
  }
  return out.length > 0 ? out : [...MAG7X_HOLDINGS];
}

async function build(): Promise<GliderStrategyView> {
  const keyConfigured = gliderKeyConfigured();
  const [blueprint, boost, stats, performance, b2b] = await Promise.all([
    settled(fetchPublicBlueprint(), "blueprint", null),
    settled(fetchBoost(), "boost", null),
    settled(fetchPublicStats(), "stats", { tvlUsd: null, users: null, portfolios: null }),
    settled(fetchPublicPerformance(), "performance", { live: null, backtestExcludingSpacex: null }),
    keyConfigured ? settled(fetchStrategy(), "b2b strategy", null) : Promise.resolve(null),
  ]);

  // Prefer the B2B allocation (the partner contract), then the public
  // blueprint, then the registry.
  let live: { contract: string; weight: number }[] | null = null;
  if (b2b && b2b.allocation.length > 0) {
    live = [];
    for (const a of b2b.allocation) {
      const contract = baseErc20FromAssetId(a.assetId);
      const weight = Number(a.weight);
      if (contract && Number.isFinite(weight)) live.push({ contract, weight: weight / 100 });
    }
  } else if (blueprint && blueprint.allocation.length > 0) {
    live = blueprint.allocation;
  }

  return {
    strategyId: GLIDER_STRATEGY_ID,
    name: b2b?.name || blueprint?.name || GLIDER_STRATEGY_NAME,
    description: b2b?.description || blueprint?.description || "",
    holdings: holdingsFrom(live),
    boost,
    fee: MAG7X_STRATEGY_FEE,
    tvlUsd: stats.tvlUsd,
    users: stats.users,
    portfolios: stats.portfolios,
    live: performance.live,
    backtestExcludingSpacex: performance.backtestExcludingSpacex,
    rebalance:
      blueprint?.rebalanceIntervalMs != null
        ? {
            intervalMs: blueprint.rebalanceIntervalMs,
            driftTriggerPct: blueprint.driftTriggerPct ?? 0,
          }
        : null,
    keyConfigured,
    fetchedAt: new Date().toISOString(),
  };
}

export async function loadStrategy(): Promise<{ view: GliderStrategyView; stale: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return { view: cache.view, stale: false };
  }
  try {
    const view = await dedupe("glider-strategy", build);
    cache = { view, fetchedAt: Date.now() };
    return { view, stale: false };
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < TTL_MS + STALE_MAX_MS) {
      console.warn("[glider strategy] serving stale:", err);
      return { view: cache.view, stale: true };
    }
    throw err;
  }
}
