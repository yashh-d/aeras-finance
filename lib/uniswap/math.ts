// Pure Uniswap maths for the venue: ticks and square-root prices, band
// ticks, amounts for liquidity, fees owed, prices, the fee APR, the v4 pool
// id, and the v4 PositionInfo unpacking. Ports of TickMath, SqrtPriceMath and
// LiquidityAmounts from uniswap/v3-core and v3-periphery and of
// PositionInfoLibrary from v4-periphery, in bigint, with rounding matched to
// the contracts where a wei matters. Pinned by ./math.test.ts to figures read
// live on 2026-09-22 (docs/uniswap-lp-plan.md).

import { encodeAbiParameters, keccak256, type Hex } from "viem";

import { MAX_TICK, MIN_TICK } from "./constants";
import type { PoolToken, UniswapPool } from "./pools";

const Q32 = 1n << 32n;
export const Q96 = 1n << 96n;
export const Q128 = 1n << 128n;
const MAX_UINT256 = (1n << 256n) - 1n;

// ── ticks ─────────────────────────────────────────────────────────────────

// sqrt(1.0001^tick) * 2^96, rounded up, exactly as TickMath.getSqrtRatioAtTick.
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`tick out of range: ${tick}`);
  }
  const absTick = tick < 0 ? -tick : tick;
  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  if (absTick & 0x2) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if (absTick & 0x4) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if (absTick & 0x8) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if (absTick & 0x10) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if (absTick & 0x20) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if (absTick & 0x40) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if (absTick & 0x80) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if (absTick & 0x100) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if (absTick & 0x200) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if (absTick & 0x400) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if (absTick & 0x800) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if (absTick & 0x1000) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if (absTick & 0x2000) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if (absTick & 0x4000) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if (absTick & 0x8000) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if (absTick & 0x10000) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if (absTick & 0x20000) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if (absTick & 0x40000) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if (absTick & 0x80000) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  // Q128.128 to Q64.96, rounded up.
  return ratio % Q32 === 0n ? ratio >> 32n : (ratio >> 32n) + 1n;
}

// The greatest tick whose sqrt ratio is at most the given one, as
// TickMath.getTickAtSqrtRatio. A floating-point estimate corrected against
// the exact function, which lands within a couple of ticks and is then
// exact by construction.
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= 0n) throw new Error("sqrt price must be positive");
  const estimate = Math.floor(
    (2 * Math.log(Number(sqrtPriceX96) / 2 ** 96)) / Math.log(1.0001),
  );
  let tick = Math.max(MIN_TICK, Math.min(MAX_TICK, estimate));
  while (tick > MIN_TICK && getSqrtRatioAtTick(tick) > sqrtPriceX96) tick -= 1;
  while (tick < MAX_TICK && getSqrtRatioAtTick(tick + 1) <= sqrtPriceX96) tick += 1;
  return tick;
}

// Ticks either side of the price that are `bandBps` away in price:
// 1.0001^width = 1 + bandBps/10000. 953 ticks for 10%.
export function bandWidthTicks(bandBps: number): number {
  return Math.round(Math.log(1 + bandBps / 10_000) / Math.log(1.0001));
}

export function floorToSpacing(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

export function ceilToSpacing(tick: number, spacing: number): number {
  return Math.ceil(tick / spacing) * spacing;
}

// The band a new position takes (docs/uniswap-lp-plan.md D3): the current
// tick less the width rounded down to the spacing, plus the width rounded
// up, clamped inside the protocol's bounds. Never narrower than asked, and
// the two bounds are distinct at any spacing the registry uses.
export function bandTicks(
  currentTick: number,
  bandBps: number,
  tickSpacing: number,
): { tickLower: number; tickUpper: number } {
  const width = bandWidthTicks(bandBps);
  const minAligned = ceilToSpacing(MIN_TICK, tickSpacing);
  const maxAligned = floorToSpacing(MAX_TICK, tickSpacing);
  let tickLower = Math.max(minAligned, floorToSpacing(currentTick - width, tickSpacing));
  let tickUpper = Math.min(maxAligned, ceilToSpacing(currentTick + width, tickSpacing));
  if (tickUpper <= tickLower) {
    tickUpper = Math.min(maxAligned, tickLower + tickSpacing);
    if (tickUpper <= tickLower) tickLower = tickUpper - tickSpacing;
  }
  return { tickLower, tickUpper };
}

export function isInRange(tick: number, tickLower: number, tickUpper: number): boolean {
  return tick >= tickLower && tick < tickUpper;
}

// ── amounts ───────────────────────────────────────────────────────────────

function sorted(a: bigint, b: bigint): [bigint, bigint] {
  return a <= b ? [a, b] : [b, a];
}

// LiquidityAmounts.getAmount0ForLiquidity: token0 held by L between two sqrt
// prices, rounded down.
export function amount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  if (lo === 0n) throw new Error("sqrt price must be positive");
  return (((liquidity << 96n) * (hi - lo)) / hi) / lo;
}

