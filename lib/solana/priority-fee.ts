import type { Connection } from "@solana/web3.js";

// Priority fee resolution, in micro-lamports per compute unit.
//
// Every transaction this app built used to go out at a compute unit price of
// zero, which puts it behind every fee-paying transaction in the leader's
// queue. On a quiet slot that still lands; during any congestion window it is
// dropped, and the user sees a confirmation timeout on a deposit that never
// existed. That was the production failure this module exists to close.
//
// getRecentPrioritizationFees is not a usable source on its own. Sampled on an
// uncongested slot it returns 150 zeros (verified 2026-08-26 against mainnet),
// so a naive median or p75 of the raw samples prices us right back at zero.
// Helius exposes a dedicated estimator that stays meaningful when the raw
// samples are flat -- the same slot that produced 150 zeros returned
// medium 9394 / high 180000 micro-lamports through it. Use the estimator when
// the RPC serves it and fall back to a percentile of the raw samples, then
// apply a floor either way.

// Never bid below this, even if every source says zero. At a 400k unit limit
// this is 4000 lamports, roughly $0.0006, which is worth paying to not be at
// the back of the queue.
const FLOOR_MICRO_LAMPORTS_PER_CU = 10_000;

// Never spend more than this on priority, whatever the estimator says. Helius
// will happily quote an `unsafeMax` in the tens of billions; a runaway bid on a
// routine deposit is a worse outcome than a retry.
export const MAX_PRIORITY_FEE_LAMPORTS = 2_000_000; // 0.002 SOL

const ESTIMATE_TIMEOUT_MS = 3000;

interface HeliusFeeLevels {
  min: number;
  low: number;
  medium: number;
  high: number;
  veryHigh: number;
  unsafeMax: number;
}

// Helius's getPriorityFeeEstimate. Returns null for any RPC that does not serve
// the method, which is the signal to fall back.
async function heliusEstimate(
  connection: Connection,
  accountKeys: string[],
): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ESTIMATE_TIMEOUT_MS);
  try {
    const res = await fetch(connection.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "priority-fee",
        method: "getPriorityFeeEstimate",
        params: [
          { accountKeys, options: { includeAllPriorityFeeLevels: true } },
        ],
      }),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      result?: { priorityFeeLevels?: HeliusFeeLevels };
      error?: unknown;
    };
    const levels = payload.result?.priorityFeeLevels;
    if (!levels || typeof levels.high !== "number") return null;
    // `high` rather than `medium`: a deposit that has to be re-signed costs the
    // user more in friction than the few thousand lamports of difference.
    return Math.round(levels.high);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// p75 of the non-zero recent samples for the accounts this transaction writes.
async function recentFeesEstimate(
  connection: Connection,
  accountKeys: string[],
): Promise<number> {
  try {
    const { PublicKey } = await import("@solana/web3.js");
    const samples = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: accountKeys
        .slice(0, 128)
        .map((k) => new PublicKey(k)),
    });
    const nonZero = samples
      .map((s) => s.prioritizationFee)
      .filter((f) => f > 0)
      .sort((a, b) => a - b);
    if (nonZero.length === 0) return 0;
    return nonZero[Math.floor(nonZero.length * 0.75)] ?? 0;
  } catch {
    return 0;
  }
}

// Resolve the compute unit price to bid, clamped so the resulting priority fee
// stays inside MAX_PRIORITY_FEE_LAMPORTS at the given unit limit. Solana charges
// the priority fee on the REQUESTED limit, not on units consumed, so the limit
// is part of the price and has to be passed in here.
export async function resolvePriorityFee(
  connection: Connection,
  {
    accountKeys,
    computeUnitLimit,
  }: { accountKeys: string[]; computeUnitLimit: number },
): Promise<number> {
  const estimate =
    (await heliusEstimate(connection, accountKeys)) ??
    (await recentFeesEstimate(connection, accountKeys));

  const bid = Math.max(FLOOR_MICRO_LAMPORTS_PER_CU, estimate);
  const ceiling = Math.floor(
    (MAX_PRIORITY_FEE_LAMPORTS * 1_000_000) / computeUnitLimit,
  );
  return Math.min(bid, ceiling);
}
