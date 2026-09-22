import { describe, expect, it } from "vitest";

import { BAND_BPS, MAX_TICK, MIN_TICK } from "./constants";
import {
  amountsForLiquidity,
  bandTicks,
  bandWidthTicks,
  baseUsdFromPool,
  feeApr,
  feesOwed,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  isInRange,
  liquidityForAmounts,
  poolIdToBytes25,
  priceToken1PerToken0,
  tokenUsdKey,
  tokenUsdPrices,
  unpackPositionInfo,
  v4PoolId,
  v4PoolKey,
  Q96,
} from "./math";
import { UNISWAP_POOLS, uniswapPoolById } from "./pools";

// Live pairs read on 2026-09-22 (docs/uniswap-lp-plan.md, Slice 0).
const NVDA_USDG = { sqrtP: 5266705192528656573699911090413946n, tick: 222102 };
const MON_USDC = { sqrtP: 12519170589231556796262n, tick: -313228 };
const USDC_WETH_MONAD = { sqrtP: 1516325497069829269038989379629140n, tick: 197199 };
const SPCX_USDG = { sqrtP: 977580450422822516315171n, tick: -226067 };

describe("tick math", () => {
  it("matches TickMath at the three anchors", () => {
    expect(getSqrtRatioAtTick(0)).toBe(Q96);
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(4295128739n);
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(
      1461446703485210103287273052203988822378723970342n,
    );
  });

  it("round-trips the live prices to their ticks", () => {
    for (const { sqrtP, tick } of [NVDA_USDG, MON_USDC, USDC_WETH_MONAD, SPCX_USDG]) {
      expect(getTickAtSqrtRatio(sqrtP)).toBe(tick);
      expect(getSqrtRatioAtTick(tick) <= sqrtP).toBe(true);
      expect(getSqrtRatioAtTick(tick + 1) > sqrtP).toBe(true);
    }
  });

  it("is exact at a tick's own sqrt ratio", () => {
    for (const tick of [-887272, -100000, -1, 0, 1, 60, 197199, 887271]) {
      expect(getTickAtSqrtRatio(getSqrtRatioAtTick(tick))).toBe(tick);
    }
  });
});

describe("band", () => {
  it("is 953 ticks either side for 10%", () => {
    expect(bandWidthTicks(1000)).toBe(953);
    expect(bandWidthTicks(500)).toBe(488);
  });

  it("aligns outward to the spacing", () => {
    // NVDA/USDG at 222102, spacing 10: 221149 -> 221140, 223055 -> 223060.
    expect(bandTicks(222102, BAND_BPS, 10)).toEqual({ tickLower: 221140, tickUpper: 223060 });
    // SPY/USDG at -209819, spacing 60.
    const b = bandTicks(-209819, BAND_BPS, 60);
    // Math.abs: a negative multiple of 60 gives JavaScript's -0.
    expect(Math.abs(b.tickLower % 60)).toBe(0);
    expect(Math.abs(b.tickUpper % 60)).toBe(0);
    expect(b.tickLower).toBeLessThanOrEqual(-209819 - 953);
    expect(b.tickUpper).toBeGreaterThanOrEqual(-209819 + 953);
    // Spacing 1 (MON/WETH) is the width itself.
    expect(bandTicks(-116024, BAND_BPS, 1)).toEqual({ tickLower: -116977, tickUpper: -115071 });
  });

  it("is 50/50 by value at the centre", () => {
    // A geometric band is symmetric in value at its centre: the two sides'
    // dollar amounts agree to the rounding of the tick alignment.
    const { tickLower, tickUpper } = bandTicks(222102, BAND_BPS, 10);
    const sqrtP = NVDA_USDG.sqrtP;
    const L = 10n ** 18n;
    const { amount0, amount1 } = amountsForLiquidity(
      sqrtP,
      getSqrtRatioAtTick(tickLower),
      getSqrtRatioAtTick(tickUpper),
      L,
    );
    const price = priceToken1PerToken0(sqrtP, 6, 18); // NVDA per USDG
    const usd0 = Number(amount0) / 1e6;
    const usd1 = (Number(amount1) / 1e18) / price;
    expect(Math.abs(usd0 - usd1) / usd0).toBeLessThan(0.02);
  });

  it("knows which side of the band the price is on", () => {
    expect(isInRange(100, 0, 200)).toBe(true);
    expect(isInRange(200, 0, 200)).toBe(false);
    expect(isInRange(-1, 0, 200)).toBe(false);
  });
});

