import { describe, expect, it } from "vitest";

import {
  ONDO_AUTO_EXCHANGE_LTV,
  ONDO_CLOSED_MARKET_AE_FEE,
  ONDO_EQUITY_HAIRCUT,
  ONDO_MAX_USDC_DEBT,
} from "./constants";
import {
  autoExchangeCostUsd,
  autoExchangePrice,
  autoExchangePriceMove,
  autoExchangeTrigger,
  collateralLtv,
  liveCollateralHealth,
  marginHeadroom,
  maxSafeNotionalUsd,
  projectLtv,
  selfHedgeLiquidationMove,
  type HedgeProjectionInput,
} from "./risk";
import type { OndoBalance } from "./types";

// None of this comes back from Ondo's API. GET /v1/perps/balance carries no
// ltv, usdcDebt or nonUsdcMarginValue field, so the number that decides whether
// Ondo sells the user's collateral is reconstructed here from the definitions
// in Ondo's risk docs. That makes these functions the only thing standing
// between a user and a silent liquidation, and it makes their sign conventions
// the thing most worth pinning: "debt" is losses net of stablecoin balance, so
// it is NEGATIVE when the account is in trouble.

function balance(over: Partial<OndoBalance>): OndoBalance {
  return {
    walletBalance: "0",
    realizedPnl: "0",
    unrealizedPnl: "0",
    marginBalance: "0",
    usedMargin: "0",
    availableMargin: "0",
    withdrawableMargin: "0",
    maintenanceMarginRequirement: "0",
    totalMaintenanceMargin: "0",
    ...over,
  } as OndoBalance;
}

describe("constants", () => {
  it("match Ondo's published risk parameters", () => {
    // Pinned because every function below defaults to them, and a silent change
    // moves every liquidation warning in the app at once.
    expect(ONDO_EQUITY_HAIRCUT).toBe(0.1);
    expect(ONDO_AUTO_EXCHANGE_LTV).toBe(0.3);
    expect(ONDO_MAX_USDC_DEBT).toBe(100_000);
    expect(ONDO_CLOSED_MARKET_AE_FEE).toBe(0.025);
  });
});

describe("collateralLtv", () => {
  it("is zero while the account is not in deficit", () => {
    // Debt is (USDC + unrealized PnL). Non-negative means nothing is owed, and
    // an LTV of zero is the correct reading rather than a small positive one.
    expect(
      collateralLtv({
        collateralValueUsd: 1_000,
        usdcBalanceUsd: 100,
        unrealizedPnlUsd: 0,
      }),
    ).toBe(0);
    expect(
      collateralLtv({
        collateralValueUsd: 1_000,
        usdcBalanceUsd: 0,
        unrealizedPnlUsd: 50,
      }),
    ).toBe(0);
  });

  it("prices debt against the haircut collateral, not the market value", () => {
    // $1,000 of stock credits $900 after the 10% haircut. A $90 loss is
    // therefore a 10% LTV, not a 9% one.
    expect(
      collateralLtv({
        collateralValueUsd: 1_000,
        usdcBalanceUsd: 0,
        unrealizedPnlUsd: -90,
      }),
    ).toBeCloseTo(0.1, 12);
  });

  it("lets USDC offset losses one for one", () => {
    // A $90 loss against $40 of USDC is $50 of debt.
    expect(
      collateralLtv({
        collateralValueUsd: 1_000,
        usdcBalanceUsd: 40,
        unrealizedPnlUsd: -90,
      }),
    ).toBeCloseTo(50 / 900, 12);
  });

  it("honours an explicit haircut over the default", () => {
    expect(
      collateralLtv({
        collateralValueUsd: 1_000,
        usdcBalanceUsd: 0,
        unrealizedPnlUsd: -100,
        haircut: 0.5,
      }),
    ).toBeCloseTo(0.2, 12); // 100 / 500
  });

  it("returns zero rather than dividing by zero with no collateral", () => {
    expect(
      collateralLtv({
        collateralValueUsd: 0,
        usdcBalanceUsd: 0,
        unrealizedPnlUsd: -100,
      }),
    ).toBe(0);
    expect(
      collateralLtv({
        collateralValueUsd: 1_000,
        usdcBalanceUsd: 0,
        unrealizedPnlUsd: -100,
        haircut: 1,
      }),
    ).toBe(0);
  });
});

