// Server-only chain reads for the venue: every pool's price and liquidity, a
// wallet's balances of the registry's tokens, its positions with their live
// state, and the position a mint receipt created.
//
// Batched JSON-RPC through lib/uniswap/rpc.ts, one round trip per stage per
// chain, chains in parallel. Nothing here signs. The v4 fee arithmetic is a
// port of the PoolManager's (lib/uniswap/math.ts feesOwed); the v3 fees come
// from simulating `collect` from the owner, which is exact and one call.

import "server-only";

import { decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex } from "viem";

import {
  ERC721_TRANSFER_TOPIC,
  V3_POOL_ABI,
  V3_POSITION_MANAGER_ABI,
  V4_POSITION_MANAGER_ABI,
  V4_STATE_VIEW_ABI,
} from "./abi";
import { UNISWAP_CONTRACTS, type UniswapChainId, type UniswapProtocol } from "./constants";
import {
  amountsForLiquidity,
  feesOwed,
  getSqrtRatioAtTick,
  isInRange,
  positionValueUsd,
  tokenIdSalt,
  tokenUsdKey,
  tokenUsdPrices,
  unpackPositionInfo,
  v4PoolId,
} from "./math";
import {
  UNISWAP_CHAINS,
  UNISWAP_POOLS,
  uniswapPoolById,
  uniswapPoolsForChain,
  uniswapTokensForChain,
  type UniswapPool,
} from "./pools";
import type { StoredPosition } from "./positions-store";
import { ethCall, uniswapRpcBatchSettled, type RpcCall, type RpcOutcome } from "./rpc";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT128 = (1n << 128n) - 1n;
// Enumerating v3 positions is one call per NFT; a wallet with more than this
// many is not one the app opened, and the rest are ignored rather than read.
const MAX_V3_ENUMERATION = 50;
// Base's public node drops calls from larger batches (observed 2026-09-22).
const BATCH_CHUNK: Partial<Record<UniswapChainId, number>> = { 8453: 4 };

// ── plumbing ──────────────────────────────────────────────────────────────

type V3PoolFn = (typeof V3_POOL_ABI)[number]["name"];
type NpmFn = (typeof V3_POSITION_MANAGER_ABI)[number]["name"];
type PmFn = (typeof V4_POSITION_MANAGER_ABI)[number]["name"];
type SvFn = (typeof V4_STATE_VIEW_ABI)[number]["name"];

function enc(abi: unknown, functionName: string, args: unknown[] = []): Hex {
  return encodeFunctionData({ abi, functionName, args } as never);
}
function dec<T>(abi: unknown, functionName: string, data: Hex): T {
  return decodeFunctionResult({ abi, functionName, data } as never) as T;
}

const v3Pool = (to: string, fn: V3PoolFn) => ethCall(to, enc(V3_POOL_ABI, fn));
const npm = (to: string, fn: NpmFn, args: unknown[] = [], from?: string) => ethCall(to, enc(V3_POSITION_MANAGER_ABI, fn, args), from);
const pm = (to: string, fn: PmFn, args: unknown[] = []) => ethCall(to, enc(V4_POSITION_MANAGER_ABI, fn, args));
const sv = (to: string, fn: SvFn, args: unknown[] = []) => ethCall(to, enc(V4_STATE_VIEW_ABI, fn, args));
const balanceOf = (token: string, owner: string) =>
  ethCall(token, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] }));

function hexOf(o: RpcOutcome | undefined): Hex | null {
  return o && !o.error && typeof o.result === "string" && o.result !== "0x" ? (o.result as Hex) : null;
}