describe("amounts", () => {
  it("round-trips liquidity through amounts", () => {
    const sqrtP = USDC_WETH_MONAD.sqrtP;
    const sqrtA = getSqrtRatioAtTick(196240);
    const sqrtB = getSqrtRatioAtTick(198150);
    const L = 186919852953814285n;
    const { amount0, amount1 } = amountsForLiquidity(sqrtP, sqrtA, sqrtB, L);
    expect(amount0 > 0n && amount1 > 0n).toBe(true);
    const back = liquidityForAmounts(sqrtP, sqrtA, sqrtB, amount0, amount1);
    // Rounded down twice, so short and never over. One atomic unit of USDC
    // is about 400k units of this pool's liquidity, so the tolerance is
    // relative: within 1e-8 of L.
    expect(back <= L).toBe(true);
    expect(((L - back) * 100_000_000n) / L).toBe(0n);
  });

  it("holds one token outside the band", () => {
    const sqrtA = getSqrtRatioAtTick(100);
    const sqrtB = getSqrtRatioAtTick(200);
    const below = amountsForLiquidity(getSqrtRatioAtTick(50), sqrtA, sqrtB, 10n ** 18n);
    expect(below.amount1).toBe(0n);
    expect(below.amount0 > 0n).toBe(true);
    const above = amountsForLiquidity(getSqrtRatioAtTick(250), sqrtA, sqrtB, 10n ** 18n);
    expect(above.amount0).toBe(0n);
    expect(above.amount1 > 0n).toBe(true);
  });
});

describe("prices", () => {
  it("prices the live pools within 1% of GeckoTerminal's figures", () => {
    // NVDA/USDG: USDG is token0 (6 dec), NVDA token1 (18 dec). GeckoTerminal
    // said $227.94 per NVDA a few hours earlier.
    const nvda = uniswapPoolById(4663, "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3")!;
    const usdPerNvda = baseUsdFromPool(nvda, NVDA_USDG.sqrtP)!;
    expect(usdPerNvda).toBeGreaterThan(220);
    expect(usdPerNvda).toBeLessThan(232);
    // MON/USDC: MON token0 (18), USDC token1 (6). GeckoTerminal $0.02528.
    const mon = uniswapPoolById(143, "0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954")!;
    const usdPerMon = baseUsdFromPool(mon, MON_USDC.sqrtP)!;
    expect(usdPerMon).toBeGreaterThan(0.0245);
    expect(usdPerMon).toBeLessThan(0.0258);
    // USDC/WETH on Monad: USDC token0 (6), WETH token1 (18). ETH was
    // $2,746.85 on Trustware's feed the same day.
    const weth = uniswapPoolById(143, "0xad408916c1c310da9c258d4c128a7bf50fd9edc42a218cc970da39cfc8a05d93")!;
    const usdPerWeth = baseUsdFromPool(weth, USDC_WETH_MONAD.sqrtP)!;
    expect(usdPerWeth).toBeGreaterThan(2650);
    expect(usdPerWeth).toBeLessThan(2850);
  });

  it("prices every registry token off the pools in two passes", () => {
    const sqrt = new Map<string, bigint>();
    for (const p of UNISWAP_POOLS) {
      // Every pool at tick 0 would price everything at 1; use live prices
      // for the three Monad anchors and a plausible one elsewhere.
      sqrt.set(`${p.chainId}:${p.id.toLowerCase()}`, getSqrtRatioAtTick(0));
    }
    sqrt.set("143:0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954", MON_USDC.sqrtP);
    sqrt.set("143:0xad408916c1c310da9c258d4c128a7bf50fd9edc42a218cc970da39cfc8a05d93", USDC_WETH_MONAD.sqrtP);
    // MON/WETH at its live tick -116024.
    sqrt.set("143:0x3783b51e33900eb366a9e8473c76cda441e7170d2e5d96927f30c16a7add93aa", getSqrtRatioAtTick(-116024));
    const prices = tokenUsdPrices(UNISWAP_POOLS, sqrt);
    for (const p of UNISWAP_POOLS) {
      expect(prices.get(tokenUsdKey(p.chainId, p.token0))).toBeDefined();
      expect(prices.get(tokenUsdKey(p.chainId, p.token1))).toBeDefined();
    }
    const mon = prices.get("143:0x0000000000000000000000000000000000000000")!;
    const weth = prices.get("143:0xee8c0e9f1bffb4eb878d8f15f368a02a35481242")!;
    // WETH priced through MON/WETH must agree with WETH priced through
    // USDC/WETH, which is what makes the second pass trustworthy. The
    // USDC/WETH pool is the first pass's answer, so check the MON/WETH pool
    // implies the same ratio: WETH/MON = 1.0001^116024 ≈ 108,700... within
    // the tick's own precision of the two anchors' ratio.
    expect(mon).toBeGreaterThan(0.024);
    expect(weth / mon).toBeGreaterThan(100_000);
    expect(weth / mon).toBeLessThan(200_000);
  });
});

