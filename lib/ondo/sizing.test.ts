import { describe, expect, it } from "vitest";

import {
  clampToMaxOrderSize,
  computeHedgeSize,
  computeOrderSize,
  formatDecimal,
  parseDecimal,
  type HedgeSizeInput,
} from "./sizing";

// Ondo's `size` field is base units, never USD, and the index perps are priced
// at index level rather than ETF level by a different factor each. The module
// header records both: US500-USD.P marks near 7751 against SPY's 772 (a factor
// of 10), and US100-USD.P near 29639 against QQQ's 720 (a factor of 41). Those
// are the fixtures below, along with the per-market increments and caps the
// header names.
const US500 = {
  marketPriceUsd: "7751",
  baseIncrement: "0.001",
  maxPositionBaseSize: "50",
};

const US100 = {
  marketPriceUsd: "29639",
  baseIncrement: "0.0001",
  maxPositionBaseSize: "1.5",
};

const SPY_TOKEN_PRICE = "772";
const QQQ_TOKEN_PRICE = "720";

function hedge(input: Partial<HedgeSizeInput> = {}) {
  return computeHedgeSize({
    quantity: "12",
    tokenPriceUsd: SPY_TOKEN_PRICE,
    hedgeRatio: 1,
    ...US500,
    ...input,
  });
}

describe("parseDecimal / formatDecimal", () => {
  it("round-trips at 18-decimal scale", () => {
    for (const v of ["0", "1", "0.0001", "29639", "1.5"]) {
      expect(formatDecimal(parseDecimal(v))).toBe(v);
    }
  });

  it("normalises equivalent spellings and handles negatives", () => {
    expect(formatDecimal(parseDecimal("1.50"))).toBe("1.5");
    expect(formatDecimal(parseDecimal(".5"))).toBe("0.5");
    expect(formatDecimal(parseDecimal("-2.25"))).toBe("-2.25");
  });

  it("rejects junk", () => {
    for (const bad of ["", "abc", "1e5", "1.2.3"]) {
      expect(() => parseDecimal(bad)).toThrow(/Not a decimal number/);
    }
  });
});

describe("computeHedgeSize", () => {
  it("sizes by notional, not by share count", () => {
    // 12 SPYx at $772 is $9,264 of exposure. Against a perp marking at 7751
    // that is ~1.195 base units. Sizing by share count would send 12 units,
    // worth $93,012: ten times the exposure, and there is no single constant
    // that corrects it across markets, which is why notional sizing exists.
    const h = hedge();
    expect(h.exposureNotionalUsd).toBe("9264");
    expect(h.size).toBe("1.195");
    expect(Number(h.notionalUsd)).toBeCloseTo(9262.445, 3);
    expect(h.limitedBy).toBe("none");
    // The share-count mistake, stated as the thing this must not do.
    expect(Number(h.size)).toBeLessThan(12);
  });

  it("uses each market's own increment", () => {
    const onUs500 = hedge();
    const onUs100 = hedge({
      tokenPriceUsd: QQQ_TOKEN_PRICE,
      ...US100,
    });
    // 0.001 against 0.0001: the finer market keeps an extra place.
    expect(onUs500.size).toBe("1.195");
    expect(onUs100.size).toBe("0.2915"); // 12 * 720 / 29639, floored to 1e-4
  });

  it("floors to the increment so a hedge never becomes a net short", () => {
    for (const ratio of [0.1, 0.25, 1 / 3, 0.5, 0.75, 1]) {
      const h = hedge({ hedgeRatio: ratio });
      expect(Number(h.notionalUsd)).toBeLessThanOrEqual(
        Number(h.targetNotionalUsd),
      );
      expect(h.effectiveRatio).toBeLessThanOrEqual(ratio + 1e-9);
    }
  });

  it("caps at maxPositionBaseSize, which binds hardest on US100", () => {
    // The header's point: 1.5 base units on US100 is roughly $44k, so a Nasdaq
    // hedge hits the cap at a size a holder could plausibly reach, while the
    // 50-unit US500 cap sits near $388k.
    const capped = computeHedgeSize({
      quantity: "100",
      tokenPriceUsd: QQQ_TOKEN_PRICE,
      hedgeRatio: 1,
      ...US100,
    });
    expect(capped.limitedBy).toBe("market-cap");
    expect(capped.size).toBe("1.5");
    expect(Number(capped.notionalUsd)).toBeCloseTo(44_458.5, 1);
    // A $72,000 exposure only 62% offset, and the UI must show the achieved
    // ratio rather than the requested 1.
    expect(capped.exposureNotionalUsd).toBe("72000");
    expect(capped.effectiveRatio).toBeCloseTo(44_458.5 / 72_000, 6);
    expect(capped.effectiveRatio).toBeLessThan(1);
  });

  it("puts the US500 cap an order of magnitude higher", () => {
    const capped = computeHedgeSize({
      quantity: "1000",
      tokenPriceUsd: SPY_TOKEN_PRICE,
      hedgeRatio: 1,
      ...US500,
    });
    expect(capped.limitedBy).toBe("market-cap");
    expect(capped.size).toBe("50");
    expect(Number(capped.notionalUsd)).toBeCloseTo(387_550, 0);
  });

  it("treats a zero cap as no cap", () => {
    const h = hedge({ quantity: "1000", maxPositionBaseSize: "0" });
    expect(h.limitedBy).toBe("none");
    expect(Number(h.size)).toBeGreaterThan(50);
  });

  it("reports a hedge that rounds away as below-increment", () => {
    const h = hedge({ quantity: "0.0001" });
    expect(h.size).toBe("0");
    expect(h.notionalUsd).toBe("0");
    expect(h.limitedBy).toBe("below-increment");
    expect(h.effectiveRatio).toBe(0);
    // The exposure survives so the UI can say how far short it fell.
    expect(h.exposureNotionalUsd).toBe("0.0772");
  });

  it("prefers market-cap over below-increment when a cap zeroes the size", () => {
    // A cap finer than the increment floors to nothing. The reason reported is
    // still the cap, because that is what actually decided it.
    const h = hedge({ quantity: "1000", maxPositionBaseSize: "0.0005" });
    expect(h.size).toBe("0");
    expect(h.limitedBy).toBe("market-cap");
  });

  it("keeps a float ratio from carrying binary noise into the size", () => {
    const h = hedge({ hedgeRatio: 1 / 3 });
    expect(h.targetNotionalUsd).toBe("3087.996912"); // 9264 * 0.333333
  });

  it("rejects a ratio outside (0, 1]", () => {
    for (const ratio of [0, -0.5, 1.5, Number.NaN]) {
      expect(() => hedge({ hedgeRatio: ratio })).toThrow(
        /Hedge ratio must be between 0 and 1/,
      );
    }
  });

  it("throws on an unpriced market rather than sizing against nothing", () => {
    expect(() => hedge({ marketPriceUsd: "0" })).toThrow(/no usable price/);
  });

  it("returns zero for a zero holding without dividing by it", () => {
    const h = hedge({ quantity: "0" });
    expect(h.exposureNotionalUsd).toBe("0");
    expect(h.effectiveRatio).toBe(0);
    expect(h.size).toBe("0");
  });
});