async function batch(chainId: UniswapChainId, calls: RpcCall[]): Promise<RpcOutcome[]> {
  if (calls.length === 0) return [];
  const chunk = BATCH_CHUNK[chainId];
  if (!chunk || calls.length <= chunk) return uniswapRpcBatchSettled(chainId, calls);
  const out: RpcOutcome[] = [];
  for (let i = 0; i < calls.length; i += chunk) {
    out.push(...(await uniswapRpcBatchSettled(chainId, calls.slice(i, i + chunk))));
  }
  return out;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function poolStateKey(pool: Pick<UniswapPool, "chainId" | "id">): string {
  return `${pool.chainId}:${pool.id.toLowerCase()}`;
}

// ── pool state ────────────────────────────────────────────────────────────

export interface PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

// slot0 and liquidity for every pool, keyed by poolStateKey. A chain that
// will not answer costs its own pools, not the map.
export async function readPoolStates(
  pools: readonly UniswapPool[] = UNISWAP_POOLS,
): Promise<Map<string, PoolState>> {
  const out = new Map<string, PoolState>();
  const byChain = new Map<UniswapChainId, UniswapPool[]>();
  for (const p of pools) byChain.set(p.chainId, [...(byChain.get(p.chainId) ?? []), p]);

  await Promise.all(
    [...byChain.entries()].map(async ([chainId, list]) => {
      const c = UNISWAP_CONTRACTS[chainId];
      const calls = list.flatMap((p) =>
        p.protocol === "V3"
          ? [v3Pool(p.id, "slot0"), v3Pool(p.id, "liquidity")]
          : [sv(c.v4StateView, "getSlot0", [p.id]), sv(c.v4StateView, "getLiquidity", [p.id])],
      );
      let outcomes: RpcOutcome[];
      try {
        outcomes = await batch(chainId, calls);
      } catch (err) {
        console.warn(`[uniswap state] ${UNISWAP_CHAINS[chainId].label}:`, err instanceof Error ? err.message : err);
        return;
      }
      list.forEach((p, i) => {
        const slot = hexOf(outcomes[i * 2]);
        const liq = hexOf(outcomes[i * 2 + 1]);
        if (!slot || !liq) return;
        if (p.protocol === "V3") {
          const s = dec<readonly [bigint, number]>(V3_POOL_ABI, "slot0", slot);
          out.set(poolStateKey(p), { sqrtPriceX96: s[0], tick: s[1], liquidity: dec<bigint>(V3_POOL_ABI, "liquidity", liq) });
        } else {
          const s = dec<readonly [bigint, number, number, number]>(V4_STATE_VIEW_ABI, "getSlot0", slot);
          out.set(poolStateKey(p), { sqrtPriceX96: s[0], tick: s[1], liquidity: dec<bigint>(V4_STATE_VIEW_ABI, "getLiquidity", liq) });
        }
      });
    }),
  );
  return out;
}

// USD per token for the registry, from the pool states alone.
export function pricesFromStates(states: ReadonlyMap<string, PoolState>): Map<string, number> {
  const sqrt = new Map<string, bigint>();
  for (const [k, s] of states) sqrt.set(k, s.sqrtPriceX96);
  return tokenUsdPrices(UNISWAP_POOLS, sqrt);
}

// ── gas ───────────────────────────────────────────────────────────────────

// Current gas price per chain, wei as a decimal string. The Ethereum funding
// planner sizes its ETH top-up from this rather than from a constant, the
// way the gold and Aave venues do; the other chains keep fixed floors.
export async function readGasPrices(): Promise<Partial<Record<UniswapChainId, string>>> {
  const out: Partial<Record<UniswapChainId, string>> = {};
  const chains = Object.keys(UNISWAP_CHAINS).map(Number) as UniswapChainId[];
  await Promise.all(
    chains.map(async (chainId) => {
      try {
        const [o] = await batch(chainId, [{ method: "eth_gasPrice", params: [] }]);
        const h = hexOf(o);
        if (h) out[chainId] = BigInt(h).toString();
      } catch (err) {
        console.warn(`[uniswap gas] ${UNISWAP_CHAINS[chainId].label}:`, err instanceof Error ? err.message : err);
      }
    }),
  );
  return out;
}

// ── balances ──────────────────────────────────────────────────────────────

// Every registry token on the chain plus the native asset, atomic, keyed by
// lowercased address; the native asset is under the zero address and again
// under "native".
export type WalletBalances = Record<string, string>;

function balanceCalls(chainId: UniswapChainId, owner: string): { calls: RpcCall[]; keys: string[] } {
  const calls: RpcCall[] = [{ method: "eth_getBalance", params: [owner, "latest"] }];
  const keys = ["native"];
  for (const t of uniswapTokensForChain(chainId)) {
    if (t.native || same(t.address, ZERO_ADDRESS)) continue;
    calls.push(balanceOf(t.address, owner));
    keys.push(t.address.toLowerCase());
  }
  return { calls, keys };
}

function decodeBalances(outcomes: RpcOutcome[], keys: string[]): WalletBalances {
  const out: WalletBalances = {};
  keys.forEach((k, i) => {
    const h = hexOf(outcomes[i]);
    out[k] = h ? BigInt(h).toString() : "0";
  });
  out[ZERO_ADDRESS] = out.native ?? "0";
  return out;
}

export async function readWalletBalances(chainId: UniswapChainId, owner: string): Promise<WalletBalances> {
  const { calls, keys } = balanceCalls(chainId, owner);
  return decodeBalances(await batch(chainId, calls), keys);
}

// ── positions ─────────────────────────────────────────────────────────────

export interface UniswapPositionView {
  key: string;
  chainId: UniswapChainId;
  protocol: UniswapProtocol;
  tokenId: string;
  // The registry pool's id as the registry spells it.
  poolId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  // What the position holds now, atomic, and the fees it can collect.
  amount0: string;
  amount1: string;
  fees0: string;
  fees1: string;
  tick: number;
  inRange: boolean;
  usd0: number | null;
  usd1: number | null;
  valueUsd: number | null;
  feesUsd: number | null;
  openedAt: string | null;
  txHash: string | null;
}

export interface PositionsRead {
  positions: UniswapPositionView[];
  // Stored rows whose position is gone: burned, transferred, or empty.
  closed: { chainId: UniswapChainId; protocol: UniswapProtocol; tokenId: string }[];
  balances: Partial<Record<UniswapChainId, WalletBalances>>;
  states: Map<string, PoolState>;
  prices: Map<string, number>;
}

interface RawPosition {
  pool: UniswapPool;
  protocol: UniswapProtocol;
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  fees0: bigint;
  fees1: bigint;
}

function toView(raw: RawPosition, state: PoolState | undefined, prices: ReadonlyMap<string, number>, stored: StoredPosition | undefined): UniswapPositionView | null {
  if (!state) return null;
  const { pool } = raw;
  const { amount0, amount1 } = amountsForLiquidity(
    state.sqrtPriceX96,
    getSqrtRatioAtTick(raw.tickLower),
    getSqrtRatioAtTick(raw.tickUpper),
    raw.liquidity,
  );
  const usd0 = prices.get(tokenUsdKey(pool.chainId, pool.token0)) ?? null;
  const usd1 = prices.get(tokenUsdKey(pool.chainId, pool.token1)) ?? null;
  return {
    key: `${pool.chainId}:${raw.protocol}:${raw.tokenId}`,
    chainId: pool.chainId,
    protocol: raw.protocol,
    tokenId: raw.tokenId.toString(),
    poolId: pool.id,
    tickLower: raw.tickLower,
    tickUpper: raw.tickUpper,
    liquidity: raw.liquidity.toString(),
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    fees0: raw.fees0.toString(),
    fees1: raw.fees1.toString(),
    tick: state.tick,
    inRange: isInRange(state.tick, raw.tickLower, raw.tickUpper),
    usd0,
    usd1,
    valueUsd: positionValueUsd(amount0, amount1, pool, usd0 ?? undefined, usd1 ?? undefined),
    feesUsd: positionValueUsd(raw.fees0, raw.fees1, pool, usd0 ?? undefined, usd1 ?? undefined),
    openedAt: stored?.openedAt ?? null,
    txHash: stored?.txHash ?? null,
  };
}

// v3 positions by enumeration: every NFT the wallet holds on the chain's
// position manager whose (token0, token1, fee) is a registry pool.
async function readV3Positions(chainId: UniswapChainId, owner: string): Promise<RawPosition[]> {
  const c = UNISWAP_CONTRACTS[chainId];
  const pools = uniswapPoolsForChain(chainId).filter((p) => p.protocol === "V3");
  if (pools.length === 0) return [];
  const [countOutcome] = await batch(chainId, [npm(c.v3PositionManager, "balanceOf", [owner])]);
  const countHex = hexOf(countOutcome);
  if (!countHex) return [];
  const count = Math.min(Number(dec<bigint>(V3_POSITION_MANAGER_ABI, "balanceOf", countHex)), MAX_V3_ENUMERATION);
  if (count === 0) return [];

  const idOutcomes = await batch(
    chainId,
    Array.from({ length: count }, (_, i) => npm(c.v3PositionManager, "tokenOfOwnerByIndex", [owner, BigInt(i)])),
  );
  const tokenIds = idOutcomes.map(hexOf).filter((h): h is Hex => h != null).map((h) => dec<bigint>(V3_POSITION_MANAGER_ABI, "tokenOfOwnerByIndex", h));
  if (tokenIds.length === 0) return [];

  const posOutcomes = await batch(chainId, tokenIds.map((id) => npm(c.v3PositionManager, "positions", [id])));
  const matched: { tokenId: bigint; pool: UniswapPool; tickLower: number; tickUpper: number; liquidity: bigint; owed0: bigint; owed1: bigint }[] = [];
  tokenIds.forEach((tokenId, i) => {
    const h = hexOf(posOutcomes[i]);
    if (!h) return;
    const p = dec<readonly [bigint, string, string, string, number, number, number, bigint, bigint, bigint, bigint, bigint]>(V3_POSITION_MANAGER_ABI, "positions", h);
    const pool = pools.find((x) => same(x.token0.address, p[2]) && same(x.token1.address, p[3]) && x.fee === p[4]);
    if (!pool) return;
    matched.push({ tokenId, pool, tickLower: p[5], tickUpper: p[6], liquidity: p[7], owed0: p[10], owed1: p[11] });
  });
  if (matched.length === 0) return [];

  // Fees: simulate collect from the owner with the maximum amounts.
  const feeOutcomes = await batch(
    chainId,
    matched.map((m) =>
      npm(c.v3PositionManager, "collect", [{ tokenId: m.tokenId, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }], owner),
    ),
  );
  return matched.map((m, i) => {
    const h = hexOf(feeOutcomes[i]);
    const fees = h ? dec<readonly [bigint, bigint]>(V3_POSITION_MANAGER_ABI, "collect", h) : [m.owed0, m.owed1];
    return { pool: m.pool, protocol: "V3" as const, tokenId: m.tokenId, tickLower: m.tickLower, tickUpper: m.tickUpper, liquidity: m.liquidity, fees0: fees[0], fees1: fees[1] };
  });
}

// v4 positions from the stored rows: the manager does not enumerate, so the
// rows are the discovery and the chain is the truth about each one.
async function readV4Positions(
  chainId: UniswapChainId,
  owner: string,
  rows: StoredPosition[],
): Promise<{ positions: RawPosition[]; gone: StoredPosition[] }> {
  const c = UNISWAP_CONTRACTS[chainId];
  if (rows.length === 0) return { positions: [], gone: [] };
  const ids = rows.map((r) => BigInt(r.tokenId));
  const first = await batch(
    chainId,
    ids.flatMap((id) => [
      pm(c.v4PositionManager, "ownerOf", [id]),
      pm(c.v4PositionManager, "getPoolAndPositionInfo", [id]),
      pm(c.v4PositionManager, "getPositionLiquidity", [id]),
    ]),
  );
  const live: { row: StoredPosition; tokenId: bigint; pool: UniswapPool; tickLower: number; tickUpper: number; liquidity: bigint }[] = [];
  const gone: StoredPosition[] = [];
  rows.forEach((row, i) => {
    const ownerHex = hexOf(first[i * 3]);
    const infoHex = hexOf(first[i * 3 + 1]);
    const liqHex = hexOf(first[i * 3 + 2]);
    // ownerOf reverts on a burned token; a transferred one is someone
    // else's now. Either way the row is done.
    if (!ownerHex || !same(dec<string>(V4_POSITION_MANAGER_ABI, "ownerOf", ownerHex), owner) || !infoHex || !liqHex) {
      gone.push(row);
      return;
    }
    const [key, info] = dec<readonly [{ currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }, bigint]>(V4_POSITION_MANAGER_ABI, "getPoolAndPositionInfo", infoHex);
    const pool = uniswapPoolById(chainId, v4PoolId(key));
    if (!pool) {
      gone.push(row);
      return;
    }
    const u = unpackPositionInfo(info);
    live.push({ row, tokenId: ids[i], pool, tickLower: u.tickLower, tickUpper: u.tickUpper, liquidity: dec<bigint>(V4_POSITION_MANAGER_ABI, "getPositionLiquidity", liqHex) });
  });
  if (live.length === 0) return { positions: [], gone };

  const second = await batch(
    chainId,
    live.flatMap((l) => [
      sv(c.v4StateView, "getFeeGrowthInside", [l.pool.id, l.tickLower, l.tickUpper]),
      sv(c.v4StateView, "getPositionInfo", [l.pool.id, c.v4PositionManager, l.tickLower, l.tickUpper, tokenIdSalt(l.tokenId)]),
    ]),
  );
  const positions: RawPosition[] = [];
  live.forEach((l, i) => {
    const insideHex = hexOf(second[i * 2]);
    const posHex = hexOf(second[i * 2 + 1]);
    let fees0 = 0n;
    let fees1 = 0n;
    if (insideHex && posHex) {
      const [inside0, inside1] = dec<readonly [bigint, bigint]>(V4_STATE_VIEW_ABI, "getFeeGrowthInside", insideHex);
      const [liq, last0, last1] = dec<readonly [bigint, bigint, bigint]>(V4_STATE_VIEW_ABI, "getPositionInfo", posHex);
      fees0 = feesOwed(inside0, last0, liq);
      fees1 = feesOwed(inside1, last1, liq);
    }
    if (l.liquidity === 0n && fees0 === 0n && fees1 === 0n) {
      gone.push(l.row);
      return;
    }
    positions.push({ pool: l.pool, protocol: "V4", tokenId: l.tokenId, tickLower: l.tickLower, tickUpper: l.tickUpper, liquidity: l.liquidity, fees0, fees1 });
  });
  return { positions, gone };
}

// Everything the positions route returns for one wallet.
export async function readPositions(owner: string, stored: StoredPosition[]): Promise<PositionsRead> {
  const states = await readPoolStates();
  const prices = pricesFromStates(states);
  const storedByKey = new Map(stored.map((r) => [`${r.chainId}:${r.protocol}:${r.tokenId}`, r]));

  const chains = Object.keys(UNISWAP_CHAINS).map(Number) as UniswapChainId[];
  const perChain = await Promise.all(
    chains.map(async (chainId) => {
      const label = UNISWAP_CHAINS[chainId].label;
      const rows = stored.filter((r) => r.chainId === chainId);
      const [balances, v3, v4] = await Promise.all([
        readWalletBalances(chainId, owner).catch((err) => {
          console.warn(`[uniswap balances] ${label}:`, err instanceof Error ? err.message : err);
          return null;
        }),
        readV3Positions(chainId, owner).catch((err) => {
          console.warn(`[uniswap v3 positions] ${label}:`, err instanceof Error ? err.message : err);
          return null;
        }),
        readV4Positions(chainId, owner, rows.filter((r) => r.protocol === "V4")).catch((err) => {
          console.warn(`[uniswap v4 positions] ${label}:`, err instanceof Error ? err.message : err);
          return null;
        }),
      ]);
      // A stored v3 row the enumeration no longer shows is gone. Only when
      // the enumeration itself answered: a failed read must not close rows.
      const v3Gone = v3
        ? rows.filter((r) => r.protocol === "V3" && !v3.some((p) => p.tokenId.toString() === r.tokenId))
        : [];
      const raws = [...(v3 ?? []), ...(v4?.positions ?? [])];
      return { chainId, balances, raws, gone: [...v3Gone, ...(v4?.gone ?? [])] };
    }),
  );

  const positions: UniswapPositionView[] = [];
  const closed: PositionsRead["closed"] = [];
  const balances: PositionsRead["balances"] = {};
  for (const r of perChain) {
    if (r.balances) balances[r.chainId] = r.balances;
    for (const raw of r.raws) {
      // An empty v3 position that is also fee-less is dust from a past exit.
      if (raw.liquidity === 0n && raw.fees0 === 0n && raw.fees1 === 0n) {
        const row = storedByKey.get(`${raw.pool.chainId}:${raw.protocol}:${raw.tokenId}`);
        if (row) closed.push({ chainId: row.chainId, protocol: row.protocol, tokenId: row.tokenId });
        continue;
      }
      const view = toView(raw, states.get(poolStateKey(raw.pool)), prices, storedByKey.get(`${raw.pool.chainId}:${raw.protocol}:${raw.tokenId}`));
      if (view) positions.push(view);
    }
    for (const g of r.gone) closed.push({ chainId: g.chainId, protocol: g.protocol, tokenId: g.tokenId });
  }
  positions.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  return { positions, closed, balances, states, prices };
}

// ── receipts ──────────────────────────────────────────────────────────────

export type ReceiptRead =
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "none"; reason: string }
  | { kind: "found"; position: Omit<StoredPosition, "openedAt"> };