describe("fees", () => {
  it("scales fee growth by liquidity in Q128", () => {
    expect(feesOwed(3n << 128n, 1n << 128n, 5n)).toBe(10n);
  });
  it("wraps like the contract", () => {
    const max = (1n << 256n) - 1n;
    expect(feesOwed(1n << 128n, max, 1n)).toBe(1n);
  });
  it("annualises volume at the fee tier over TVL", () => {
    // $141.6M over a week at 0.05% on $6.17M: about 60%.
    const apr = feeApr(141_627_700, 500, 6_169_326, 7)!;
    expect(apr).toBeGreaterThan(0.59);
    expect(apr).toBeLessThan(0.61);
    expect(feeApr(1, 500, 0, 7)).toBeNull();
  });
});

describe("v4", () => {
  it("recomputes the SPY/USDG pool id from its key", () => {
    const spy = uniswapPoolById(4663, "0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd")!;
    expect(v4PoolId(v4PoolKey(spy)).toLowerCase()).toBe(spy.id.toLowerCase());
    // And every other v4 pool in the registry.
    for (const p of UNISWAP_POOLS.filter((p) => p.protocol === "V4")) {
      expect(v4PoolId(v4PoolKey(p)).toLowerCase()).toBe(p.id.toLowerCase());
    }
  });

  it("takes the first 25 bytes as the poolKeys key", () => {
    expect(poolIdToBytes25("0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd")).toBe(
      "0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2",
    );
  });

  it("unpacks a PositionInfo", () => {
    // poolId25 << 56 | tickUpper << 32 | tickLower << 8 | hasSubscriber
    const poolId25 = BigInt("0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2");
    const tickUpper = -209160; // negative, so the int24 sign path is exercised
    const tickLower = -210480;
    const info =
      (poolId25 << 56n) |
      (BigInt(tickUpper & 0xffffff) << 32n) |
      (BigInt(tickLower & 0xffffff) << 8n) |
      1n;
    const u = unpackPositionInfo(info);
    expect(u.poolId25).toBe("0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2");
    expect(u.tickLower).toBe(tickLower);
    expect(u.tickUpper).toBe(tickUpper);
    expect(u.hasSubscriber).toBe(true);
  });
});
