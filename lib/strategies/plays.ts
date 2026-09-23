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
import { XSTOCKS, xstockBySymbol, type XStock, type XStockCategory } from "@/lib/jupiter/xstocks";
import { isDepositable, UNISWAP_POOLS, type UniswapPool } from "@/lib/uniswap/pools";

import type { EarnVenue, StrategyRatesState } from "./rates";
import type { StrategyKind } from "./runs-client";

export type PlayTag =
  | "Carry"
  | "Leverage"
  | "Conviction"
  | "Diversify"
  | "Crypto"
  | "Rotation"
  | "Fees";

// What the ladder may buy next, when the play lets the user choose: a
// catalog category (every asset on that shelf) or an explicit symbol list.
export type NextChoices = XStockCategory | readonly string[];

export type PlayPreset =
  // `poolId` names a Uniswap pool from lib/uniswap/pools.ts, for a play
  // whose venue is "uniswap". Without one the venue's best-paying pool is
  // used, which is what the Buy + Earn tier does.
  | { kind: "earn"; venue?: EarnVenue; ratio?: number; poolId?: string }
  | { kind: "leverage"; leverage: number | "max" }
  // `nextChoices` opens the next pick to a set the detail view offers as a
  // dropdown, with `nextSymbol` preselected. Without it the pick is fixed.
  | { kind: "ladder"; nextSymbol?: string; nextChoices?: NextChoices; ratio?: number };

