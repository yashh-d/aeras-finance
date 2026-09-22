import { describe, expect, it } from "vitest";

import { xstockBySymbol } from "@/lib/jupiter/xstocks";
import { ladderProjection } from "@/lib/strategies/math";

import { buildFlow, type FlowEdge, type FlowNode } from "./flow";

const nvda = xstockBySymbol("NVDAx")!;
const qqq = xstockBySymbol("QQQx")!;
const paxg = xstockBySymbol("PAXG")!;

const nodes = (steps: ReturnType<typeof buildFlow>) => steps.filter((s): s is FlowNode => s.kind === "node");
const edges = (steps: ReturnType<typeof buildFlow>) => steps.filter((s): s is FlowEdge => s.kind === "edge");

describe("buildFlow", () => {
  it("draws an earn run as in, buy, borrow (creates), deposit", () => {
    const steps = buildFlow({
      kind: "earn",
      xstock: nvda,
      amountUsd: 100,
      ratio: 0.58,
      borrowUsd: 58,
      price: 200,
      option: { venue: "shmonad", label: "shMON staking on Monad", apy: 0.12, monDenominated: true },
    });
    expect(nodes(steps).map((n) => n.label)).toEqual(["You put in", "NVDAx", "New USDC", "shMON"]);
    expect(edges(steps).map((e) => e.verb)).toEqual(["buy", "borrow", "stake"]);
    const borrow = edges(steps)[1];
    expect(borrow.creates).toBe("+$58.00");
    expect(nodes(steps)[1].value).toBe("0.5000 NVDAx");
    expect(nodes(steps)[3].value).toBe("12.00%");
  });

  it("is structural with no amount", () => {
    const steps = buildFlow({
      kind: "earn",
      xstock: nvda,
      amountUsd: null,
      ratio: 0.58,
      borrowUsd: null,
      price: null,
      option: { venue: "glider", label: "Bitwise Mag7X on Base", apy: 0.1 },
    });
    expect(edges(steps)[1].creates).toBe("+58% of its value");
    expect(edges(steps)[2].verb).toBe("buy");
    expect(nodes(steps)[3].marks).toHaveLength(8);
    expect(nodes(steps)[3].label).toBe("Mag 7 basket");
  });

  it("draws leverage as borrow first, then one buy of the whole exposure", () => {
    const steps = buildFlow({
      kind: "leverage",
      xstock: qqq,
      amountUsd: 100,
      leverage: 2,
      borrowUsd: 100,
      exposureUsd: 199,
      exposureUi: 0.27,
    });
    expect(edges(steps).map((e) => e.verb)).toEqual(["borrow", "buy"]);
    expect(edges(steps)[0].creates).toBe("+$100.00");
    expect(nodes(steps)[1].value).toBe("$200.00");
    expect(nodes(steps)[2].label).toBe("2.0× QQQx");
  });

  it("draws a ladder ending in gold as two buys and no repeat", () => {
    const p = ladderProjection({ equityUsd: 100, borrowRatio: 0.58 });
    const steps = buildFlow({
      kind: "ladder",
      xstock: nvda,
      amountUsd: 100,
      ratio: 0.58,
      next: paxg,
      nextIsGlider: false,
      nextHasMarket: false,
      // The projection runs on as if every round bought NVDAx; the flow
      // must stop at the gold anyway.
      rounds: p.rounds,
    });
    expect(nodes(steps).map((n) => n.label)).toEqual(["You put in", "NVDAx", "New USDC", "PAXG"]);
    expect(edges(steps)[1].creates).toBe("+$58.00");
    expect(edges(steps).some((e) => e.verb === "repeat")).toBe(false);
  });

  it("folds a long ladder into a repeat node with the total exposure", () => {
    const p = ladderProjection({ equityUsd: 100, borrowRatio: 0.58 });
    const steps = buildFlow({
      kind: "ladder",
      xstock: nvda,
      amountUsd: 100,
      ratio: 0.58,
      next: nvda,
      nextIsGlider: false,
      nextHasMarket: true,
      rounds: p.rounds,
    });
    const last = nodes(steps).at(-1)!;
    expect(last.label).toBe(`${p.rounds.length} rounds`);
    expect(last.value).toBe(`$${p.exposureUsd.toFixed(2)}`);
    expect(edges(steps).at(-1)!.verb).toBe("repeat");
  });
});
