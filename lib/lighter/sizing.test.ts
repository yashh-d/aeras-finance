import { describe, expect, it } from "vitest";

import {
  computeHedgeSize,
  computeOrderSize,
  formatDecimal,
  minimumFillableNotional,
  parseDecimal,
  slippageBoundPrice,
  toWireInteger,
  type MarketLimits,
} from "./sizing";

// This module turns "I hold 12 SPYx" into an order Lighter will accept, and the
// header names the three ways that goes wrong: per-market decimals, sizing by
// share count instead of USD notional, and two independent minimums either of
// which can bind first. The tests below are organised around those three.
//
// SPY on Lighter: 4 size decimals, 0.01 min base, $10 min quote. The price is
// the one the module's own worked example uses, so the documented arithmetic
// ($10 -> 0.0131 SPY -> $9.96) is reproducible here.
const SPY: MarketLimits = {
  marketPriceUsd: "760.25",
  sizeDecimals: 4,
  minBaseAmount: "0.01",
  minQuoteAmount: "10",
  orderQuoteLimit: "100000",
};

// AAPL takes 3 size decimals, per the module header. Same minimums, coarser
// increment: the pair exists to prove the increment is read per market.
const AAPL: MarketLimits = {
  marketPriceUsd: "232.40",
  sizeDecimals: 3,
  minBaseAmount: "0.01",
  minQuoteAmount: "10",
  orderQuoteLimit: "100000",
};

describe("parseDecimal / formatDecimal", () => {
  it("round-trips values at 18-decimal scale", () => {
    for (const v of ["0", "1", "1.5", "0.000000000000000001", "123456.789"]) {
      expect(formatDecimal(parseDecimal(v))).toBe(v);
    }
  });

  it("normalises equivalent spellings", () => {
    expect(formatDecimal(parseDecimal("1.50"))).toBe("1.5");
    expect(formatDecimal(parseDecimal("01"))).toBe("1");
    expect(formatDecimal(parseDecimal("1."))).toBe("1");
    expect(formatDecimal(parseDecimal(".5"))).toBe("0.5");
  });

  it("handles negatives on both sides", () => {
    expect(formatDecimal(parseDecimal("-2.25"))).toBe("-2.25");
    expect(parseDecimal("-1")).toBe(-(10n ** 18n));
  });

  it("truncates precision beyond 18 decimals rather than throwing", () => {
    expect(formatDecimal(parseDecimal("0.0000000000000000019"))).toBe(
      "0.000000000000000001",
    );
  });

  it("tolerates whitespace and rejects junk", () => {
    expect(formatDecimal(parseDecimal("  1.5  "))).toBe("1.5");
    for (const bad of ["", "abc", "1e5", "1.2.3", "1,000", "0x10"]) {
      expect(() => parseDecimal(bad)).toThrow(/Not a decimal number/);
    }
  });
});

describe("toWireInteger", () => {
  it("scales by the market's own size decimals", () => {
    // The same value is a different integer on each market. Getting this
    // backwards is an order off by a factor of ten.
    expect(toWireInteger("0.0131", 4)).toBe("131");
    expect(toWireInteger("0.0131", 3)).toBe("13");
    expect(toWireInteger("1", 4)).toBe("10000");
    expect(toWireInteger("1", 3)).toBe("1000");
  });

  it("truncates a value finer than the increment", () => {
    expect(toWireInteger("0.01319", 4)).toBe("131");
  });

  it("refuses a negative value", () => {
    expect(() => toWireInteger("-1", 4)).toThrow(/Cannot send a negative/);
  });

  it("rejects decimals outside the supported range", () => {
    expect(() => toWireInteger("1", -1)).toThrow(/Unsupported decimals/);
    expect(() => toWireInteger("1", 19)).toThrow(/Unsupported decimals/);
  });
});

