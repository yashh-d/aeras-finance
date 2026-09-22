import { describe, expect, it } from "vitest";

import { pickDefaultEarn, type UsdcEarnOption } from "./rates";

// The Buy + Earn default is a USDC venue, and shMON staking (denominated in
// MON) is offered but never chosen for the user. These pin that rule so a
// higher staking APY cannot quietly become the strip's headline figure.

const jupiter: UsdcEarnOption = { venue: "jupiter", label: "Jupiter Lend", apy: 0.06 };
const kamino: UsdcEarnOption = { venue: "kamino", label: "Kamino", apy: 0.07 };
const morpho: UsdcEarnOption = { venue: "morpho", label: "Hyperithm", apy: 0.05 };
const shmon: UsdcEarnOption = {
  venue: "shmonad",
  label: "shMON staking on Monad",
  apy: 0.12,
  monDenominated: true,
  exitFee: 0.0092,
};

describe("pickDefaultEarn", () => {
  it("prefers the Morpho base case when its rate is known", () => {
    expect(pickDefaultEarn([jupiter, kamino, morpho, shmon])?.venue).toBe("morpho");
  });

  it("falls back to the best USDC venue, never the MON-denominated one", () => {
    expect(pickDefaultEarn([jupiter, kamino, shmon])?.venue).toBe("kamino");
    expect(pickDefaultEarn([jupiter, shmon])?.venue).toBe("jupiter");
  });

  it("returns null when only shMON is available", () => {
    expect(pickDefaultEarn([shmon])).toBeNull();
    expect(pickDefaultEarn([])).toBeNull();
  });
});