describe("liveCollateralHealth", () => {
  it("recovers the credited collateral and the debt from a balance", () => {
    // margin = wallet + nonUsdc + pnl, so nonUsdc = margin - wallet - pnl.
    // Here: 1000 = 100 + nonUsdc + (-50) -> nonUsdc = 950, debt = 100 - 50 = 50.
    const health = liveCollateralHealth(
      balance({
        marginBalance: "1000",
        walletBalance: "100",
        unrealizedPnl: "-50",
      }),
    );
    expect(health.nonUsdcMarginValueUsd).toBeCloseTo(950, 9);
    expect(health.usdcDebtUsd).toBeCloseTo(50, 9);
    // Positive debt is a plain balance, not credit, so LTV is zero.
    expect(health.ltv).toBe(0);
  });

  it("reads a real deficit as a positive LTV", () => {
    // 850 = 0 + nonUsdc + (-150) -> nonUsdc = 1000, debt = -150.
    const health = liveCollateralHealth(
      balance({
        marginBalance: "850",
        walletBalance: "0",
        unrealizedPnl: "-150",
      }),
    );
    expect(health.nonUsdcMarginValueUsd).toBeCloseTo(1_000, 9);
    expect(health.usdcDebtUsd).toBeCloseTo(-150, 9);
    expect(health.ltv).toBeCloseTo(0.15, 9);
    // Headroom to the 30% threshold: 1000 * 0.3 - 150 = 150 of further loss.
    expect(health.headroomToAutoExchangeUsd).toBeCloseTo(150, 9);
  });

  it("does not depend on the hardcoded haircut", () => {
    // The recovered value is already post-haircut, because that is what enters
    // the margin balance. This is the number to trust when both are available:
    // a haircut change on Ondo's side moves it on its own.
    const health = liveCollateralHealth(
      balance({
        marginBalance: "900",
        walletBalance: "0",
        unrealizedPnl: "0",
      }),
    );
    expect(health.nonUsdcMarginValueUsd).toBeCloseTo(900, 9);
  });

  it("reports zero rather than a negative for an account with no collateral", () => {
    const health = liveCollateralHealth(
      balance({
        marginBalance: "100",
        walletBalance: "150",
        unrealizedPnl: "0",
      }),
    );
    // nonUsdc recovers as -50, which is clamped: with no tokenized collateral
    // there is nothing to auto-sell, so zero is the safe reading.
    expect(health.nonUsdcMarginValueUsd).toBe(0);
    expect(health.ltv).toBe(0);
    expect(health.headroomToAutoExchangeUsd).toBe(0);
    // The debt figure still passes through for display.
    expect(health.usdcDebtUsd).toBeCloseTo(150, 9);
  });

  it("clamps headroom at zero once the threshold is already breached", () => {
    // 600 = 0 + nonUsdc + (-400) -> nonUsdc = 1000, debt = -400, LTV 40%.
    const health = liveCollateralHealth(
      balance({
        marginBalance: "600",
        walletBalance: "0",
        unrealizedPnl: "-400",
      }),
    );
    expect(health.ltv).toBeCloseTo(0.4, 9);
    expect(health.headroomToAutoExchangeUsd).toBe(0);
  });

  it("accepts a custom threshold", () => {
    const health = liveCollateralHealth(
      balance({
        marginBalance: "900",
        walletBalance: "0",
        unrealizedPnl: "-100",
      }),
      0.5,
    );
    // nonUsdc = 1000, debt = -100. Headroom to 50%: 500 - 100 = 400.
    expect(health.headroomToAutoExchangeUsd).toBeCloseTo(400, 9);
  });
});

describe("projectLtv", () => {
  const input: HedgeProjectionInput = {
    collateralValueUsd: 1_000,
    shortNotionalUsd: 1_000,
    usdcBalanceUsd: 0,
  };

  it("is zero at no move", () => {
    expect(projectLtv(input, 0)).toBe(0);
  });

  it("rises as the underlying rallies, because the short loses", () => {
    // A hedge is a short: a rally is what creates debt.
    const at5 = projectLtv(input, 0.05);
    const at10 = projectLtv(input, 0.1);
    expect(at5).toBeGreaterThan(0);
    expect(at10).toBeGreaterThan(at5);
  });

  it("credits the collateral's own gain in the same move", () => {
    // At +10%: collateral 1100 credits 990, loss on the short is 100.
    expect(projectLtv(input, 0.1)).toBeCloseTo(100 / 990, 9);
  });

  it("stays at zero through a sell-off, where the short profits", () => {
    expect(projectLtv(input, -0.1)).toBe(0);
  });

  it("is delayed by a USDC balance", () => {
    const cushioned = projectLtv({ ...input, usdcBalanceUsd: 50 }, 0.1);
    expect(cushioned).toBeLessThan(projectLtv(input, 0.1));
  });
});