describe("computeOrderSize", () => {
  it("reproduces the documented $10-of-SPY case, and refuses it", () => {
    // The module's own worked example: $10 of SPY is 0.01315357 SPY, floored to
    // 0.0131, worth $9.96, which is under the $10 minimum. Every market carries
    // a $10 minimum, so $10 is the figure a user is most likely to type and the
    // one that can never fill. Returning zero with a reason beats sending an
    // order the exchange rejects.
    const sized = computeOrderSize({ notionalUsd: "10", ...SPY });

    expect(sized.limitedBy).toBe("below-min-notional");
    expect(sized.size).toBe("0");
    expect(sized.baseAmount).toBe("0");
    expect(sized.notionalUsd).toBe("0");
    // The requested figure is still reported back, so the UI can say what was
    // asked for as well as why it was refused.
    expect(sized.targetNotionalUsd).toBe("10");
  });

  it("fills just above the documented refusal point", () => {
    const sized = computeOrderSize({ notionalUsd: "10.04", ...SPY });
    expect(sized.limitedBy).toBe("none");
    expect(sized.size).toBe("0.0132");
    expect(sized.baseAmount).toBe("132");
    expect(sized.notionalUsd).toBe("10.0353");
  });

  it("floors the size to the increment, never up", () => {
    // A hedge or trade that rounds up commits money that was not asked for.
    const sized = computeOrderSize({ notionalUsd: "1000", ...SPY });
    expect(sized.size).toBe("1.3153");
    expect(Number(sized.notionalUsd)).toBeLessThanOrEqual(1000);
  });

  it("reads the increment from the market, not from a constant", () => {
    const spy = computeOrderSize({ notionalUsd: "1000", ...SPY });
    const aapl = computeOrderSize({ notionalUsd: "1000", ...AAPL });
    // 4 decimals against 3: the AAPL size has one fewer place.
    expect(spy.size.split(".")[1]).toHaveLength(4);
    expect(aapl.size).toBe("4.302");
    expect(aapl.baseAmount).toBe("4302");
  });

  it("clamps to the per-order quote limit before sizing", () => {
    const capped = computeOrderSize({
      notionalUsd: "500000",
      ...SPY,
      orderQuoteLimit: "50000",
    });
    expect(capped.limitedBy).toBe("quote-limit");
    // Sized against the cap, not against the request.
    expect(Number(capped.notionalUsd)).toBeLessThanOrEqual(50_000);
    expect(Number(capped.notionalUsd)).toBeGreaterThan(49_990);
    // The original ask is preserved for display.
    expect(capped.targetNotionalUsd).toBe("500000");
  });

  it("ignores a zero quote limit as 'no limit'", () => {
    const sized = computeOrderSize({
      notionalUsd: "500000",
      ...SPY,
      orderQuoteLimit: "0",
    });
    expect(sized.limitedBy).toBe("none");
    expect(Number(sized.notionalUsd)).toBeGreaterThan(499_000);
  });

  it("refuses a size under the base minimum", () => {
    // A market where the base minimum binds before the quote minimum: raise
    // min_base so a $12 order is under it.
    const sized = computeOrderSize({
      notionalUsd: "12",
      ...SPY,
      minBaseAmount: "1",
      minQuoteAmount: "1",
    });
    expect(sized.limitedBy).toBe("below-min-size");
    expect(sized.size).toBe("0");
  });

  it("checks both minimums, not just whichever is usually tighter", () => {
    // Below the base minimum AND below the quote minimum: the base check runs
    // first, so that is the reason reported.
    const sized = computeOrderSize({ notionalUsd: "1", ...SPY });
    expect(sized.limitedBy).toBe("below-min-size");
  });

  it("refuses a notional that rounds away to nothing", () => {
    const sized = computeOrderSize({ notionalUsd: "0.0001", ...SPY });
    expect(sized.size).toBe("0");
    expect(sized.limitedBy).toBe("below-min-size");
  });

  it("throws on a non-positive notional rather than silently zeroing", () => {
    // A caller previewing an order as the user types has to guard its own
    // input; a silent zero would look like a market limit.
    expect(() => computeOrderSize({ notionalUsd: "0", ...SPY })).toThrow(
      /must be positive/,
    );
    expect(() => computeOrderSize({ notionalUsd: "-5", ...SPY })).toThrow(
      /must be positive/,
    );
  });

  it("throws on an unpriced market rather than sizing against nothing", () => {
    expect(() =>
      computeOrderSize({ notionalUsd: "100", ...SPY, marketPriceUsd: "0" }),
    ).toThrow(/no usable price/);
  });
});

