import { describe, expect, it } from "vitest";

import {
  snapshotSignature,
  type SignableSnapshot,
} from "./snapshot-signature";

// A $300 loan against 5 GOOGLx, the shape of the position that surfaced this.
const base: SignableSnapshot = {
  positions: [
    { key: "kamino:4wg6", collateralUi: 5, debtUi: 300 },
  ],
  pledged: [{ mint: "XsCPL9", amountUi: 5 }],
};

function withPositions(
  positions: SignableSnapshot["positions"],
  pledged: SignableSnapshot["pledged"] = base.pledged,
): SignableSnapshot {
  return { positions, pledged };
}

describe("snapshotSignature", () => {
  it("is stable across two identical reads", () => {
    expect(snapshotSignature(base)).toBe(snapshotSignature(base));
  });

  it("ignores interest accrued between two reads seconds apart", () => {
    // 10% APR on $300 is about $0.00000095 a second. Eight seconds of it, which
    // is the whole settle window, and the same growth on the deposit side.
    const accrued = withPositions(
      [{ key: "kamino:4wg6", collateralUi: 5.0000001, debtUi: 300.0000076 }],
      [{ mint: "XsCPL9", amountUi: 5.0000001 }],
    );
    expect(snapshotSignature(accrued)).toBe(snapshotSignature(base));
  });

  it("sees a position closed", () => {
    const closed = withPositions([], []);
    expect(snapshotSignature(closed)).not.toBe(snapshotSignature(base));
  });

  it("sees a partial repayment", () => {
    const repaid = withPositions([
      { key: "kamino:4wg6", collateralUi: 5, debtUi: 200 },
    ]);
    expect(snapshotSignature(repaid)).not.toBe(snapshotSignature(base));
  });

  it("sees a repayment as small as a cent", () => {
    const repaid = withPositions([
      { key: "kamino:4wg6", collateralUi: 5, debtUi: 299.99 },
    ]);
    expect(snapshotSignature(repaid)).not.toBe(snapshotSignature(base));
  });

  it("sees collateral deposited against no loan", () => {
    // The stranded case: the deposit leg landed and the borrow leg did not, so
    // there is no debt-bearing position to notice, only more pledged stock.
    const deposited = withPositions([], [{ mint: "XsCPL9", amountUi: 5 }]);
    const empty = withPositions([], []);
    expect(snapshotSignature(deposited)).not.toBe(snapshotSignature(empty));
  });

  it("sees a withdrawal of collateral against no loan", () => {
    const before = withPositions([], [{ mint: "XsCPL9", amountUi: 5 }]);
    const after = withPositions([], [{ mint: "XsCPL9", amountUi: 2 }]);
    expect(snapshotSignature(before)).not.toBe(snapshotSignature(after));
  });

  it("does not depend on the order the venue reads settled in", () => {
    const a = withPositions(
      [
        { key: "kamino:4wg6", collateralUi: 5, debtUi: 300 },
        { key: "jupiter:12", collateralUi: 1, debtUi: 50 },
      ],
      [
        { mint: "XsCPL9", amountUi: 5 },
        { mint: "XsDoVf", amountUi: 1 },
      ],
    );
    const b = withPositions(
      [
        { key: "jupiter:12", collateralUi: 1, debtUi: 50 },
        { key: "kamino:4wg6", collateralUi: 5, debtUi: 300 },
      ],
      [
        { mint: "XsDoVf", amountUi: 1 },
        { mint: "XsCPL9", amountUi: 5 },
      ],
    );
    expect(snapshotSignature(a)).toBe(snapshotSignature(b));
  });

  it("tells one venue's position from the other on the same collateral", () => {
    // Both venues take the same mints, so the key has to carry the venue.
    const kamino = withPositions([
      { key: "kamino:4wg6", collateralUi: 5, debtUi: 300 },
    ]);
    const jupiter = withPositions([
      { key: "jupiter:12", collateralUi: 5, debtUi: 300 },
    ]);
    expect(snapshotSignature(kamino)).not.toBe(snapshotSignature(jupiter));
  });
});