describe("autoExchangePriceMove and autoExchangeTrigger", () => {
  it("finds the rally that reaches the 30% threshold", () => {
    const input: HedgeProjectionInput = {
      collateralValueUsd: 1_000,
      shortNotionalUsd: 1_000,
      usdcBalanceUsd: 0,
    };
    const move = autoExchangePriceMove(input)!;
    expect(move).not.toBeNull();
    // Solving LTV(x) = 0.3 with credited = 1000*0.9*0.3 = 270:
    //   x = (0 + 270) / (1000 - 270) = 0.369863...
    expect(move).toBeCloseTo(270 / 730, 9);
    // And the projection agrees at that move.
    expect(projectLtv(input, move)).toBeCloseTo(ONDO_AUTO_EXCHANGE_LTV, 9);
  });

  it("returns null for a hedge too small to ever reach the LTV threshold", () => {
    // The documented boundary: with a 10% haircut and a 30% threshold, a hedge
    // covering less than 27% of the holding has no finite LTV trigger, because
    // the collateral gains at least as fast as the short loses.
    const under: HedgeProjectionInput = {
      collateralValueUsd: 1_000,
      shortNotionalUsd: 260, // 26%, under the 0.27 boundary
      usdcBalanceUsd: 0,
    };
    expect(autoExchangeTrigger(under)).not.toBe("ltv");

    const over: HedgeProjectionInput = { ...under, shortNotionalUsd: 280 };
    expect(autoExchangeTrigger(over)).toBe("ltv");
  });

  it("puts the LTV boundary at a hedge ratio of exactly 0.27", () => {
    // credited = collateral * 0.9 * 0.3 = 0.27 * collateral, so the denominator
    // (notional - credited) changes sign at notional == 0.27 * collateral.
    //
    // Three regimes, and the middle one is the easy mistake: crossing the
    // boundary makes the LTV branch FINITE, not BINDING. Just past it the LTV
    // trigger is real but astronomically far away, and the flat $100k cap still
    // fires first. Only well past the boundary does LTV become the near limit.
    const base: HedgeProjectionInput = {
      collateralValueUsd: 1_000,
      shortNotionalUsd: 270,
      usdcBalanceUsd: 0,
    };

    // At the boundary: denominator zero, no LTV trigger at all.
    expect(autoExchangeTrigger(base)).toBe("debt-cap");

    // A hair past it: LTV is finite but needs a ~270,000x move, so the cap wins.
    const hairPast = { ...base, shortNotionalUsd: 270.01 };
    expect(autoExchangeTrigger(hairPast)).toBe("debt-cap");
    expect(autoExchangePriceMove(hairPast)).toBeCloseTo(100_000 / 270.01, 6);

    // Well past it: LTV binds. 40% of the holding gives 270 / (400 - 270).
    const wellPast = { ...base, shortNotionalUsd: 400 };
    expect(autoExchangeTrigger(wellPast)).toBe("ltv");
    expect(autoExchangePriceMove(wellPast)).toBeCloseTo(270 / 130, 9);
  });

  it("falls back to the flat debt cap when LTV never triggers", () => {
    const small: HedgeProjectionInput = {
      collateralValueUsd: 1_000,
      shortNotionalUsd: 100,
      usdcBalanceUsd: 0,
    };
    expect(autoExchangeTrigger(small)).toBe("debt-cap");
    // x = (100_000 + 0) / 100 = 1000, i.e. a 100,000% rally.
    expect(autoExchangePriceMove(small)).toBeCloseTo(1_000, 6);
  });

  it("lets the debt cap bind first on a large account", () => {
    // The documented reason both branches exist: taking only the LTV branch
    // puts the trigger too far away for an account where the flat $100k cap is
    // reached long before 30% of the collateral is.
    const large: HedgeProjectionInput = {
      collateralValueUsd: 10_000_000,
      shortNotionalUsd: 10_000_000,
      usdcBalanceUsd: 0,
    };
    expect(autoExchangeTrigger(large)).toBe("debt-cap");
    // Cap branch: 100_000 / 10_000_000 = 1%.
    expect(autoExchangePriceMove(large)).toBeCloseTo(0.01, 9);
    // Which is far nearer than the LTV branch would have said.
    const ltvOnly = 2_700_000 / (10_000_000 - 2_700_000);
    expect(autoExchangePriceMove(large)!).toBeLessThan(ltvOnly);
  });

  it("takes whichever limit is reached first", () => {
    const input: HedgeProjectionInput = {
      collateralValueUsd: 1_000_000,
      shortNotionalUsd: 1_000_000,
      usdcBalanceUsd: 0,
    };
    const move = autoExchangePriceMove(input)!;
    const byLtv = 270_000 / (1_000_000 - 270_000);
    const byCap = 100_000 / 1_000_000;
    expect(move).toBeCloseTo(Math.min(byLtv, byCap), 9);
  });

  it("returns null only when neither limit can be reached", () => {
    // No short means nothing to lose money on, and a small hedge has no LTV
    // trigger. Both branches null.
    const noShort: HedgeProjectionInput = {
      collateralValueUsd: 1_000,
      shortNotionalUsd: 0,
      usdcBalanceUsd: 0,
    };
    expect(autoExchangeTrigger(noShort)).toBe("never");
    expect(autoExchangePriceMove(noShort)).toBeNull();
  });

  it("never reports a negative move", () => {
    // An account already past the threshold triggers at zero, not in the past.
    const underwater: HedgeProjectionInput = {
      collateralValueUsd: 1_000,
      shortNotionalUsd: 1_000,
      usdcBalanceUsd: -500,
    };
    expect(autoExchangePriceMove(underwater)).toBeGreaterThanOrEqual(0);
  });

  it("is pushed further out by a USDC cushion", () => {
    const bare: HedgeProjectionInput = {
      collateralValueUsd: 1_000,
      shortNotionalUsd: 1_000,
      usdcBalanceUsd: 0,
    };
    expect(
      autoExchangePriceMove({ ...bare, usdcBalanceUsd: 100 })!,
    ).toBeGreaterThan(autoExchangePriceMove(bare)!);
  });
});

