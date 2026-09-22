// Plays: named, thesis-driven presets over the three strategies the machine
// already runs. A play says which asset is bought, which strategy runs on it,
// and the one parameter that strategy takes (the earn venue, the multiple,
// the next pick). It adds no signing path: opening a play pre-fills the same
// ticket the Strategies page and the asset strips open, and every step is
// the step lib/strategies/execute.ts already runs. See
// docs/trader-mode-plan.md, D6.
//
// Copy rules apply here more than anywhere: the name can carry the idea, the
// thesis states the mechanism, the risk names what loses money. No numbers
// in the prose; the live figure beside it carries the number.
//
// A play that names no `ratio` borrows at the safe maximum
// (maxBorrowRatio), as every Trader borrow does. Name one only to borrow
// LESS on purpose.

import { borrowRouteFor } from "@/lib/borrow/route";
import { xstockBySymbol, type XStock } from "@/lib/jupiter/xstocks";

import type { EarnVenue, StrategyRatesState } from "./rates";
import type { StrategyKind } from "./runs-client";

export type PlayTag = "Carry" | "Leverage" | "Conviction" | "Diversify" | "Crypto" | "Rotation";

export type PlayPreset =
  | { kind: "earn"; venue?: EarnVenue; ratio?: number }
  | { kind: "leverage"; leverage: number | "max" }
  | { kind: "ladder"; nextSymbol?: string; ratio?: number };

export interface Play {
  id: string;
  name: string;
  // One to three sentences. The mechanism, then the risk.
  thesis: string;
  tag: PlayTag;
  // The asset bought first, by catalog symbol.
  symbol: string;
  preset: PlayPreset;
  // What happens, in order, for the detail view.
  steps: readonly [string, string, string];
  // The one thing that loses money here.
  risk: string;
}

export const PLAYS: readonly Play[] = [
  {
    id: "nvda-carry",
    name: "Nvidia pays its own carry",
    thesis:
      "Hold NVDAx. Borrow as much USDC against it as the vault safely allows and put the loan where it earns more than it costs. The stock stays yours and the spread is the yield.",
    tag: "Carry",
    symbol: "NVDAx",
    preset: { kind: "earn", venue: "morpho" },
    steps: [
      "Buy NVDAx with your USDC",
      "Post it and borrow USDC at the maximum safe ratio",
      "Deposit the loan into the USDC vault on Monad",
    ],
    risk: "NVDAx falling past the liquidation line. The ticket prices that line before you sign.",
  },
  {
    id: "spy-2x",
    name: "The index, twice",
    thesis:
      "The S&P 500 at twice the USDC you put in, opened in one transaction. A flashloan buys the whole position, the vault lends against it, and the loan repays the flashloan.",
    tag: "Leverage",
    symbol: "SPYx",
    preset: { kind: "leverage", leverage: 2 },
    steps: [
      "Flashloan twice your USDC and buy SPYx with all of it",
      "Deposit the SPYx and borrow USDC against it",
      "Repay the flashloan from the loan and your USDC",
    ],
    risk: "A fall in SPYx is doubled on what you put in, and past the liquidation line the position is sold.",
  },
  {
    id: "qqq-max",
    name: "Nasdaq at the limit",
    thesis:
      "The Nasdaq 100 at the most leverage the vault allows, less a buffer. For a view held strongly and watched closely.",
    tag: "Leverage",
    symbol: "QQQx",
    preset: { kind: "leverage", leverage: "max" },
    steps: [
      "Flashloan the full exposure and buy QQQx",
      "Deposit it and borrow USDC up to the buffer",
      "Repay the flashloan",
    ],
    risk: "At the limit a small drop is a liquidation. The ticket shows how small.",
  },
  {
    id: "tsla-ladder",
    name: "Tesla, then more Tesla",
    thesis:
      "Buy TSLAx, borrow against it, buy more TSLAx with the loan, and repeat. Each round is smaller than the last, so the ladder converges, and the ticket shows where.",
    tag: "Conviction",
    symbol: "TSLAx",
    preset: { kind: "ladder", nextSymbol: "TSLAx" },
    steps: [
      "Buy TSLAx with your USDC",
      "Post it, borrow USDC, buy TSLAx again",
      "Repeat until the next borrow is too small to sign, or stop",
    ],
    risk: "Every round adds debt against the same stock. A fall hits all of it at once.",
  },
  {
    id: "nvda-gold",
    name: "Stocks buy gold",
    thesis:
      "Keep the stock. Borrow against it and put the loan into gold. Gold has no borrow market here, so the ladder ends there with two positions and one basis.",
    tag: "Diversify",
    symbol: "NVDAx",
    preset: { kind: "ladder", nextSymbol: "PAXG" },
    steps: [
      "Buy NVDAx with your USDC",
      "Post it and borrow USDC",
      "Buy PAXG with the loan, which ends the ladder",
    ],
    risk: "The loan is against NVDAx alone. Gold rising does not help its health; NVDAx falling hurts it.",
  },
  {
    id: "aapl-qqq",
    name: "Apple funds the Nasdaq",
    thesis:
      "One stock as collateral, an index with the loan. AAPLx is lent against on Kamino and QQQx on Jupiter, so the two positions sit at two venues and each is closable on its own.",
    tag: "Diversify",
    symbol: "AAPLx",
    preset: { kind: "ladder", nextSymbol: "QQQx" },
    steps: [
      "Buy AAPLx with your USDC",
      "Post it on Kamino and borrow USDC",
      "Buy QQQx with the loan, and choose whether to continue",
    ],
    risk: "Two loans if the ladder continues, each liquidated on its own collateral.",
  },
  {
    id: "spy-monad",
    name: "The Monad believer",
    thesis:
      "The S&P 500 as collateral, the loan staked as MON. The loan is in dollars and the stake is not, so this is a view on MON as much as a yield.",
    tag: "Crypto",
    symbol: "SPYx",
    preset: { kind: "earn", venue: "shmonad" },
    steps: [
      "Buy SPYx with your USDC",
      "Post it and borrow USDC",
      "Convert the loan to MON on Monad and stake it in shMON",
    ],
    risk: "MON falling. The stake may then not cover the loan, and the instant exit charges a fee.",
  },
  {
    id: "qqq-mag7",
    name: "Mag 7, paid to wait",
    thesis:
      "Nasdaq collateral, the loan into an equal-weight basket of the largest tech stocks on Base while Bitwise pays a boost on it. Offered only while the boost is live.",
    tag: "Rotation",
    symbol: "QQQx",
    preset: { kind: "earn", venue: "glider" },
    steps: [
      "Buy QQQx with your USDC",
      "Post it and borrow USDC",
      "Send the loan to Base and buy the Mag7X holdings",
    ],
    risk: "Equity exposure on both sides, and the Mag7X value does not count toward the loan's health.",
  },
];