describe("computeOrderSize", () => {
  it("sizes a dollar-entered trade the same way a hedge is sized", () => {
    // Same arithmetic entered from the other end: no holding, just an amount.
    const order = computeOrderSize({ notionalUsd: "9264", ...US500 });
    const asHedge = hedge();
    expect(order.size).toBe(asHedge.size);
    expect(order.notionalUsd).toBe(asHedge.notionalUsd);
    expect(order.requestedNotionalUsd).toBe("9264");
    expect(order.limitedBy).toBe("none");
  });

  it("rounds down, so a trade is never larger than requested", () => {
    const order = computeOrderSize({ notionalUsd: "10000", ...US500 });
    expect(Number(order.notionalUsd)).toBeLessThanOrEqual(10_000);
  });

  it("applies the same market cap", () => {
    const order = computeOrderSize({ notionalUsd: "500000", ...US100 });
    expect(order.limitedBy).toBe("market-cap");
    expect(order.size).toBe("1.5");
  });

  it("reports a sub-increment order as below-increment", () => {
    const order = computeOrderSize({ notionalUsd: "1", ...US500 });
    expect(order.size).toBe("0");
    expect(order.limitedBy).toBe("below-increment");
  });

  it("returns zero for a non-positive notional rather than throwing", () => {
    // Deliberately different from lib/lighter/sizing.ts, whose computeOrderSize
    // throws on the same input. Pinned because the two venues share a ticket UI
    // and a caller that guards one is not guarding the other.
    expect(computeOrderSize({ notionalUsd: "0", ...US500 }).size).toBe("0");
    expect(computeOrderSize({ notionalUsd: "0", ...US500 }).limitedBy).toBe(
      "below-increment",
    );
    expect(computeOrderSize({ notionalUsd: "-100", ...US500 }).size).toBe("0");
  });

  it("throws on an unpriced market", () => {
    expect(() =>
      computeOrderSize({ notionalUsd: "100", ...US500, marketPriceUsd: "0" }),
    ).toThrow(/no usable price/);
  });
});

describe("clampToMaxOrderSize", () => {
  it("leaves a size within the allowance untouched", () => {
    const { size, clamped } = clampToMaxOrderSize("1.195", "5", "0.001");
    expect(clamped).toBe(false);
    // Returned verbatim, not re-formatted.
    expect(size).toBe("1.195");
  });

  it("clamps a size above the allowance down to it", () => {
    const { size, clamped } = clampToMaxOrderSize("10", "2.5", "0.001");
    expect(clamped).toBe(true);
    expect(size).toBe("2.5");
  });

  it("floors the allowance to the increment before comparing", () => {
    // An allowance off the tick cannot be sent as-is.
    const { size, clamped } = clampToMaxOrderSize("10", "2.55555", "0.001");
    expect(clamped).toBe(true);
    expect(size).toBe("2.555");
  });

  it("passes a size equal to the allowance through unclamped", () => {
    const { size, clamped } = clampToMaxOrderSize("2.5", "2.5", "0.001");
    expect(clamped).toBe(false);
    expect(size).toBe("2.5");
  });

  it("treats a zero or sub-increment allowance as no clamp at all", () => {
    // Ondo returns max_order_size from live margin. Zero here means "no
    // ceiling reported", not "send nothing": the caller's own sizing already
    // bounded the order, and this would otherwise zero every order.
    expect(clampToMaxOrderSize("1.195", "0", "0.001").clamped).toBe(false);
    expect(clampToMaxOrderSize("1.195", "0.0001", "0.001").clamped).toBe(false);
  });
});