// LiquidityAmounts.getAmount1ForLiquidity, rounded down.
export function amount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  return (liquidity * (hi - lo)) / Q96;
}

// What a position of `liquidity` over [sqrtA, sqrtB] holds at `sqrtP`.
export function amountsForLiquidity(
  sqrtP: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  if (sqrtP <= lo) return { amount0: amount0ForLiquidity(lo, hi, liquidity), amount1: 0n };
  if (sqrtP < hi) {
    return {
      amount0: amount0ForLiquidity(sqrtP, hi, liquidity),
      amount1: amount1ForLiquidity(lo, sqrtP, liquidity),
    };
  }
  return { amount0: 0n, amount1: amount1ForLiquidity(lo, hi, liquidity) };
}

export function liquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  const intermediate = (lo * hi) / Q96;
  return (amount0 * intermediate) / (hi - lo);
}

export function liquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  return (amount1 * Q96) / (hi - lo);
}

// The liquidity both amounts can fund together over the band at the price:
// the smaller of what each side allows while the price is inside.
export function liquidityForAmounts(
  sqrtP: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const [lo, hi] = sorted(sqrtA, sqrtB);
  if (sqrtP <= lo) return liquidityForAmount0(lo, hi, amount0);
  if (sqrtP < hi) {
    const l0 = liquidityForAmount0(sqrtP, hi, amount0);
    const l1 = liquidityForAmount1(lo, sqrtP, amount1);
    return l0 < l1 ? l0 : l1;
  }
  return liquidityForAmount1(lo, hi, amount1);
}

// ── prices ────────────────────────────────────────────────────────────────

// token1 per token0 as a human number: (sqrtP / 2^96)^2 scaled by the
// decimals. A float, for display and sizing; nothing on chain is built from
// it.
export function priceToken1PerToken0(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  return ratio * ratio * 10 ** (decimals0 - decimals1);
}

// Dollars per unit of the pool's non-dollar side, from the pool's own price.
// Null for a pool with no dollar side.
export function baseUsdFromPool(pool: UniswapPool, sqrtPriceX96: bigint): number | null {
  if (pool.quoteSide === null) return null;
  const p = priceToken1PerToken0(sqrtPriceX96, pool.token0.decimals, pool.token1.decimals);
  // quoteSide 0: token0 is the dollar, so dollars per token1 is 1/p.
  return pool.quoteSide === 0 ? (p > 0 ? 1 / p : null) : p;
}

// USD per token for every token the registry names, from the pools alone:
// the dollar tokens are $1, each dollar-quoted pool prices its other side,
// and each remaining pool prices its unpriced side off the priced one. Two
// passes cover every listed pool (MON/WETH and MON/WBTC are the second
// pass). Keyed by `${chainId}:${address.toLowerCase()}`.
export function tokenUsdPrices(
  pools: readonly UniswapPool[],
  sqrtPrices: ReadonlyMap<string, bigint>,
): Map<string, number> {
  const out = new Map<string, number>();
  const key = (chainId: number, t: PoolToken) => `${chainId}:${t.address.toLowerCase()}`;
  for (const p of pools) {
    if (p.token0.stable) out.set(key(p.chainId, p.token0), 1);
    if (p.token1.stable) out.set(key(p.chainId, p.token1), 1);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const p of pools) {
      const sqrtP = sqrtPrices.get(`${p.chainId}:${p.id.toLowerCase()}`);
      if (!sqrtP || sqrtP <= 0n) continue;
      const k0 = key(p.chainId, p.token0);
      const k1 = key(p.chainId, p.token1);
      const price = priceToken1PerToken0(sqrtP, p.token0.decimals, p.token1.decimals);
      if (!(price > 0)) continue;
      const usd0 = out.get(k0);
      const usd1 = out.get(k1);
      if (usd0 != null && usd1 == null) out.set(k1, usd0 / price);
      else if (usd1 != null && usd0 == null) out.set(k0, usd1 * price);
    }
  }
  return out;
}

