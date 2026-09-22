import { describe, expect, it } from "vitest";

import type { BorrowRoute } from "@/lib/borrow/route";
import { maxBorrowRatio } from "@/lib/strategies/math";
import type { StrategyRates, UsdcEarnOption } from "@/lib/strategies/rates";
import { xstockBySymbol } from "@/lib/jupiter/xstocks";

import { bestTier, EARN_TIERS, tierState } from "./tiers";

// TSLAx on Jupiter, per docs/jupiter-borrow.md: CF 65%, LT 75%.
const route: BorrowRoute = {
  venue: "jupiter",
  venueLabel: "Jupiter Lend",
  collateralSymbol: "TSLAx",
  collateralMint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  collateralDecimals: 8,
  collateralFactor: 0.65,
  liquidationThreshold: 0.75,
};

const row: StrategyRates = {
  xstock: xstockBySymbol("TSLAx")!,
  route,
  borrowApr: 0.05,
  liquidityUsd: 1_000_000,
  collateralSupplyApy: 0,
};

const glider: UsdcEarnOption = { venue: "glider", label: "Bitwise Mag7X on Base", apy: 0.1 };
const shmon: UsdcEarnOption = {
  venue: "shmonad",
  label: "shMON staking on Monad",
  apy: 0.12,
  monDenominated: true,
};
const morpho: UsdcEarnOption = { venue: "morpho", label: "Hyperithm on Monad", apy: 0.085 };

const [portfolio, staking, pools] = EARN_TIERS;

describe("tiers", () => {
  it("ranks portfolio, staking, pools, in that order", () => {
    expect(EARN_TIERS.map((t) => [t.rank, t.id])).toEqual([
      [1, "portfolio"],
      [2, "staking"],
      [3, "pools"],
    ]);
  });

  it("prices a live tier at the safe maximum borrow", () => {
    const s = tierState(portfolio, row, [glider, shmon, morpho]);
    expect(s.kind).toBe("ready");
    if (s.kind !== "ready") return;
    expect(s.option.venue).toBe("glider");
    // ratio * (earn - borrow): 0.58 * (0.10 - 0.05)
    expect(s.net).toBeCloseTo(maxBorrowRatio(route) * 0.05, 6);
  });

  it("marks a live tier whose venue is not answering as unavailable, with the reason", () => {
    expect(tierState(portfolio, row, [shmon])).toEqual({
      kind: "unavailable",
      reason: "Bitwise boost has ended",
    });
    expect(tierState(staking, row, [glider])).toEqual({
      kind: "unavailable",
      reason: "Rate unavailable right now",
    });
  });

  it("marks a tier with nothing built as planned", () => {
    const s = tierState(pools, row, [glider, shmon, morpho]);
    expect(s.kind).toBe("planned");
  });

  it("ignores venues that are not in any tier", () => {
    // Hyperithm is a Buy + Earn venue in Investor mode, not a Trader tier.
    for (const tier of EARN_TIERS) {
      const s = tierState(tier, row, [morpho]);
      expect(s.kind).not.toBe("ready");
    }
    expect(bestTier(row, [morpho])).toBeNull();
  });

  it("reports the best tier as the 'up to' figure, and never a planned one", () => {
    const best = bestTier(row, [glider, shmon]);
    expect(best?.tier.id).toBe("staking");
    expect(best?.net).toBeCloseTo(maxBorrowRatio(route) * 0.07, 6);
  });

  it("is null while the borrow rate is loading", () => {
    expect(bestTier({ ...row, borrowApr: null }, [glider, shmon])).toBeNull();
    const s = tierState(portfolio, { ...row, borrowApr: null }, [glider]);
    expect(s.kind).toBe("ready");
    if (s.kind === "ready") expect(s.net).toBeNull();
  });

  it("keeps the copy inside the writing rules", () => {
    for (const t of EARN_TIERS) {
      for (const text of [t.name, t.holds, t.summary, t.risk]) {
        expect(text, `${t.id}: em dash`).not.toContain("—");
        expect(text, `${t.id}: exclamation`).not.toContain("!");
      }
    }
  });
});