interface Log {
  address: string;
  topics: string[];
}

function padAddress(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

// The position a mint transaction created for `owner`: the ERC-721 Transfer
// from the zero address by the chain's v3 or v4 position manager, then the
// pool and ticks read from the chain. The client names the hash and nothing
// else (docs/uniswap-lp-plan.md D8).
export async function positionFromReceipt(chainId: UniswapChainId, txHash: string, owner: string): Promise<ReceiptRead> {
  const c = UNISWAP_CONTRACTS[chainId];
  const [outcome] = await batch(chainId, [{ method: "eth_getTransactionReceipt", params: [txHash] }]);
  if (outcome.error) throw new Error(outcome.error);
  const receipt = outcome.result as { status?: string; logs?: Log[] } | null | undefined;
  if (!receipt) return { kind: "pending" };
  if (receipt.status && BigInt(receipt.status) === 0n) return { kind: "failed" };

  const to = padAddress(owner);
  const zero = padAddress(ZERO_ADDRESS);
  const mint = (receipt.logs ?? []).find(
    (l) =>
      l.topics?.length === 4 &&
      l.topics[0].toLowerCase() === ERC721_TRANSFER_TOPIC &&
      l.topics[1].toLowerCase() === zero &&
      l.topics[2].toLowerCase() === to &&
      (same(l.address, c.v3PositionManager) || same(l.address, c.v4PositionManager)),
  );
  if (!mint) return { kind: "none", reason: "The transaction minted no Uniswap position for this wallet." };
  const tokenId = BigInt(mint.topics[3]);
  const protocol: UniswapProtocol = same(mint.address, c.v4PositionManager) ? "V4" : "V3";

  if (protocol === "V3") {
    const [posOutcome] = await batch(chainId, [npm(c.v3PositionManager, "positions", [tokenId])]);
    const h = hexOf(posOutcome);
    if (!h) return { kind: "none", reason: "The position could not be read from the chain." };
    const p = dec<readonly [bigint, string, string, string, number, number, number, bigint]>(V3_POSITION_MANAGER_ABI, "positions", h);
    const pool = uniswapPoolsForChain(chainId).find((x) => x.protocol === "V3" && same(x.token0.address, p[2]) && same(x.token1.address, p[3]) && x.fee === p[4]);
    if (!pool) return { kind: "none", reason: "The position is not in a listed pool." };
    return { kind: "found", position: { chainId, protocol, tokenId: tokenId.toString(), poolId: pool.id, tickLower: p[5], tickUpper: p[6], txHash } };
  }
  const [infoOutcome] = await batch(chainId, [pm(c.v4PositionManager, "getPoolAndPositionInfo", [tokenId])]);
  const h = hexOf(infoOutcome);
  if (!h) return { kind: "none", reason: "The position could not be read from the chain." };
  const [key, info] = dec<readonly [{ currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }, bigint]>(V4_POSITION_MANAGER_ABI, "getPoolAndPositionInfo", h);
  const pool = uniswapPoolById(chainId, v4PoolId(key));
  if (!pool) return { kind: "none", reason: "The position is not in a listed pool." };
  const u = unpackPositionInfo(info);
  return { kind: "found", position: { chainId, protocol, tokenId: tokenId.toString(), poolId: pool.id, tickLower: u.tickLower, tickUpper: u.tickUpper, txHash } };
}