describe("minimumFillableNotional", () => {
  it("is above min_quote_amount, which is the whole point", () => {
    // Sizing floors, so a notional sitting exactly on the $10 minimum rounds
    // down through it. The smallest fillable order is therefore strictly more
    // than the minimum the exchange advertises.
    const min = minimumFillableNotional(SPY);
    expect(min).toBe("10.0353");
    expect(Number(min)).toBeGreaterThan(Number(SPY.minQuoteAmount));
  });

  it("names a notional that actually fills", () => {
    // The contract that matters: whatever this returns must survive a round
    // trip through computeOrderSize without being refused.
    for (const market of [SPY, AAPL]) {
      const min = minimumFillableNotional(market);
      const sized = computeOrderSize({ notionalUsd: min, ...market });
      expect(sized.limitedBy).toBe("none");
      expect(sized.size).not.toBe("0");
      expect(Number(sized.notionalUsd)).toBeGreaterThanOrEqual(
        Number(market.minQuoteAmount),
      );
    }
  });

  it("is the boundary: one increment less does not fill", () => {
    const min = Number(minimumFillableNotional(SPY));
    // A cent under the computed minimum rounds down to the previous increment,
    // whose value falls under the quote minimum again.
    const below = computeOrderSize({
      notionalUsd: (min - 0.01).toFixed(4),
      ...SPY,
    });
    expect(below.limitedBy).toBe("below-min-notional");
  });

  it("respects a base minimum that binds above the quote minimum", () => {
    // A market where 0.01 base is worth far more than $10: the base minimum
    // decides, and the answer is its value rather than the quote floor.
    const min = minimumFillableNotional({
      ...SPY,
      minBaseAmount: "1",
    });
    expect(Number(min)).toBeCloseTo(760.25, 2);
  });

  it("throws on an unpriced market", () => {
    expect(() =>
      minimumFillableNotional({ ...SPY, marketPriceUsd: "0" }),
    ).toThrow(/no usable price/);
  });
});

describe("computeHedgeSize", () => {
  const holding = { quantity: "12", tokenPriceUsd: "760.25" };

  it("sizes a full hedge by notional and reports the exposure", () => {
    const hedge = computeHedgeSize({ ...holding, hedgeRatio: 1, ...SPY });
    expect(hedge.exposureNotionalUsd).toBe("9123"); // 12 * 760.25
    expect(hedge.limitedBy).toBe("none");
    expect(Number(hedge.notionalUsd)).toBeLessThanOrEqual(9123);
    expect(hedge.effectiveRatio).toBeCloseTo(1, 4);
  });

  it("never opens a position larger than the exposure it offsets", () => {
    // The stated reason sizing floors: a hedge that rounds up is a net short.
    for (const ratio of [0.1, 0.25, 1 / 3, 0.5, 0.75, 1]) {
      const hedge = computeHedgeSize({ ...holding, hedgeRatio: ratio, ...SPY });
      expect(Number(hedge.notionalUsd)).toBeLessThanOrEqual(
        Number(hedge.targetNotionalUsd),
      );
      expect(hedge.effectiveRatio).toBeLessThanOrEqual(ratio + 1e-9);
    }
  });

  it("sizes by USD notional, not by share count", () => {
    // The GLDx case from the module header: the token is hedged against a perp
    // marking at roughly eleven times its price. Sizing by share count would
    // open a position eleven times too large; sizing by notional needs no
    // per-market correction factor.
    const hedge = computeHedgeSize({
      quantity: "10",
      tokenPriceUsd: "70",
      hedgeRatio: 1,
      ...SPY,
      marketPriceUsd: "770", // 11x the token price
      minBaseAmount: "0.0001",
    });
    // $700 of exposure hedged with $700 of perp, i.e. ~0.909 units, not 10.
    expect(hedge.exposureNotionalUsd).toBe("700");
    expect(Number(hedge.size)).toBeCloseTo(0.909, 2);
    expect(Number(hedge.notionalUsd)).toBeCloseTo(700, 0);
  });

  it("reports the achieved ratio, not the requested one, when a cap binds", () => {
    const hedge = computeHedgeSize({
      quantity: "1000",
      tokenPriceUsd: "760.25",
      hedgeRatio: 1,
      ...SPY,
      orderQuoteLimit: "50000",
    });
    expect(hedge.limitedBy).toBe("quote-limit");
    // 50k of a 760k exposure.
    expect(hedge.effectiveRatio).toBeCloseTo(50_000 / 760_250, 3);
    expect(hedge.effectiveRatio).toBeLessThan(1);
  });

  it("keeps a float ratio from carrying binary noise into the size", () => {
    // 1/3 is not representable; the module fixes the ratio at 6 decimals first.
    const hedge = computeHedgeSize({ ...holding, hedgeRatio: 1 / 3, ...SPY });
    expect(hedge.targetNotionalUsd).toBe("3040.996959"); // 9123 * 0.333333
    expect(Number(hedge.notionalUsd)).toBeLessThanOrEqual(3041);
  });

  it("refuses a hedge too small, with the USD minimum binding first", () => {
    // Exactly the case the module header calls out: min_base_amount is 0.01
    // SPY, worth about $7.60 here, while min_quote_amount is $10. A hedge of
    // 0.01 SPY therefore CLEARS the base minimum and is still refused on the
    // quote minimum. Which of the two binds is the thing the UI has to explain,
    // so the reason code matters as much as the refusal.
    const hedge = computeHedgeSize({
      quantity: "0.01",
      tokenPriceUsd: "760.25",
      hedgeRatio: 1,
      ...SPY,
    });
    expect(hedge.size).toBe("0");
    expect(hedge.effectiveRatio).toBe(0);
    expect(hedge.limitedBy).toBe("below-min-notional");
    // The exposure is still reported so the UI can explain the shortfall.
    expect(hedge.exposureNotionalUsd).toBe("7.6025");
  });

  it("rejects a ratio outside (0, 1]", () => {
    for (const ratio of [0, -0.5, 1.5, Number.NaN]) {
      expect(() =>
        computeHedgeSize({ ...holding, hedgeRatio: ratio, ...SPY }),
      ).toThrow(/Hedge ratio must be between 0 and 1/);
    }
  });

  it("returns a zero-exposure hedge as zero rather than dividing by it", () => {
    const hedge = computeHedgeSize({
      quantity: "0",
      tokenPriceUsd: "760.25",
      hedgeRatio: 1,
      ...SPY,
    });
    expect(hedge.exposureNotionalUsd).toBe("0");
    expect(hedge.effectiveRatio).toBe(0);
    expect(hedge.size).toBe("0");
  });
});

