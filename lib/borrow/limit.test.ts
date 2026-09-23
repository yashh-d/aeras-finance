import { describe, expect, it } from "vitest";

import {
  atomicToNumber,
  availableToBorrowAtomic,
  borrowLimitAtomic,
  ltvBpsFromDecimal,
  ltvBpsFromPerMille,
  parseScaled,
  priceFromDecimal,
  priceFromJupiterOracle,
  PRICE_SCALE,
  totalBorrowLimitAtomic,
  type CollateralInput,
} from "./limit";

const XSTOCK_DECIMALS = 8;
const USDC_DECIMALS = 6;

// GOOGLx on Kamino: maxLtv 0.6, read live from the reserves metrics endpoint on
// 2026-09-22. The position that surfaced the double-count bug.
function googlx(tokens: string, priceUsd = "250"): CollateralInput {
  return {
    atomic: parseScaled(tokens, XSTOCK_DECIMALS),
    decimals: XSTOCK_DECIMALS,
    priceScaled: priceFromDecimal(priceUsd),
    ltvBps: ltvBpsFromDecimal("0.6"),
  };
}

describe("parseScaled", () => {
  it("is exact where a float would not be", () => {
    // 0.1 + 0.2 territory. The scaled integer is the whole point.
    expect(parseScaled("0.07", 8)).toBe(7_000_000n);
    expect(parseScaled("1234.5678", 8)).toBe(123_456_780_000n);
    expect(parseScaled("0", 8)).toBe(0n);
  });

  it("truncates past the scale rather than rounding", () => {
    // Every rounding in this module goes the same way: down.
    expect(parseScaled("1.999999999", 4)).toBe(19_999n);
  });

  it("pads a short fraction", () => {
    expect(parseScaled("2.5", 6)).toBe(2_500_000n);
  });

  it("refuses anything that is not a non-negative decimal", () => {
    expect(() => parseScaled("-1", 6)).toThrow();
    expect(() => parseScaled("1e6", 6)).toThrow();
    expect(() => parseScaled("", 6)).toThrow();
    expect(() => parseScaled("abc", 6)).toThrow();
  });
});

describe("ltv conversions", () => {
  it("reads Kamino's decimal maxLtv", () => {
    expect(ltvBpsFromDecimal("0.6")).toBe(6_000n);
    expect(ltvBpsFromDecimal("0.73")).toBe(7_300n);
    expect(ltvBpsFromDecimal("0")).toBe(0n);
  });

  it("reads Jupiter's per-mille collateralFactor", () => {
    expect(ltvBpsFromPerMille("650")).toBe(6_500n);
    expect(ltvBpsFromPerMille(750)).toBe(7_500n);
  });

  it("puts both venues on one scale", () => {
    // Kamino 0.65 and Jupiter 650 are the same ratio and must compare equal.
    expect(ltvBpsFromDecimal("0.65")).toBe(ltvBpsFromPerMille("650"));
  });
});

describe("borrowLimitAtomic", () => {
  it("computes the limit the protocol would", () => {
    // 2 GOOGLx at $250 is $500 of collateral; at 60% max LTV, $300.
    const limit = borrowLimitAtomic(googlx("2"), USDC_DECIMALS);
    expect(limit).toBe(300_000_000n);
    expect(atomicToNumber(limit, USDC_DECIMALS)).toBe(300);
  });

  it("is zero for no collateral", () => {
    expect(borrowLimitAtomic(googlx("0"), USDC_DECIMALS)).toBe(0n);
  });

  it("floors rather than rounding to nearest", () => {
    // A limit that rounds up is a transaction that fails simulation, so the
    // fractional atomic unit is always dropped.
    const odd = googlx("0.00000001", "333.333333333333");
    const limit = borrowLimitAtomic(odd, USDC_DECIMALS);
    // 1e-8 tokens x $333.333... x 0.6 = $0.0000019999... -> 1 atomic unit.
    expect(limit).toBe(1n);
  });

  it("does not lose precision to an early division", () => {
    // One atomic unit of an 8-decimal stock is far below one atomic unit of
    // USDC in value at most prices. Dividing before multiplying would zero the
    // whole position out.
    const dust: CollateralInput = {
      atomic: 1n,
      decimals: XSTOCK_DECIMALS,
      priceScaled: priceFromDecimal("250"),
      ltvBps: ltvBpsFromDecimal("0.6"),
    };
    expect(borrowLimitAtomic(dust, USDC_DECIMALS)).toBe(1n);

    // And a whole position built from those units lands on the exact figure.
    const whole: CollateralInput = { ...dust, atomic: 200_000_000n };
    expect(borrowLimitAtomic(whole, USDC_DECIMALS)).toBe(300_000_000n);
  });

  it("handles a position far larger than a float would hold exactly", () => {
    // 10 million SPYx at $778.1465, the live mark on 2026-09-22.
    const big: CollateralInput = {
      atomic: parseScaled("10000000", XSTOCK_DECIMALS),
      decimals: XSTOCK_DECIMALS,
      priceScaled: priceFromDecimal("778.1465"),
      ltvBps: ltvBpsFromDecimal("0.73"),
    };
    // 10e6 x 778.1465 x 0.73 = 5,680,469,450 USDC exactly.
    expect(borrowLimitAtomic(big, USDC_DECIMALS)).toBe(5_680_469_450_000_000n);
  });

  it("reads a Jupiter oracle price at its published scale", () => {
    // TSLAx, live 2026-09-22: oraclePriceOperate 378.875 scaled by 1e15,
    // collateralFactor 650. One TSLAx supports $246.26875 of USDC.
    const tslax: CollateralInput = {
      atomic: parseScaled("1", XSTOCK_DECIMALS),
      decimals: XSTOCK_DECIMALS,
      priceScaled: priceFromJupiterOracle(
        (378_875n * 10n ** BigInt(PRICE_SCALE)) / 1000n,
      ),
      ltvBps: ltvBpsFromPerMille("650"),
    };
    expect(borrowLimitAtomic(tslax, USDC_DECIMALS)).toBe(246_268_750n);
  });
});

