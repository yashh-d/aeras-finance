// What a strategy ticket can report about the run it is about to make, for
// a surface that wants to draw it rather than list it. The ticket hands
// these to the `flow` slot in its presentation context
// (components/strategies/shared.tsx); Trader mode fills the slot with a
// diagram (lib/trader/flow.ts, components/trader/StrategyFlow.tsx) and
// Investor mode leaves it empty. Types only, so both sides can import it
// without either depending on the other.

import type { XStock } from "@/lib/jupiter/xstocks";

import type { UsdcEarnOption } from "./rates";

export type TicketFlowInputs =
  | {
      kind: "earn";
      xstock: XStock;
      // Null until a valid amount is typed; the diagram is then structural.
      amountUsd: number | null;
      ratio: number;
      borrowUsd: number | null;
      price: number | null;
      option: UsdcEarnOption | null;
    }
  | {
      kind: "leverage";
      xstock: XStock;
      amountUsd: number | null;
      leverage: number;
      borrowUsd: number | null;
      exposureUsd: number | null;
      exposureUi: number | null;
    }
  | {
      kind: "ladder";
      xstock: XStock;
      amountUsd: number | null;
      ratio: number;
      // The pick for the next round. Null when it is the Mag7X basket.
      next: XStock | null;
      nextIsGlider: boolean;
      // Whether the pick can be borrowed against, so the ladder continues
      // past it. False for gold and for the basket: the ladder ends there.
      nextHasMarket: boolean;
      rounds: { round: number; buyUsd: number; borrowUsd: number }[] | null;
    };
