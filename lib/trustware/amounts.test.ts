import { describe, expect, it } from "vitest";

import {
  addBps,
  atomicToUi,
  rescaleAtomic,
  toNumberOrNull,
  uiToAtomic,
} from "./amounts";

// Every Trustware amount crosses the wire as an atomic decimal string, and the
// two sides of a conversion do not share a scale: EVM Ondo/xStock tokens are 18
// decimals, Solana xStocks are 8, and the gold tokens are 6. The module exists
// so none of that goes through a float. These tests pin the two properties that
// make it safe: truncation is always DOWNWARD (we can never ask for more than
// the user has), and no value ever round-trips through Number.

describe("uiToAtomic", () => {
  it("scales a decimal string by the token's decimals", () => {
    expect(uiToAtomic("1.25", 8)).toBe("125000000");
    expect(uiToAtomic("1", 8)).toBe("100000000");
    expect(uiToAtomic("0.00000001", 8)).toBe("1");
  });

  it("handles the three scales this app actually uses", () => {
    expect(uiToAtomic("1", 6)).toBe("1000000"); // XAUt, USDC, USDT
    expect(uiToAtomic("1", 8)).toBe("100000000"); // Solana xStocks
    expect(uiToAtomic("1", 18)).toBe("1000000000000000000"); // EVM equivalents
  });

  it("truncates excess precision instead of rounding up", () => {
    // The stated contract: never ask for more than the user has. "1.999…" at 2
    // decimals is 1.99, not 2.00.
    expect(uiToAtomic("1.999999", 2)).toBe("199");
    expect(uiToAtomic("0.999999999", 8)).toBe("99999999");
    // Even a value that would round up to the next whole unit stays below it.
    expect(uiToAtomic("0.99999999999999999999", 8)).toBe("99999999");
  });

  it("returns a canonical zero rather than an empty string", () => {
    // The leading-zero strip would otherwise leave "" for these.
    expect(uiToAtomic("0", 8)).toBe("0");
    expect(uiToAtomic("0.0", 8)).toBe("0");
    expect(uiToAtomic("0.000000001", 8)).toBe("0"); // truncated away entirely
  });

  it("strips leading zeros without eating significant digits", () => {
    expect(uiToAtomic("007.5", 2)).toBe("750");
    expect(uiToAtomic("0.05", 2)).toBe("5");
  });

  it("handles zero decimals", () => {
    expect(uiToAtomic("42", 0)).toBe("42");
    expect(uiToAtomic("42.9", 0)).toBe("42");
  });

  it("accepts a number by fixing it at the token's precision first", () => {
    expect(uiToAtomic(1.25, 8)).toBe("125000000");
    // toFixed(decimals) is what keeps a float's binary tail out of the result.
    expect(uiToAtomic(0.1 + 0.2, 8)).toBe("30000000");
  });

  it("survives amounts far beyond Number.MAX_SAFE_INTEGER", () => {
    // 1e9 tokens at 18 decimals is 1e27 atomic units. A float loses this
    // outright; the whole module exists for this case.
    expect(uiToAtomic("1000000000", 18)).toBe(
      "1000000000000000000000000000",
    );
    // And the low digits survive alongside the high ones.
    expect(uiToAtomic("123456789.123456789123456789", 18)).toBe(
      "123456789123456789123456789",
    );
  });

  it("rejects anything that is not a plain decimal", () => {
    expect(() => uiToAtomic("", 8)).toThrow(/Not a decimal amount/);
    expect(() => uiToAtomic("-1", 8)).toThrow(/Not a decimal amount/);
    expect(() => uiToAtomic("1e18", 8)).toThrow(/Not a decimal amount/);
    expect(() => uiToAtomic("1.2.3", 8)).toThrow(/Not a decimal amount/);
    expect(() => uiToAtomic("abc", 8)).toThrow(/Not a decimal amount/);
    expect(() => uiToAtomic("1,000", 8)).toThrow(/Not a decimal amount/);
    expect(() => uiToAtomic(".5", 8)).toThrow(/Not a decimal amount/);
    expect(() => uiToAtomic("NaN", 8)).toThrow(/Not a decimal amount/);
  });

  it("tolerates surrounding whitespace", () => {
    expect(uiToAtomic("  1.25  ", 8)).toBe("125000000");
  });
});

