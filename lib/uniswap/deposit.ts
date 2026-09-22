"use client";

// Mint a liquidity position from tokens already in the embedded EVM wallet,
// signed on the pool's chain. The calldata comes from Uniswap's LP API
// through our proxy (docs/uniswap-lp-plan.md D5); this module sizes the
// request, grants the approvals the API asks for, sends, waits, and records
// the position off the receipt (D8).
//
// Sizing: the API takes one independent amount and computes the other. The
// side worth less is offered first, at the wallet's holding less a margin;
// if the computed dependent amount exceeds the other holding, the other side
// is offered instead. Two calls at most, no wasted funds, and any remainder
// stays in the wallet.

import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";

import type { EvmSigner, MorphoTxProgress } from "@/lib/morpho/deposit";
import { connectChain, waitForReceipt } from "@/lib/ethereum/tx";
import { buildEvmTxParams } from "@/lib/trustware/evm-tx";

import { V3_POOL_ABI, V4_STATE_VIEW_ABI } from "./abi";
import { callLpProxy, recordUniswapPosition, type LpProxyTransaction } from "./client";
import { BAND_BPS, MINT_MARGIN_BPS, UNISWAP_CONTRACTS } from "./constants";
import { atomicToFloat, bandTicks, tokenUsdKey } from "./math";
import { UNISWAP_CHAINS, type PoolToken, type UniswapChainId, type UniswapPool } from "./pools";

type Report = (p: MorphoTxProgress) => void;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
// Receipt waits per chain: sub-second blocks everywhere but Ethereum.
const RECEIPT_OPTS: Record<number, { timeoutMs: number; pollMs: number }> = {
  1: { timeoutMs: 10 * 60_000, pollMs: 4_000 },
};
const FAST_RECEIPT = { timeoutMs: 3 * 60_000, pollMs: 1_500 };
const RECORD_ATTEMPTS = 8;
const RECORD_DELAY_MS = 2_000;

function isNative(t: PoolToken): boolean {
  return Boolean(t.native) || t.address.toLowerCase() === ZERO_ADDRESS;
}

export async function sendLpTransaction(
  provider: Awaited<ReturnType<EvmSigner["getProvider"]>>,
  tx: LpProxyTransaction,
  from: string,
): Promise<string> {
  return (await provider.request({
    method: "eth_sendTransaction",
    params: [buildEvmTxParams(tx, from)],
  })) as string;
}

export function receiptOpts(chainId: UniswapChainId) {
  return { label: UNISWAP_CHAINS[chainId].label, ...(RECEIPT_OPTS[chainId] ?? FAST_RECEIPT) };
}

// The pool's current tick, read through the wallet's own provider so the
// band is built on the block the mint will land near, not on a cached
// figure.
async function readTick(provider: Awaited<ReturnType<EvmSigner["getProvider"]>>, pool: UniswapPool): Promise<number> {
  const c = UNISWAP_CONTRACTS[pool.chainId];
  const call =
    pool.protocol === "V3"
      ? { to: pool.id, data: encodeFunctionData({ abi: V3_POOL_ABI, functionName: "slot0" }) }
      : { to: c.v4StateView, data: encodeFunctionData({ abi: V4_STATE_VIEW_ABI, functionName: "getSlot0", args: [pool.id as Hex] }) };
  const hex = (await provider.request({ method: "eth_call", params: [call, "latest"] })) as Hex;
  if (pool.protocol === "V3") {
    return decodeFunctionResult({ abi: V3_POOL_ABI, functionName: "slot0", data: hex })[1];
  }
  return decodeFunctionResult({ abi: V4_STATE_VIEW_ABI, functionName: "getSlot0", data: hex })[1];
}

// ── pending mints ─────────────────────────────────────────────────────────
//
// A mint that landed while the record call failed would leave a v4 position
// invisible to the app (D8), so the hash is written here before the send and
// removed once the row exists. lib/uniswap/use-uniswap.ts reconciles on load.

const PENDING_KEY = "aeras.uniswap.pending";

interface PendingMint {
  chainId: UniswapChainId;
  txHash: string;
}

function pendingKey(address: string): string {
  return `${PENDING_KEY}.${address.toLowerCase()}`;
}

export function readPendingMints(address: string): PendingMint[] {
  try {
    const raw = window.localStorage.getItem(pendingKey(address));
    return raw ? (JSON.parse(raw) as PendingMint[]) : [];
  } catch {
    return [];
  }
}

function writePendingMints(address: string, list: PendingMint[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(pendingKey(address));
    else window.localStorage.setItem(pendingKey(address), JSON.stringify(list));
  } catch {
    // Storage unavailable; the record call is still attempted right away.
  }
}

function addPending(address: string, entry: PendingMint): void {
  writePendingMints(address, [...readPendingMints(address).filter((p) => p.txHash !== entry.txHash), entry]);
}

function removePending(address: string, txHash: string): void {
  writePendingMints(address, readPendingMints(address).filter((p) => p.txHash !== txHash));
}