describe("totalBorrowLimitAtomic", () => {
  it("sums pools that are genuinely distinct", () => {
    // 2 GOOGLx posted at the venue, 1 more in the wallet the form will post.
    const total = totalBorrowLimitAtomic(
      [googlx("2"), googlx("1")],
      USDC_DECIMALS,
    );
    expect(total).toBe(450_000_000n);
  });

  it("is zero with no pools", () => {
    expect(totalBorrowLimitAtomic([], USDC_DECIMALS)).toBe(0n);
  });

  // The reported bug, stated as arithmetic. $500 of GOOGLx at 60% is $300 of
  // borrowing power. The app showed $600, which is that same $500 counted once
  // as deposited collateral and once as wallet stock, because the two were read
  // at different moments and the deposit had landed in only one of them.
  it("the double count, and what the right answer is", () => {
    const deposited = googlx("2"); // $500 at $250
    const stillInWallet = googlx("2"); // the same $500, read before the deposit

    const doubleCounted = totalBorrowLimitAtomic(
      [deposited, stillInWallet],
      USDC_DECIMALS,
    );
    expect(atomicToNumber(doubleCounted, USDC_DECIMALS)).toBe(600);

    const correct = totalBorrowLimitAtomic([deposited], USDC_DECIMALS);
    expect(atomicToNumber(correct, USDC_DECIMALS)).toBe(300);
  });
});

describe("availableToBorrowAtomic", () => {
  const base = {
    pools: [googlx("2")], // $300 of limit
    borrowDecimals: USDC_DECIMALS,
  };

  it("subtracts debt already drawn", () => {
    const available = availableToBorrowAtomic({
      ...base,
      debtAtomic: 100_000_000n,
    });
    expect(available).toBe(200_000_000n);
  });

  it("never goes negative when a position is over its limit", () => {
    // A price fall can put debt above the borrow limit. That is a position in
    // trouble, not a negative amount to offer.
    const available = availableToBorrowAtomic({
      ...base,
      debtAtomic: 400_000_000n,
    });
    expect(available).toBe(0n);
  });

  it("caps at the venue's undrawn liquidity", () => {
    const available = availableToBorrowAtomic({
      ...base,
      debtAtomic: 0n,
      liquidityAtomic: 50_000_000n,
    });
    expect(available).toBe(50_000_000n);
  });

  it("leaves the limit alone when liquidity is ample", () => {
    const available = availableToBorrowAtomic({
      ...base,
      debtAtomic: 0n,
      liquidityAtomic: 10_000_000_000n,
    });
    expect(available).toBe(300_000_000n);
  });

  it("reports zero rather than an amount below the venue's minimum", () => {
    // Jupiter's minimumBorrowing was $1.02 on the xStock vaults, live
    // 2026-09-22. Offering $0.40 is offering a transaction that reverts.
    const available = availableToBorrowAtomic({
      ...base,
      debtAtomic: 299_600_000n,
      minimumBorrowAtomic: 1_020_000n,
    });
    expect(available).toBe(0n);
  });

  it("allows a borrow exactly at the minimum", () => {
    const available = availableToBorrowAtomic({
      ...base,
      debtAtomic: 298_980_000n,
      minimumBorrowAtomic: 1_020_000n,
    });
    expect(available).toBe(1_020_000n);
  });

  it("is zero with no collateral at all", () => {
    expect(
      availableToBorrowAtomic({
        pools: [],
        borrowDecimals: USDC_DECIMALS,
        debtAtomic: 0n,
      }),
    ).toBe(0n);
  });
});