export interface Play {
  id: string;
  name: string;
  // One to three sentences. The mechanism, then the risk.
  thesis: string;
  tag: PlayTag;
  // The asset bought first, by catalog symbol. The default when
  // `collateral` is "any"; the only choice otherwise.
  symbol: string;
  // "any": the thesis is about the destination, not the stock, so the
  // detail view lets the user swap in any asset with a borrow market. Left
  // unset for a play named for its asset or tied to that asset's pool.
  collateral?: "any";
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
    collateral: "any",
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
    // Tesla is the one Musk company with a borrow market, and SpaceX the
    // one with a pool: the Robinhood Chain SPCX / USDG pool. So the stock
    // is the collateral and the rocket company is where the loan goes. A
    // TSLA pool or a SPCX borrow market would widen the choice; neither
    // exists in the registries today.
    id: "elon-maxxing",
    name: "Elon Maxxing",
    thesis:
      "Hold TSLAx and borrow against it, then lend the loan to the market that trades SpaceX. The Tesla stays yours, the SpaceX pool pays a share of every swap through it, and both bets ride the same founder.",
    tag: "Conviction",
    symbol: "TSLAx",
    preset: { kind: "earn", venue: "uniswap", poolId: "0xc61284332117c3FB23A2A56cceFFD07F7aF60029" },
    steps: [
      "Buy TSLAx with your USDC",
      "Post it and borrow USDC at the maximum safe ratio",
      "Put the loan into the SPCX pool as both of its sides",
    ],
    risk: "One founder on both sides. TSLAx falling past the liquidation line sells the collateral, and the pool sells SpaceX into a rise or holds it through a fall.",
  },
  {
    id: "nvda-gold",
    name: "Stocks buy gold",
    thesis:
      "Keep the stock. Borrow against it and put the loan into gold. Gold has no borrow market here, so the ladder ends there with two positions and one basis.",
    tag: "Diversify",
    symbol: "NVDAx",
    collateral: "any",
    // Any gold on the shelf: the ETF share (GLDx) or either bullion token.
    preset: { kind: "ladder", nextSymbol: "PAXG", nextChoices: "metals" },
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
      "One stock as collateral, an index with the loan. The two positions sit at two lending markets, so each is closable on its own.",
    tag: "Diversify",
    symbol: "AAPLx",
    collateral: "any",
    preset: { kind: "ladder", nextSymbol: "QQQx", nextChoices: "indices" },
    steps: [
      "Buy AAPLx with your USDC",
      "Post it and borrow USDC",
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
    collateral: "any",
    preset: { kind: "earn", venue: "shmonad" },
    steps: [
      "Buy SPYx with your USDC",
      "Post it and borrow USDC",
      "Convert the loan to MON on Monad and stake it in shMON",
    ],
    risk: "MON falling. The stake may then not cover the loan, and the instant exit charges a fee.",
  },
  {
    id: "nvda-lp",
    name: "Own Nvidia, charge the traders",
    thesis:
      "Hold NVDAx and lend the loan to the market that trades it. The Uniswap pool pays a share of every swap between NVDA and dollars.",
    tag: "Fees",
    symbol: "NVDAx",
    preset: { kind: "earn", venue: "uniswap", poolId: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3" },
    steps: [
      "Buy NVDAx with your USDC",
      "Post it and borrow USDC",
      "Put the loan into the NVDA pool as both of its sides",
    ],
    risk: "The pool sells whichever side rises, so it can be worth less than the loan even while fees accrue.",
  },
  {
    id: "spy-lp",
    name: "The index pays its own rent",
    thesis:
      "SPYx is the collateral and the loan becomes liquidity in the SPY pool. Every trade through it pays a fee, and the stock is still yours.",
    tag: "Fees",
    symbol: "SPYx",
    preset: {
      kind: "earn",
      venue: "uniswap",
      poolId: "0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd",
    },
    steps: [
      "Buy SPYx with your USDC",
      "Post it and borrow USDC",
      "Put the loan into the SPY pool as both of its sides",
    ],
    risk: "Two helpings of the same index, one of them being rebalanced against you as the price moves.",
  },
  {
    id: "qqq-mag7",
    name: "Mag 7, paid to wait",
    thesis:
      "Nasdaq collateral, the loan into an equal-weight basket of the largest tech stocks on Base while Bitwise pays a boost on it. Offered only while the boost is live.",
    tag: "Rotation",
    symbol: "QQQx",
    collateral: "any",
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
  // The Uniswap pool the loan goes into, when the play names one.
  pool: UniswapPool | null;
  // Why the play cannot run right now, or null when it can.
  blocked: string | null;
}

// The pool a play names, by id. Case-insensitive, because a v3 pool id is a
// checksummed address and a v4 one is a 32-byte hash.
export function playPool(play: Play): UniswapPool | null {
  if (play.preset.kind !== "earn" || !play.preset.poolId) return null;
  const key = play.preset.poolId.toLowerCase();
  return UNISWAP_POOLS.find((p) => p.id.toLowerCase() === key) ?? null;
}

// Every asset a play with `collateral: "any"` may be opened on: the catalog
// entries with a borrow market, in catalog order. Empty for a fixed play.
export function playCollateralChoices(play: Play): XStock[] {
  if (play.collateral !== "any") return [];
  return XSTOCKS.filter((x) => borrowRouteFor(x.mint) != null);
}

// Every asset a ladder play may buy next, when it offers a choice. Empty
// for a fixed pick and for the other kinds.
export function playNextChoices(play: Play): XStock[] {
  if (play.preset.kind !== "ladder" || !play.preset.nextChoices) return [];
  const c = play.preset.nextChoices;
  if (typeof c === "string") return XSTOCKS.filter((x) => x.category === c);
  return c.map((s) => xstockBySymbol(s)).filter((x): x is XStock => x != null);
}

// Every catalog fact a play depends on, checked at load. A play naming an
// asset the catalog does not carry, or one with no borrow market, is a
// mistake in this file, and plays.test.ts fails on it.
export function resolvePlayStatic(play: Play): {
  xstock: XStock;
  next: XStock | null;
  pool: UniswapPool | null;
} {
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
  if (play.preset.kind === "ladder" && play.preset.nextChoices) {
    const choices = playNextChoices(play);
    if (choices.length === 0) throw new Error(`Play ${play.id}: nextChoices names nothing`);
    if (typeof play.preset.nextChoices !== "string") {
      for (const s of play.preset.nextChoices) {
        if (!xstockBySymbol(s)) throw new Error(`Play ${play.id}: no catalog asset ${s}`);
      }
    }
    if (next && !choices.some((x) => x.mint === next!.mint)) {
      throw new Error(`Play ${play.id}: nextSymbol ${play.preset.nextSymbol} is not among nextChoices`);
    }
  }
  if (play.preset.kind === "leverage") {
    const route = borrowRouteFor(xstock.mint);
    if (!route?.vault) {
      throw new Error(`Play ${play.id}: ${play.symbol} has no flashloan venue for leverage`);
    }
  }
  const pool = playPool(play);
  if (play.preset.kind === "earn" && play.preset.poolId) {
    if (!pool) throw new Error(`Play ${play.id}: no Uniswap pool ${play.preset.poolId}`);
    if (!isDepositable(pool)) {
      throw new Error(`Play ${play.id}: the ${pool.label} pool cannot be deposited into`);
    }
    if (play.preset.venue !== "uniswap") {
      throw new Error(`Play ${play.id}: names a pool but its venue is not uniswap`);
    }
  }
  return { xstock, next, pool };
}

// What the user changed on the detail view, by mint. A mint outside the
// play's choice set is ignored, so a stale selection cannot open a play on
// an asset it does not allow.
export interface PlayChoice {
  collateralMint?: string;
  nextMint?: string;
}

// The play against what is live. Blocked when the market or the venue it
// needs is not answering, with the reason for the card.
export function resolvePlay(play: Play, rates: StrategyRatesState, choice?: PlayChoice): ResolvedPlay {
  const fixed = resolvePlayStatic(play);
  const xstock =
    playCollateralChoices(play).find((x) => x.mint === choice?.collateralMint) ?? fixed.xstock;
  const next = playNextChoices(play).find((x) => x.mint === choice?.nextMint) ?? fixed.next;
  const { pool } = fixed;
  const row = rates.rows.find((r) => r.xstock.mint === xstock.mint) ?? null;
  let blocked: string | null = null;
  if (!rates.loading && row?.borrowApr == null) {
    blocked = `${xstock.symbol} market unavailable`;
  } else if (play.preset.kind === "earn" && play.preset.venue && !rates.loading) {
    const venue = play.preset.venue;
    // A play that names a pool needs that pool priced, not just the venue:
    // the venue's entry is whichever pool pays most, which is usually a
    // different one.
    const ok =
      pool != null
        ? rates.uniswapOptions.some(
            (o) => o.uniswapPool?.id.toLowerCase() === pool.id.toLowerCase(),
          )
        : rates.earnOptions.some((o) => o.venue === venue);
    if (!ok) {
      blocked =
        venue === "glider"
          ? "Bitwise boost has ended"
          : venue === "shmonad"
            ? "shMON rate unavailable"
            : venue === "uniswap"
              ? `No fee rate for the ${pool?.label ?? "pool"} yet`
              : "Vault rate unavailable";
    }
  }
  return { play, kind: play.preset.kind, xstock, next, pool, blocked };
}

export function playById(id: string): Play | undefined {
  return PLAYS.find((p) => p.id === id);
}
