import { describe, expect, it } from "vitest";

import { SendValidationError } from "./send-errors";
import { SYSTEM_ACCOUNT_RENT_LAMPORTS, checkSolRent, formatSol } from "./rent";

const FEE = 5_050;
const ONE_SOL = 1_000_000_000;

describe("checkSolRent", () => {
  it("rejects a transfer below the rent floor to an address that does not exist", () => {
    // The production failure: 0.0005 SOL to a fresh address.
    expect(() =>
      checkSolRent({
        lamports: 500_000,
        feeLamports: FEE,
        senderLamports: ONE_SOL,
        recipientLamports: 0,
      }),
    ).toThrow(/holds no SOL yet.*0\.00089088 SOL/);
  });

  it("accepts a transfer that lands a fresh address exactly on the floor", () => {
    expect(() =>
      checkSolRent({
        lamports: SYSTEM_ACCOUNT_RENT_LAMPORTS,
        feeLamports: FEE,
        senderLamports: ONE_SOL,
        recipientLamports: 0,
      }),
    ).not.toThrow();
  });

  it("names the top-up when the recipient already holds a little", () => {
    expect(() =>
      checkSolRent({
        lamports: 100_000,
        feeLamports: FEE,
        senderLamports: ONE_SOL,
        recipientLamports: 400_000,
      }),
    ).toThrow(/Send at least 0\.00049088 SOL/);
  });

  it("does not bother a recipient that is already rent-exempt", () => {
    expect(() =>
      checkSolRent({
        lamports: 1,
        feeLamports: FEE,
        senderLamports: ONE_SOL,
        recipientLamports: SYSTEM_ACCOUNT_RENT_LAMPORTS,
      }),
    ).not.toThrow();
  });

  it("rejects an amount the sender cannot cover with fees", () => {
    expect(() =>
      checkSolRent({
        lamports: ONE_SOL,
        feeLamports: FEE,
        senderLamports: ONE_SOL,
        recipientLamports: ONE_SOL,
      }),
    ).toThrow(/Not enough SOL/);
  });

  it("rejects leaving the sender stranded below the floor, and says both ways out", () => {
    // Sender keeps 1_000_000 - 5_050 - 500_000 = 494_950, below 890_880.
    expect(() =>
      checkSolRent({
        lamports: 500_000,
        feeLamports: FEE,
        senderLamports: 1_000_000,
        recipientLamports: ONE_SOL,
      }),
    ).toThrow(/Send at most 0\.00010407 SOL, or all 0\.00099495 SOL/);
  });

  it("allows emptying the sender to exactly zero", () => {
    expect(() =>
      checkSolRent({
        lamports: ONE_SOL - FEE,
        feeLamports: FEE,
        senderLamports: ONE_SOL,
        recipientLamports: ONE_SOL,
      }),
    ).not.toThrow();
  });

  it("throws the validation class so the form can show the message as is", () => {
    expect(() =>
      checkSolRent({
        lamports: 1,
        feeLamports: FEE,
        senderLamports: ONE_SOL,
        recipientLamports: 0,
      }),
    ).toThrow(SendValidationError);
  });
});

describe("formatSol", () => {
  it("trims trailing zeros and the dot", () => {
    expect(formatSol(890_880)).toBe("0.00089088");
    expect(formatSol(ONE_SOL)).toBe("1");
    expect(formatSol(2_500_000)).toBe("0.0025");
  });
});