describe("autoExchangePrice", () => {
  it("expresses the trigger as a price", () => {
    const input: HedgeProjectionInput = {
      collateralValueUsd: 1_000,
      shortNotionalUsd: 1_000,
      usdcBalanceUsd: 0,
    };
    const move = autoExchangePriceMove(input)!;
    expect(autoExchangePrice(input, 100)).toBeCloseTo(100 * (1 + move), 9);
  });

  it("is null when the position cannot reach the threshold", () => {
    expect(
      autoExchangePrice(
        { collateralValueUsd: 1_000, shortNotionalUsd: 0, usdcBalanceUsd: 0 },
        100,
      ),
    ).toBeNull();
  });
});

describe("autoExchangeCostUsd", () => {
  it("costs the debt itself while the market is open", () => {
    expect(autoExchangeCostUsd(1_000, false)).toBe(1_000);
  });

  it("adds the 2.5% settlement fee while the market is closed", () => {
    // The expensive case and the likely case are the same case: a short hedge
    // accrues debt exactly when the market rallies, and weekends are when the
    // collateral cannot be sold into an open market.
    expect(autoExchangeCostUsd(1_000, true)).toBeCloseTo(1_025, 9);
  });

  it("floors a negative debt at zero", () => {
    expect(autoExchangeCostUsd(-500, true)).toBe(0);
    expect(autoExchangeCostUsd(0, true)).toBe(0);
  });
});

describe("maxSafeNotionalUsd", () => {
  it("is the collateral after haircut, at the threshold", () => {
    expect(maxSafeNotionalUsd(1_000)).toBeCloseTo(270, 9); // 1000 * 0.9 * 0.3
  });

  it("agrees with the LTV branch's own boundary", () => {
    // Same 0.27 boundary as autoExchangePriceMove, reached from the other
    // direction: a short at exactly this notional has no finite LTV trigger,
    // and one comfortably above it does.
    const collateral = 5_000;
    const max = maxSafeNotionalUsd(collateral);
    expect(max).toBeCloseTo(1_350, 9);

    expect(
      autoExchangeTrigger({
        collateralValueUsd: collateral,
        shortNotionalUsd: max,
        usdcBalanceUsd: 0,
      }),
    ).not.toBe("ltv");

    // 1.5x the safe notional: LTV is now the near limit, at 1350 / (2025-1350).
    expect(
      autoExchangeTrigger({
        collateralValueUsd: collateral,
        shortNotionalUsd: max * 1.5,
        usdcBalanceUsd: 0,
      }),
    ).toBe("ltv");
  });

  it("is not unconditional safety, because the debt cap still applies", () => {
    // Documented explicitly: "never" here means never by LTV.
    const safeByLtv = maxSafeNotionalUsd(1_000);
    expect(
      autoExchangePriceMove({
        collateralValueUsd: 1_000,
        shortNotionalUsd: safeByLtv,
        usdcBalanceUsd: 0,
      }),
    ).not.toBeNull();
  });
});

