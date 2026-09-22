// The three destinations Trader mode's Buy + Earn offers for the borrowed
// USDC, in the order the product owner ranked them on 2026-09-22
// (docs/trader-mode-plan.md, D12): a diversified stock portfolio first,
// staking second, liquidity pools third. A card reads "Buy X, earn up to
// Y%", where Y is the best tier's net rate at the safe maximum borrow.
//
// A tier is a shape, not a venue. It lists the venues that fill it: live
// ones by their EarnVenue id, which the rates hook prices and the ticket
// can run, and planned ones by name, so the grid shows the structure the
// product wants before every slot is built. A planned slot never counts
// toward "up to": it has no rate, and a figure it cannot back would be
// invented. Everything here is pure; tiers.test.ts pins it.

import { earnNetApy, maxBorrowRatio } from "@/lib/strategies/math";
import type { EarnVenue, StrategyRates, UsdcEarnOption } from "@/lib/strategies/rates";

export type TierId = "portfolio" | "staking" | "pools";

export type TierVenue =
  | { status: "live"; venue: EarnVenue; label: string }
  | {
      status: "planned";
      venue: "eth-staking" | "btc-staking";
      label: string;
    };

export interface EarnTier {
  id: TierId;
  rank: 1 | 2 | 3;
  name: string;
  // What the borrowed USDC becomes.
  holds: string;
  // The mechanism, one sentence.
  summary: string;
  // The one thing that loses money in this tier, on top of the loan itself.
  risk: string;
  venues: readonly TierVenue[];
}

export const EARN_TIERS: readonly EarnTier[] = [
  {
    id: "portfolio",
    rank: 1,
    name: "Portfolio",
    holds: "Bitwise Mag7X on Base",
    summary:
      "The loan buys an equal-weight basket of eight tokenized stocks, rebalanced daily, with Bitwise's boost paid on top while the campaign runs.",
    risk: "Equity exposure on both sides of the trade. The basket does not count toward the loan's health.",
    venues: [{ status: "live", venue: "glider", label: "Bitwise Mag7X on Base" }],
  },
  {
    id: "staking",
    rank: 2,
    name: "Staking",
    holds: "MON, staked as shMON",
    summary:
      "The loan becomes the chain's own token and is staked. Rewards compound into the share price every epoch.",
    risk: "The stake is in MON and the loan is in dollars. If MON falls, the stake can be worth less than the loan.",
    venues: [
      { status: "live", venue: "shmonad", label: "shMON staking on Monad" },
      { status: "planned", venue: "eth-staking", label: "ETH staking" },
      { status: "planned", venue: "btc-staking", label: "BTC staking" },
    ],
  },
  {
    id: "pools",
    rank: 3,
    name: "Liquidity pools",
    holds: "A Uniswap position",
    summary:
      "The loan becomes both sides of a Uniswap pair and earns the pool's trading fees.",
    risk: "Impermanent loss: the pool sells the side that rises. Fees may not cover it.",
    venues: [{ status: "live", venue: "uniswap", label: "Uniswap pools" }],
  },
];

export function tierById(id: TierId): EarnTier {
  return EARN_TIERS.find((t) => t.id === id)!;
}

export type TierState =
  // A live venue with a rate. `net` is null only while the borrow rate is
  // still loading.
  | { kind: "ready"; option: UsdcEarnOption; net: number | null }
  // A live venue the rates hook could not price right now.
  | { kind: "unavailable"; reason: string }
  // Nothing in the tier is built yet.
  | { kind: "planned"; label: string };

// What a tier can do for this asset right now, at the safe maximum borrow.
// Among a tier's live venues the best net wins.
export function tierState(
  tier: EarnTier,
  row: StrategyRates,
  earnOptions: readonly UsdcEarnOption[],
): TierState {
  const live = tier.venues.filter((v) => v.status === "live");
  const options = live
    .map((v) => earnOptions.find((o) => o.venue === v.venue))
    .filter((o): o is UsdcEarnOption => o != null);
  if (options.length > 0) {
    const ratio = maxBorrowRatio(row.route);
    let best: { option: UsdcEarnOption; net: number | null } | null = null;
    for (const option of options) {
      const net =
        row.borrowApr == null
          ? null
          : earnNetApy({
              borrowRatio: ratio,
              earnApy: option.apy,
              borrowApr: row.borrowApr,
              collateralSupplyApy: row.collateralSupplyApy,
            });
      if (!best || (net ?? -Infinity) > (best.net ?? -Infinity)) best = { option, net };
    }
    return { kind: "ready", ...best! };
  }
  if (live.length > 0) {
    return {
      kind: "unavailable",
      reason:
        live[0].venue === "glider"
          ? "Bitwise boost has ended"
          : live[0].venue === "uniswap"
            ? "No pool has a measured fee rate right now"
            : "Rate unavailable right now",
    };
  }
  return { kind: "planned", label: tier.venues[0].label };
}

export interface BestTier {
  tier: EarnTier;
  option: UsdcEarnOption;
  net: number;
}

// The "up to" figure: the best net across the tiers that can run today.
// Null while no tier has both a venue and a borrow rate.
export function bestTier(
  row: StrategyRates,
  earnOptions: readonly UsdcEarnOption[],
): BestTier | null {
  let best: BestTier | null = null;
  for (const tier of EARN_TIERS) {
    const s = tierState(tier, row, earnOptions);
    if (s.kind !== "ready" || s.net == null) continue;
    if (!best || s.net > best.net) best = { tier, option: s.option, net: s.net };
  }
  return best;
}