export function tokenUsdKey(chainId: number, token: PoolToken): string {
  return `${chainId}:${token.address.toLowerCase()}`;
}

export function atomicToFloat(atomic: bigint, decimals: number): number {
  return Number(atomic) / 10 ** decimals;
}

// ── fees ──────────────────────────────────────────────────────────────────

// Fees owed to a position since it last synced, as the pool computes them:
// the fee growth inside the range minus the position's snapshot, times
// liquidity, in Q128. The subtraction wraps, on purpose, like the contract's.
export function feesOwed(
  feeGrowthInsideX128: bigint,
  feeGrowthInsideLastX128: bigint,
  liquidity: bigint,
): bigint {
  const delta = (feeGrowthInsideX128 - feeGrowthInsideLastX128) & MAX_UINT256;
  return (delta * liquidity) >> 128n;
}

// Fee APR from volume: what the pool paid its liquidity over the period,
// annualised, over what was in it. The pool average, gross of impermanent
// loss (docs/uniswap-lp-plan.md D4).
export function feeApr(volumeUsd: number, feePips: number, tvlUsd: number, periodDays: number): number | null {
  if (!(tvlUsd > 0) || !(periodDays > 0) || !(volumeUsd >= 0)) return null;
  return ((volumeUsd * feePips) / 1_000_000) * (365 / periodDays) / tvlUsd;
}

// ── v4 ────────────────────────────────────────────────────────────────────

export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

// keccak256(abi.encode(PoolKey)), the PoolManager's id for a pool.
export function v4PoolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [
        key.currency0 as `0x${string}`,
        key.currency1 as `0x${string}`,
        key.fee,
        key.tickSpacing,
        key.hooks as `0x${string}`,
      ],
    ),
  );
}

export function v4PoolKey(pool: UniswapPool): PoolKey {
  return {
    currency0: pool.token0.address,
    currency1: pool.token1.address,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hooks,
  };
}

// The first 25 bytes of a pool id, the key `PositionManager.poolKeys` takes.
export function poolIdToBytes25(poolId: string): Hex {
  const hex = poolId.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 64) throw new Error(`not a 32-byte pool id: ${poolId}`);
  return `0x${hex.slice(0, 50)}`;
}

function toInt24(v: bigint): number {
  const n = Number(v & 0xffffffn);
  return n >= 0x800000 ? n - 0x1000000 : n;
}

// v4-periphery PositionInfoLibrary: 200 bits of pool id, then tickUpper
// (24 bits), tickLower (24 bits), hasSubscriber (8 bits), most significant
// first. The pool id is the top 25 bytes, which is why poolKeys is keyed by
// bytes25.
export function unpackPositionInfo(info: bigint): {
  poolId25: Hex;
  tickLower: number;
  tickUpper: number;
  hasSubscriber: boolean;
} {
  const poolId25 = `0x${(info >> 56n).toString(16).padStart(50, "0")}` as Hex;
  return {
    poolId25,
    tickLower: toInt24(info >> 8n),
    tickUpper: toInt24(info >> 32n),
    hasSubscriber: (info & 0xffn) !== 0n,
  };
}

// The salt a position's fees are keyed under in the PoolManager: the token id
// as a bytes32.
export function tokenIdSalt(tokenId: bigint): Hex {
  return `0x${tokenId.toString(16).padStart(64, "0")}`;
}

// ── value ─────────────────────────────────────────────────────────────────

export function positionValueUsd(
  amount0: bigint,
  amount1: bigint,
  pool: UniswapPool,
  usd0: number | undefined,
  usd1: number | undefined,
): number | null {
  if (usd0 == null || usd1 == null) return null;
  return (
    atomicToFloat(amount0, pool.token0.decimals) * usd0 +
    atomicToFloat(amount1, pool.token1.decimals) * usd1
  );
}