describe("marginHeadroom", () => {
  it("credits the collateral after haircut and adds any USDC", () => {
    const h = marginHeadroom({
      collateralValueUsd: 1_000,
      shortNotionalUsd: 1_000,
      maxLeverage: 25,
      usdcBalanceUsd: 100,
    });
    expect(h.creditedMarginUsd).toBeCloseTo(1_000, 9); // 900 + 100
    expect(h.requiredMarginUsd).toBeCloseTo(40, 9); // 1000 / 25
    expect(h.sufficient).toBe(true);
  });

  it("is rarely the binding constraint for a 1x hedge", () => {
    // Documented: a 1x hedge on a 25x market consumes about 4% of a 90%
    // credited balance.
    const h = marginHeadroom({
      collateralValueUsd: 1_000,
      shortNotionalUsd: 1_000,
      maxLeverage: 25,
    });
    expect(h.requiredMarginUsd / h.creditedMarginUsd).toBeCloseTo(0.0444, 3);
  });

  it("refuses when the credited collateral cannot cover the requirement", () => {
    const h = marginHeadroom({
      collateralValueUsd: 100,
      shortNotionalUsd: 10_000,
      maxLeverage: 2,
    });
    expect(h.requiredMarginUsd).toBe(5_000);
    expect(h.creditedMarginUsd).toBe(90);
    expect(h.sufficient).toBe(false);
  });

  it("treats a zero max leverage as an impossible requirement", () => {
    const h = marginHeadroom({
      collateralValueUsd: 1_000,
      shortNotionalUsd: 1_000,
      maxLeverage: 0,
    });
    expect(h.requiredMarginUsd).toBe(Infinity);
    expect(h.sufficient).toBe(false);
  });
});

describe("selfHedgeLiquidationMove", () => {
  // The measured SPCX case from the module's own comment. Same hedge, same
  // notional, different collateral posted, and a 100x difference in survival.
  // This is the function's whole reason for existing, so it is pinned exactly.
  it("survives a huge move when the whole holding is posted", () => {
    const move = selfHedgeLiquidationMove({
      collateralUsd: 18.94,
      retained: 0.9,
      shortNotionalUsd: 19.35,
      maintenanceMarginRate: 0.05,
    });
    expect(move).not.toBeNull();
    expect(move!).toBeCloseTo(4.91, 2); // +491%
  });

  it("dies on a small move when only the margin requirement is posted", () => {
    const move = selfHedgeLiquidationMove({
      collateralUsd: 2.14,
      retained: 0.9,
      shortNotionalUsd: 19.35,
      maintenanceMarginRate: 0.05,
    });
    expect(move).not.toBeNull();
    expect(move!).toBeCloseTo(0.05, 2); // +5%
  });

  it("returns null when the collateral outruns the short", () => {
    // Collateral and short are the same underlying, so equity moves at the
    // DIFFERENCE of the two. When the coefficient on the move is positive, no
    // upward move liquidates the position.
    expect(
      selfHedgeLiquidationMove({
        collateralUsd: 1_000,
        retained: 0.9,
        shortNotionalUsd: 100,
        maintenanceMarginRate: 0.05,
      }),
    ).toBeNull();
  });

  it("returns null with no short or no collateral", () => {
    const base = {
      retained: 0.9,
      maintenanceMarginRate: 0.05,
      collateralUsd: 100,
      shortNotionalUsd: 100,
    };
    expect(
      selfHedgeLiquidationMove({ ...base, shortNotionalUsd: 0 }),
    ).toBeNull();
    expect(selfHedgeLiquidationMove({ ...base, collateralUsd: 0 })).toBeNull();
  });

  it("survives longer the more collateral is posted", () => {
    const at3 = selfHedgeLiquidationMove({
      collateralUsd: 3,
      retained: 0.9,
      shortNotionalUsd: 19.35,
      maintenanceMarginRate: 0.05,
    })!;
    const at10 = selfHedgeLiquidationMove({
      collateralUsd: 10,
      retained: 0.9,
      shortNotionalUsd: 19.35,
      maintenanceMarginRate: 0.05,
    })!;
    expect(at10).toBeGreaterThan(at3);
  });

  it("contradicts the usual leverage intuition", () => {
    // The documented warning: the same notional at the same maintenance rate
    // dies at +5% or survives +491% depending only on collateral posted. A
    // reading based on leverage alone gets this backwards.
    const thin = selfHedgeLiquidationMove({
      collateralUsd: 2.14,
      retained: 0.9,
      shortNotionalUsd: 19.35,
      maintenanceMarginRate: 0.05,
    })!;
    const full = selfHedgeLiquidationMove({
      collateralUsd: 18.94,
      retained: 0.9,
      shortNotionalUsd: 19.35,
      maintenanceMarginRate: 0.05,
    })!;
    expect(full / thin).toBeGreaterThan(90);
  });
});
