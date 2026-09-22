import { describe, expect, it } from "vitest";

import { EMPTY_EARN_SNAPSHOT, earnRows } from "./earn";
import { MONAD_USDC_VAULTS } from "@/lib/morpho/vaults";

// earnRows is read by two surfaces now, the Portfolio tab and the wallet card,
// and the wallet card folds its output straight into the balances list and the
// account total. So the contract these tests pin is not the formatting, it is
// the two fields that feed a total: every row must carry a finite `usd` and,
// because a balance row states a quantity, a numeric `amount`.

const vault = MONAD_USDC_VAULTS[0];

function withMorphoDeposit(assetsAtomic: string, netApy?: number) {
  return {
    ...EMPTY_EARN_SNAPSHOT,
    morphoPositions: new Map([
      [
        vault.address.toLowerCase(),
        // Only the field earnRows reads; the real type carries share accounting
        // the row does not use.
        { assetsAtomic } as never,
      ],
    ]),
    morphoMetrics:
      netApy == null
        ? new Map()
        : new Map([[vault.address.toLowerCase(), { netApy } as never]]),
  };
}

describe("earnRows", () => {
  it("returns nothing when no venue reports a deposit", () => {
    expect(earnRows(EMPTY_EARN_SNAPSHOT)).toEqual([]);
  });

  it("carries both a dollar value and a token amount", () => {
    // 1,250.50 USDC at 6 decimals.
    const rows = earnRows(withMorphoDeposit("1250500000", 0.0642));

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.kind).toBe("earn");
    expect(row.usd).toBeCloseTo(1250.5, 6);
    expect(row.amount).toBeCloseTo(1250.5, 6);
    expect(row.note).toBe("6.42% APY");
    // Names the chain, because this is the one earn venue off Solana.
    expect(row.venue).toContain("Monad");
  });

  // A vault the user has closed still comes back from the indexer with zero
  // assets. Counting it would put an empty row in the balances list, which is
  // the bug the Ondo withdraw card had.
  it("drops a vault the user is no longer in", () => {
    expect(earnRows(withMorphoDeposit("0"))).toEqual([]);
  });

  it("omits the rate rather than asserting zero when no metric is served", () => {
    const [row] = earnRows(withMorphoDeposit("1000000"));
    expect(row.note).toBeNull();
    expect(row.usd).toBeCloseTo(1, 6);
  });

  // The wallet card sums these into the account total, so a row that cannot be
  // priced must not read as free money.
  it("keeps every row's value finite", () => {
    for (const row of earnRows(withMorphoDeposit("123456789"))) {
      expect(Number.isFinite(row.usd)).toBe(true);
      expect(Number.isFinite(row.amount ?? row.usd)).toBe(true);
    }
  });
});
