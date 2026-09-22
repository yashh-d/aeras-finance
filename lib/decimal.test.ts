import { describe, expect, it } from "vitest";

import { numberToAtomicString, toPlainDecimalString } from "./decimal";

describe("toPlainDecimalString", () => {
  it("leaves a plain number alone", () => {
    expect(toPlainDecimalString(1.25)).toBe("1.25");
    expect(toPlainDecimalString(0)).toBe("0");
    expect(toPlainDecimalString(1000)).toBe("1000");
  });

  it("expands the small end, where toString goes exponential", () => {
    // Below 1e-6 toString switches notation. These are the amounts a dollar
    // figure divided by a price actually produces.
    expect(toPlainDecimalString(4.4e-7)).toBe("0.00000044");
    expect(toPlainDecimalString(1e-8)).toBe("0.00000001");
    expect(toPlainDecimalString(1.5e-7)).toBe("0.00000015");
  });

  it("expands the large end", () => {
    expect(toPlainDecimalString(1e21)).toBe("1000000000000000000000");
    expect(toPlainDecimalString(1.23e21)).toBe("1230000000000000000000");
  });

  it("keeps the sign", () => {
    expect(toPlainDecimalString(-4.4e-7)).toBe("-0.00000044");
  });
});

describe("numberToAtomicString", () => {
  it("converts a plain amount", () => {
    expect(numberToAtomicString(1.25, 8)).toBe("125000000");
    expect(numberToAtomicString(1, 6)).toBe("1000000");
    expect(numberToAtomicString(42, 0)).toBe("42");
  });

  it("converts an amount toString would have written exponentially", () => {
    // The crash: this produced "44e-70000" and threw inside BigInt during
    // render, which took the whole page down rather than failing the field.
    expect(numberToAtomicString(4.4e-7, 8)).toBe("44");
    expect(() => BigInt(numberToAtomicString(4.4e-7, 8))).not.toThrow();
    // One atomic unit of an 8-decimal token, which is a balance a wallet can
    // really hold.
    expect(numberToAtomicString(1e-8, 8)).toBe("1");
  });

  it("truncates below the last atomic unit rather than rounding up", () => {
    expect(numberToAtomicString(1.999999, 2)).toBe("199");
    expect(numberToAtomicString(0.999999999, 8)).toBe("99999999");
    // Smaller than one atomic unit is nothing, not one unit.
    expect(numberToAtomicString(1e-9, 8)).toBe("0");
    expect(numberToAtomicString(4.4e-7, 6)).toBe("0");
  });

  it("survives float noise", () => {
    expect(numberToAtomicString(0.1 + 0.2, 8)).toBe("30000000");
  });

  it("reads zero as zero", () => {
    expect(numberToAtomicString(0, 8)).toBe("0");
  });
});