// Record every pending mint that has mined. Returns true when a row was
// written, so the caller can refresh.
export async function reconcilePendingMints(address: string): Promise<boolean> {
  let wrote = false;
  for (const p of readPendingMints(address)) {
    try {
      const done = await recordUniswapPosition(p.chainId, p.txHash);
      if (done) {
        removePending(address, p.txHash);
        wrote = true;
      }
    } catch (err) {
      // A definitive answer (failed, or no position for this wallet) ends
      // the marker; a transport error keeps it for the next load.
      const msg = err instanceof Error ? err.message : String(err);
      if (/failed on chain|minted no|not in a listed/i.test(msg)) removePending(address, p.txHash);
    }
  }
  return wrote;
}

async function recordWithRetry(address: string, chainId: UniswapChainId, txHash: string): Promise<boolean> {
  for (let attempt = 0; attempt < RECORD_ATTEMPTS; attempt += 1) {
    try {
      if (await recordUniswapPosition(chainId, txHash)) {
        removePending(address, txHash);
        return true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/failed on chain|minted no|not in a listed/i.test(msg)) {
        removePending(address, txHash);
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, RECORD_DELAY_MS));
  }
  return false;
}

// ── the mint ──────────────────────────────────────────────────────────────

export async function mintPosition(args: {
  pool: UniswapPool;
  signer: EvmSigner;
  // Atomic amounts of token0 and token1 the wallet may put in.
  use: [bigint, bigint];
  prices: Record<string, number>;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ txHash: string; recorded: boolean }> {
  const { pool, signer } = args;
  const report: Report = (p) => args.onProgress?.(p);
  const chain = UNISWAP_CHAINS[pool.chainId];
  const owner = signer.address;
  const tokens: [PoolToken, PoolToken] = [pool.token0, pool.token1];
  const margin = (v: bigint) => (v * BigInt(10_000 - MINT_MARGIN_BPS)) / 10_000n;

  report({ stage: "switching", message: `Switching to ${chain.label}.` });
  const provider = await connectChain(signer, pool.chainId, chain.label);

  const tick = await readTick(provider, pool);
  const { tickLower, tickUpper } = bandTicks(tick, pool.bandBps ?? BAND_BPS, pool.tickSpacing);

  // Approvals for what the mint may spend. The API returns transactions
  // (Permit2 approvals and, on v4, the batch permit as a transaction) or
  // nothing when everything is already in place.
  report({ stage: "approving", message: `Checking ${chain.label} approvals.` });
  const approval = await callLpProxy("check_approval", pool.chainId, pool.id, {
    amount0: args.use[0].toString(),
    amount1: args.use[1].toString(),
    action: "CREATE",
  });
  for (const tx of approval.approvals) {
    report({ stage: "approving", message: `Approving on ${chain.label}.` });
    const hash = await sendLpTransaction(provider, tx, owner);
    await waitForReceipt(provider, hash, receiptOpts(pool.chainId));
  }

  // The side worth less goes first as the independent amount.
  const usd = (i: 0 | 1) => atomicToFloat(args.use[i], tokens[i].decimals) * (args.prices[tokenUsdKey(pool.chainId, tokens[i])] ?? 0);
  const first: 0 | 1 = usd(0) <= usd(1) ? 0 : 1;
  const build = (independent: 0 | 1) =>
    callLpProxy("create", pool.chainId, pool.id, {
      independent,
      amount: margin(args.use[independent]).toString(),
      tickLower,
      tickUpper,
    });

  report({ stage: "depositing", message: `Sizing the ${pool.label} position.` });
  let created = await build(first);
  const other: 0 | 1 = first === 0 ? 1 : 0;
  const dependent = other === 0 ? created.token0 : created.token1;
  if (dependent && BigInt(dependent.amount) > args.use[other]) {
    created = await build(other);
    const dep2 = first === 0 ? created.token0 : created.token1;
    if (dep2 && BigInt(dep2.amount) > args.use[first]) {
      throw new Error("The pool's price moved while sizing the position. Try again.");
    }
  }
  const tx = created.transaction;
  if (!tx) throw new Error("Uniswap's API returned no mint transaction.");
  // A native side is paid through `value`; the API sets it. Anything above
  // what the wallet can spend is refused here rather than by the node.
  const value = tx.value ? BigInt(tx.value) : 0n;
  const nativeSide = isNative(tokens[0]) ? 0 : isNative(tokens[1]) ? 1 : null;
  if (value > 0n && (nativeSide === null || value > args.use[nativeSide])) {
    throw new Error("The mint asks for more native currency than this deposit allows.");
  }

  report({ stage: "depositing", message: `Opening the ${pool.label} position.` });
  const hash = await sendLpTransaction(provider, tx, owner);
  addPending(owner, { chainId: pool.chainId, txHash: hash });
  report({ stage: "confirming", message: `Confirming on ${chain.label}.`, txHash: hash });
  await waitForReceipt(provider, hash, receiptOpts(pool.chainId));

  report({ stage: "confirming", message: "Recording the position.", txHash: hash });
  const recorded = await recordWithRetry(owner, pool.chainId, hash);
  report({
    stage: "done",
    message: recorded ? "Position opened." : "Position opened. It will appear once the record catches up.",
    txHash: hash,
  });
  return { txHash: hash, recorded };
}