export interface ResolvedPlay {
  play: Play;
  kind: StrategyKind;
  xstock: XStock;
  // The asset the ladder buys next, when the play names one.
  next: XStock | null;
  // Why the play cannot run right now, or null when it can.
  blocked: string | null;
}

// Every catalog fact a play depends on, checked at load. A play naming an
// asset the catalog does not carry, or one with no borrow market, is a
// mistake in this file, and plays.test.ts fails on it.
export function resolvePlayStatic(play: Play): { xstock: XStock; next: XStock | null } {
  const xstock = xstockBySymbol(play.symbol);
  if (!xstock) throw new Error(`Play ${play.id}: no catalog asset ${play.symbol}`);
  if (!borrowRouteFor(xstock.mint)) {
    throw new Error(`Play ${play.id}: ${play.symbol} has no borrow market`);
  }
  let next: XStock | null = null;
  if (play.preset.kind === "ladder" && play.preset.nextSymbol) {
    next = xstockBySymbol(play.preset.nextSymbol) ?? null;
    if (!next) throw new Error(`Play ${play.id}: no catalog asset ${play.preset.nextSymbol}`);
  }
  if (play.preset.kind === "leverage") {
    const route = borrowRouteFor(xstock.mint);
    if (!route?.vault) {
      throw new Error(`Play ${play.id}: ${play.symbol} has no flashloan venue for leverage`);
    }
  }
  return { xstock, next };
}

// The play against what is live. Blocked when the market or the venue it
// needs is not answering, with the reason for the card.
export function resolvePlay(play: Play, rates: StrategyRatesState): ResolvedPlay {
  const { xstock, next } = resolvePlayStatic(play);
  const row = rates.rows.find((r) => r.xstock.mint === xstock.mint) ?? null;
  let blocked: string | null = null;
  if (!rates.loading && row?.borrowApr == null) {
    blocked = `${xstock.symbol} market unavailable`;
  } else if (play.preset.kind === "earn" && play.preset.venue && !rates.loading) {
    const venue = play.preset.venue;
    if (!rates.earnOptions.some((o) => o.venue === venue)) {
      blocked =
        venue === "glider"
          ? "Bitwise boost has ended"
          : venue === "shmonad"
            ? "shMON rate unavailable"
            : "Vault rate unavailable";
    }
  }
  return { play, kind: play.preset.kind, xstock, next, blocked };
}

export function playById(id: string): Play | undefined {
  return PLAYS.find((p) => p.id === id);
}