describe("atomicToUi", () => {
  it("is the inverse of uiToAtomic for representable values", () => {
    expect(atomicToUi("125000000", 8)).toBe("1.25");
    expect(atomicToUi("100000000", 8)).toBe("1");
    expect(atomicToUi("1", 8)).toBe("0.00000001");
  });

  it("pads a value shorter than its own scale", () => {
    expect(atomicToUi("5", 8)).toBe("0.00000005");
    expect(atomicToUi("0", 8)).toBe("0");
  });

  it("trims trailing zeros but keeps the integer part", () => {
    expect(atomicToUi("120000000", 8)).toBe("1.2");
    expect(atomicToUi("100000000", 8)).toBe("1");
    expect(atomicToUi("1000000000", 8)).toBe("10");
  });

  it("passes through unchanged at zero decimals", () => {
    expect(atomicToUi("42", 0)).toBe("42");
  });

  it("round-trips the scales in use", () => {
    for (const [ui, decimals] of [
      ["1.25", 8],
      ["0.000001", 6],
      ["1234.56789", 18],
      ["0.00000001", 8],
    ] as const) {
      expect(atomicToUi(uiToAtomic(ui, decimals), decimals)).toBe(ui);
    }
  });

  it("survives 18-decimal magnitudes without a float", () => {
    expect(atomicToUi("123456789123456789123456789", 18)).toBe(
      "123456789.123456789123456789",
    );
  });

  it("rejects a non-decimal input", () => {
    expect(() => atomicToUi("-5", 8)).toThrow(/Not a decimal amount/);
    expect(() => atomicToUi("0x10", 8)).toThrow(/Not a decimal amount/);
  });
});

describe("rescaleAtomic", () => {
  it("is identity when the scales match", () => {
    expect(rescaleAtomic("12345", 8, 8)).toBe("12345");
    // Normalises leading zeros on the way through.
    expect(rescaleAtomic("0012345", 8, 8)).toBe("12345");
  });

  it("scales up exactly, the Solana-to-EVM direction", () => {
    // An 8-decimal xStock amount expressed in its 18-decimal EVM equivalent.
    expect(rescaleAtomic("125000000", 8, 18)).toBe("1250000000000000000");
  });

  it("truncates when scaling down, the EVM-to-Solana direction", () => {
    // 18 -> 8 discards ten digits, and must discard them downward.
    expect(rescaleAtomic("1250000000000000000", 18, 8)).toBe("125000000");
    // The dust below the target scale is dropped, never rounded up.
    expect(rescaleAtomic("1259999999999999999", 18, 8)).toBe("125999999");
    expect(rescaleAtomic("9999999999", 18, 8)).toBe("0");
  });

  it("round-trips down-then-up as a loss, never a gain", () => {
    const original = "1259999999999999999";
    const down = rescaleAtomic(original, 18, 8);
    const backUp = rescaleAtomic(down, 8, 18);
    expect(BigInt(backUp)).toBeLessThan(BigInt(original));
  });

  it("handles the 6-decimal gold tokens", () => {
    expect(rescaleAtomic("1000000", 6, 18)).toBe("1000000000000000000");
    expect(rescaleAtomic("1000000000000000000", 18, 6)).toBe("1000000");
  });

  it("rejects a non-decimal input", () => {
    expect(() => rescaleAtomic("-1", 18, 8)).toThrow(/Not a decimal amount/);
  });
});

describe("addBps", () => {
  it("adds headroom on top of a quoted amount", () => {
    expect(addBps("1000000", 100)).toBe("1010000"); // +1%
    expect(addBps("1000000", 50)).toBe("1005000"); // +0.5%
  });

  it("is identity at zero bps", () => {
    expect(addBps("1234567", 0)).toBe("1234567");
  });

  it("floors the result rather than rounding it up", () => {
    // 1 * 10001 / 10000 = 1.0001 -> 1. Headroom never invents an atomic unit.
    expect(addBps("1", 1)).toBe("1");
    expect(addBps("9999", 1)).toBe("9999");
  });

  it("accepts negative bps as a haircut", () => {
    expect(addBps("1000000", -100)).toBe("990000");
  });

  it("stays exact at 18-decimal magnitudes", () => {
    expect(addBps("1000000000000000000", 30)).toBe("1003000000000000000");
  });

  it("rejects a non-decimal input", () => {
    expect(() => addBps("abc", 100)).toThrow(/Not a decimal amount/);
  });
});

describe("toNumberOrNull", () => {
  it("passes a number through", () => {
    expect(toNumberOrNull(12.5)).toBe(12.5);
    expect(toNumberOrNull(0)).toBe(0);
  });

  it("parses a numeric string", () => {
    expect(toNumberOrNull("12.5")).toBe(12.5);
    expect(toNumberOrNull("0")).toBe(0);
  });

  it("returns null for absent or empty values", () => {
    expect(toNumberOrNull(undefined)).toBeNull();
    expect(toNumberOrNull("")).toBeNull();
  });

  it("returns null rather than NaN for junk", () => {
    // A NaN leaking into a USD field renders as "NaN" in the UI; null is a
    // value the callers already branch on.
    expect(toNumberOrNull("abc")).toBeNull();
    expect(toNumberOrNull(Number.NaN)).toBeNull();
    expect(toNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