describe("slippageBoundPrice", () => {
  it("puts a sell bound BELOW the mark", () => {
    // The direction that is easy to get backwards and expensive when you do: a
    // bound above the mark would let a sell fill at any price at all.
    const { price, wirePrice } = slippageBoundPrice("100", 100, true, 2);
    expect(price).toBe("99");
    expect(wirePrice).toBe("9900");
  });

  it("puts a buy bound ABOVE the mark", () => {
    const { price } = slippageBoundPrice("100", 100, false, 2);
    expect(price).toBe("101");
  });

  it("rounds outward so alignment never tightens the bound into a no-fill", () => {
    // A bound that does not land on the tick rounds down for a sell (looser)
    // and up for a buy (looser), never inward.
    const ask = slippageBoundPrice("760.25", 37, true, 2);
    expect(Number(ask.price)).toBeLessThanOrEqual(760.25 * (1 - 0.0037));
    const bid = slippageBoundPrice("760.25", 37, false, 2);
    expect(Number(bid.price)).toBeGreaterThanOrEqual(760.25 * (1 + 0.0037));
  });

  it("is a no-op bound at zero slippage", () => {
    expect(slippageBoundPrice("100", 0, true, 2).price).toBe("100");
    expect(slippageBoundPrice("100", 0, false, 2).price).toBe("100");
  });

  it("scales the wire price by the market's price decimals", () => {
    expect(slippageBoundPrice("100", 0, true, 2).wirePrice).toBe("10000");
    expect(slippageBoundPrice("100", 0, true, 4).wirePrice).toBe("1000000");
  });

  it("rejects slippage outside 0..10000 bps", () => {
    expect(() => slippageBoundPrice("100", -1, true, 2)).toThrow(
      /Slippage out of range/,
    );
    expect(() => slippageBoundPrice("100", 10_001, true, 2)).toThrow(
      /Slippage out of range/,
    );
  });

  it("refuses a bound that collapses to zero", () => {
    // 100% slippage on a sell puts the worst acceptable fill at zero, which is
    // not a bound at all.
    expect(() => slippageBoundPrice("100", 10_000, true, 2)).toThrow(
      /collapsed to zero/,
    );
  });
});
