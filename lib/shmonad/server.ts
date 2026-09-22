// Server-only Monad reads for the shMON venue: the live rate, the APY derived
// from share price growth, the instant-exit pool, and a wallet's position
// with its queued-exit state.
//
// Kept to plain batched JSON-RPC POSTs rather than a viem public client,
// matching app/api/morpho/position/route.ts: these are reads, and an
// app-owned EVM provider is a bigger commitment than the job needs. Batched
// because the public node rate-limits per request and a full read is a dozen
// calls.
//
// Two endpoints on purpose. Live state comes from MONAD_RPC_URL (the paid
// endpoint). The historical share price the APY needs comes from
// MONAD_HISTORY_RPC_URL, which defaults to the public node: measured
// 2026-09-22, the paid endpoint serves about a day of history and the public
// one about a week, and a seven-day window is the steadier rate.

import "server-only";

import {
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
} from "viem";

import { jsonRpcBatchSettled, type RpcEndpoints } from "@/lib/ethereum/json-rpc";
import { MONAD_PUBLIC_RPC_URL, MONAD_RPC_URL } from "@/lib/morpho/constants";

import { SHMON_ABI } from "./abi";
import {
  APY_FALLBACK_WINDOW_SECONDS,
  APY_WINDOW_SECONDS,
  MONAD_BLOCK_SECONDS_APPROX,
  MONAD_HISTORY_RPC_URL,
  SHMON_ADDRESS,
} from "./constants";
import { apyFromGrowth, feeRateFromRay, rateMonPerShare } from "./math";

const ONE = 10n ** 18n;

// ── JSON-RPC ─────────────────────────────────────────────────────────────

interface RpcCall {
  method: string;
  params: unknown[];
}

interface RpcOutcome {
  result?: Hex | Record<string, unknown> | null;
  error?: string;
}

// The live endpoint falls back to the public node when the paid one is
// throttled or down (lib/ethereum/json-rpc.ts has the measurements). The
// history endpoint gets no fallback: it already is the public node, and the
// paid one does not hold the blocks a week back that the read is for.
function monadEndpoints(url: string): RpcEndpoints {
  return {
    label: "Monad",
    url,
    fallbackUrl:
      url === MONAD_RPC_URL && url !== MONAD_PUBLIC_RPC_URL ? MONAD_PUBLIC_RPC_URL : undefined,
  };
}

// One batched round trip; each call settles on its own so a revert (which is
// an answer for the completeUnstake probe) does not fail the batch.
async function rpcBatchSettled(url: string, calls: RpcCall[]): Promise<RpcOutcome[]> {
  const outcomes = await jsonRpcBatchSettled(monadEndpoints(url), calls);
  return outcomes.map((o) => ({
    result: o.result as Hex | Record<string, unknown> | null | undefined,
    error: o.error,
  }));
}

// Strict variant: every call must answer with a hex result.
async function rpcBatch(url: string, calls: RpcCall[]): Promise<Hex[]> {
  const outcomes = await rpcBatchSettled(url, calls);
  return outcomes.map((o, i) => {
    if (o.error) throw new Error(`Monad RPC call ${i} (${calls[i].method}): ${o.error}`);
    if (typeof o.result !== "string" || o.result === "0x") {
      throw new Error(`Monad RPC call ${i} (${calls[i].method}): empty result`);
    }
    return o.result;
  });
}

type FnName = (typeof SHMON_ABI)[number]["name"];

function call(functionName: FnName, args: unknown[] = [], block = "latest"): RpcCall {
  const data = encodeFunctionData({
    abi: SHMON_ABI,
    functionName,
    args: args as never,
  } as never);
  return { method: "eth_call", params: [{ to: SHMON_ADDRESS, data }, block] };
}

function decode<T>(functionName: FnName, data: Hex): T {
  return decodeFunctionResult({ abi: SHMON_ABI, functionName, data } as never) as T;
}

function blockTs(block: Record<string, unknown> | null | undefined): number {
  if (!block || typeof block.timestamp !== "string") throw new Error("Monad RPC: block not found");
  return parseInt(block.timestamp, 16);
}

// ── metrics ──────────────────────────────────────────────────────────────

