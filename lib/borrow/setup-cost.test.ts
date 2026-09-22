import { describe, expect, it } from "vitest";

import { isLamportShortfall, toSetupCost } from "./setup-cost";

describe("toSetupCost", () => {
  it("keeps the fee payer above the rent floor, not just above zero", () => {
    // One account to allocate, a wallet holding rent plus a little. Before the
    // floor was passed in the reserve was 20,000 lamports and this read as
    // 10,000 short; the payer would then have ended between zero and the
    // floor and the runtime would have refused the transaction.
    const cost = toSetupCost({
      venueLabel: "Kamino",
      items: [{ label: "x", lamports: 1_000_000 }],
      haveLamports: 1_040_000,
      floorLamports: 650_240,
    });
    expect(cost.totalLamports).toBe(1_030_000);
    expect(cost.shortfallLamports).toBe(1_030_000 + 650_240 - 1_040_000);
  });

  it("falls back to the fixed reserve when no floor is given", () => {
    const cost = toSetupCost({
      venueLabel: "Jupiter Lend",
      items: [{ label: "x", lamports: 1_000_000 }],
      haveLamports: 1_040_000,
    });
    expect(cost.shortfallLamports).toBe(10_000);
  });

  it("charges nothing when there is nothing to allocate", () => {
    const cost = toSetupCost({
      venueLabel: "Kamino",
      items: [],
      haveLamports: 0,
      floorLamports: 650_240,
    });
    expect(cost.totalLamports).toBe(0);
    expect(cost.shortfallLamports).toBe(0);
  });
});

describe("isLamportShortfall", () => {
  it("recognises both of the runtime's out-of-SOL messages", () => {
    expect(
      isLamportShortfall(
        new Error(
          "Simulation failed. Message: Transaction simulation failed: Transaction results in an account (1) with insufficient funds for rent. Logs: [...]",
        ),
      ),
    ).toBe(true);
    expect(
      isLamportShortfall(
        new Error("Transfer: insufficient lamports 990000, need 1165272"),
      ),
    ).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(isLamportShortfall(new Error("Blockhash not found"))).toBe(false);
    expect(isLamportShortfall(new Error("insufficient funds"))).toBe(false);
    expect(isLamportShortfall(undefined)).toBe(false);
  });
});