export interface ShmonMetrics {
  address: string;
  // MON per shMON, a float for display.
  rateMonPerShare: number;
  // convertToAssets(1e18) and previewDeposit(1e18), atomic, for bigint sizing
  // on the client. Strings because they are BigInts.
  rateAtomic: string;
  sharesPerMonAtomic: string;
  // Annualised from share price growth over `windowHours`. Null when neither
  // history window could be read.
  apy: number | null;
  apr: number | null;
  windowHours: number | null;
  // True when the one-day fallback served the rate instead of the week.
  windowStale: boolean;
  // Whole-vault figures, in MON and shMON as floats.
  tvlMon: number;
  totalShares: number;
  // Instant-exit pool: the fee as a decimal, its cap, and the pool in MON.
  feeRate: number;
  feeCap: number;
  poolAvailableMon: number;
  poolAllocatedMon: number;
  poolAvailableAtomic: string;
  // Fraction of the pool already drawn.
  utilization: number;
  internalEpoch: number;
  // FastLane's cut of staking rewards, as a decimal.
  stakingCommission: number;
  readAt: number;
}

interface Growth {
  apy: number;
  apr: number;
  windowHours: number;
}

// Share price now against a window ago, on the history endpoint so both
// reads come from one node. Null when the window's block is not served.
async function readGrowth(windowSeconds: number): Promise<Growth | null> {
  const url = MONAD_HISTORY_RPC_URL;
  try {
    const [latestHex, latestBlock] = await rpcBatchSettled(url, [
      { method: "eth_blockNumber", params: [] },
      { method: "eth_getBlockByNumber", params: ["latest", false] },
    ]);
    if (typeof latestHex.result !== "string") return null;
    const latest = parseInt(latestHex.result, 16);
    const nowTs = blockTs(latestBlock.result as Record<string, unknown> | null);
    const guess = latest - Math.round(windowSeconds / MONAD_BLOCK_SECONDS_APPROX);
    const block = `0x${guess.toString(16)}`;
    const [then, thenBlock, now] = await rpcBatchSettled(url, [
      call("convertToAssets", [ONE], block),
      { method: "eth_getBlockByNumber", params: [block, false] },
      call("convertToAssets", [ONE]),
    ]);
    if (typeof then.result !== "string" || typeof now.result !== "string") return null;
    const dt = nowTs - blockTs(thenBlock.result as Record<string, unknown> | null);
    const r = apyFromGrowth(
      decode<bigint>("convertToAssets", then.result),
      decode<bigint>("convertToAssets", now.result),
      dt,
    );
    if (!r) return null;
    return { apy: r.apy, apr: r.apr, windowHours: dt / 3600 };
  } catch {
    return null;
  }
}

export async function readShmonMetrics(): Promise<ShmonMetrics> {
  const [rate, sharesPerMon, totalAssets, totalSupply, feeRay, curve, pool, epoch, admin] =
    await rpcBatch(MONAD_RPC_URL, [
      call("convertToAssets", [ONE]),
      call("previewDeposit", [ONE]),
      call("totalAssets"),
      call("totalSupply"),
      call("getCurrentUnstakeFeeRateRay"),
      call("getFeeCurveParams"),
      call("getAtomicPoolUtilization"),
      call("getInternalEpoch"),
      call("getAdminValues"),
    ]);
  const rateAtomic = decode<bigint>("convertToAssets", rate);
  const [slope, intercept] = decode<readonly [bigint, bigint]>("getFeeCurveParams", curve);
  const [, allocated, available, utilizationWad] =
    decode<readonly [bigint, bigint, bigint, bigint]>("getAtomicPoolUtilization", pool);
  const adminValues = decode<readonly [bigint, number, number, number, number, bigint]>(
    "getAdminValues",
    admin,
  );

  // The week first, the day as the fallback. Read in sequence so a served
  // week costs one history round trip, not two.
  const growth =
    (await readGrowth(APY_WINDOW_SECONDS)) ??
    (await readGrowth(APY_FALLBACK_WINDOW_SECONDS));

  return {
    address: SHMON_ADDRESS,
    rateMonPerShare: rateMonPerShare(rateAtomic),
    rateAtomic: rateAtomic.toString(),
    sharesPerMonAtomic: decode<bigint>("previewDeposit", sharesPerMon).toString(),
    apy: growth?.apy ?? null,
    apr: growth?.apr ?? null,
    windowHours: growth?.windowHours ?? null,
    // The day fallback served, not the week. Judged at half the week so a
    // week window that lands a little short still counts as the week.
    windowStale: growth != null && growth.windowHours < APY_WINDOW_SECONDS / 3600 / 2,
    tvlMon: Number(decode<bigint>("totalAssets", totalAssets)) / 1e18,
    totalShares: Number(decode<bigint>("totalSupply", totalSupply)) / 1e18,
    feeRate: feeRateFromRay(decode<bigint>("getCurrentUnstakeFeeRateRay", feeRay)),
    feeCap: feeRateFromRay(slope + intercept),
    poolAvailableMon: Number(available) / 1e18,
    poolAllocatedMon: Number(allocated) / 1e18,
    poolAvailableAtomic: available.toString(),
    utilization: Number(utilizationWad) / 1e18,
    internalEpoch: Number(decode<bigint>("getInternalEpoch", epoch)),
    stakingCommission: Number(adminValues[3]) / 10_000,
    readAt: Date.now(),
  };
}

// ── position ─────────────────────────────────────────────────────────────

export interface ShmonPosition {
  address: string;
  // shMON held, 18-decimal atomic.
  sharesAtomic: string;
  // convertToAssets(shares): what the shares are worth in MON, before either
  // exit's pricing. 18-decimal atomic.
  monAtomic: string;
  // What an instant exit of the whole position pays now, and its fee.
  instantNetMonAtomic: string;
  instantFeeMonAtomic: string;
  // What a queued exit of the whole position would lock in now.
  queuedMonAtomic: string;
  // Native MON in the wallet (gas, and anything unstaked).
  walletMonAtomic: string;
  // The one outstanding queued exit, or null.
  pending: { amountMonAtomic: string; completionEpoch: string } | null;
  // True when completeUnstake() would succeed from this address right now,
  // decided by simulating it. See docs/shmonad-plan.md D6.
  ready: boolean;
  poolAvailableMonAtomic: string;
  feeRate: number;
  rateAtomic: string;
  sharesPerMonAtomic: string;
}

export async function readShmonPosition(address: string): Promise<ShmonPosition> {
  const owner = address as `0x${string}`;
  const [shares, walletMon, request, pool, feeRay, rate, sharesPerMon] = await rpcBatch(
    MONAD_RPC_URL,
    [
      call("balanceOf", [owner]),
      { method: "eth_getBalance", params: [address, "latest"] },
      call("getUnstakeRequest", [owner]),
      call("getAtomicPoolUtilization"),
      call("getCurrentUnstakeFeeRateRay"),
      call("convertToAssets", [ONE]),
      call("previewDeposit", [ONE]),
    ],
  );
  const sharesAtomic = decode<bigint>("balanceOf", shares);
  const [amountMon, completionEpoch] = decode<readonly [bigint, bigint]>("getUnstakeRequest", request);
  const [, , available] = decode<readonly [bigint, bigint, bigint, bigint]>(
    "getAtomicPoolUtilization",
    pool,
  );

  let monAtomic = 0n;
  let instantNet = 0n;
  let instantFee = 0n;
  let queued = 0n;
  let ready = false;

  const second: RpcCall[] = [];
  if (sharesAtomic > 0n) {
    second.push(
      call("convertToAssets", [sharesAtomic]),
      call("previewRedeemDetailed", [sharesAtomic]),
      call("previewUnstake", [sharesAtomic]),
    );
  }
  if (amountMon > 0n) {
    second.push({
      method: "eth_call",
      params: [
        {
          from: address,
          to: SHMON_ADDRESS,
          data: encodeFunctionData({ abi: SHMON_ABI, functionName: "completeUnstake" }),
        },
        "latest",
      ],
    });
  }
  if (second.length > 0) {
    const outcomes = await rpcBatchSettled(MONAD_RPC_URL, second);
    let i = 0;
    if (sharesAtomic > 0n) {
      const [a, b, c] = outcomes.slice(i, i + 3);
      i += 3;
      if (typeof a.result !== "string" || typeof b.result !== "string" || typeof c.result !== "string") {
        throw new Error("Monad RPC: position previews failed");
      }
      monAtomic = decode<bigint>("convertToAssets", a.result);
      const [, fee, net] = decode<readonly [bigint, bigint, bigint]>("previewRedeemDetailed", b.result);
      instantFee = fee;
      instantNet = net;
      queued = decode<bigint>("previewUnstake", c.result);
    }
    if (amountMon > 0n) {
      // A revert is the answer "not yet"; a result means the completion
      // would go through.
      ready = !outcomes[i].error;
    }
  }

  return {
    address,
    sharesAtomic: sharesAtomic.toString(),
    monAtomic: monAtomic.toString(),
    instantNetMonAtomic: instantNet.toString(),
    instantFeeMonAtomic: instantFee.toString(),
    queuedMonAtomic: queued.toString(),
    walletMonAtomic: BigInt(walletMon).toString(),
    pending:
      amountMon > 0n
        ? { amountMonAtomic: amountMon.toString(), completionEpoch: completionEpoch.toString() }
        : null,
    ready,
    poolAvailableMonAtomic: available.toString(),
    feeRate: feeRateFromRay(decode<bigint>("getCurrentUnstakeFeeRateRay", feeRay)),
    rateAtomic: decode<bigint>("convertToAssets", rate).toString(),
    sharesPerMonAtomic: decode<bigint>("previewDeposit", sharesPerMon).toString(),
  };
}
