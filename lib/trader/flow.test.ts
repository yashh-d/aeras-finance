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
  it("draws an earn run as buy, borrow (creates), stake, with the ticket's figures", () => {
    const steps = buildFlow({
      kind: "earn",
      xstock: nvda,
      amountUsd: 100,
      ratio: 0.58,
      borrowUsd: 58,
      price: 200,
      option: { venue: "shmonad", label: "shMON staking on Monad", apy: 0.12, monDenominated: true },
    });
    expect(edges(steps).map((e) => e.verb)).toEqual(["buy NVDAx", "borrow USDC", "stake"]);
    expect(edges(steps)[1].created).toBe(true);
    expect(edges(steps)[1].creates).toBe("+$58.00");
    expect(nodes(steps).map((n) => n.value)).toEqual(["$100.00", "0.5000 NVDAx", "$58.00", "12.00%"]);
    expect(nodes(steps)[3].marks[0].symbol).toBe("shMON");
  });

  it("carries no figures and no captions with no amount, but the borrow edge is still a borrow", () => {
    const steps = buildFlow({
      kind: "earn",
      xstock: nvda,
      amountUsd: null,
      ratio: 0.58,
      borrowUsd: null,
      price: null,
      option: { venue: "glider", label: "Bitwise Mag7X on Base", apy: 0.1 },
    });
    expect(nodes(steps).map((n) => n.value)).toEqual([null, null, null, "10.00%"]);
    expect(edges(steps)[1]).toMatchObject({ verb: "borrow USDC", created: true, creates: null });
    expect(edges(steps)[2].verb).toBe("buy");
    expect(nodes(steps)[3].marks).toHaveLength(8);
  });

  it("shows the Morpho vault as the venue's mark with its curator, not as USDC", () => {
    const steps = buildFlow({
      kind: "earn",
      xstock: nvda,
      amountUsd: null,
      ratio: 0.58,
      borrowUsd: null,
      price: null,
      option: { venue: "morpho", label: "Hyperithm USDC Apex on Monad", apy: 0.08 },
    });
    expect(edges(steps)[2].verb).toBe("deposit");
    expect(nodes(steps)[3].marks.map((m) => m.name)).toEqual(["Morpho", "Hyperithm"]);
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
    expect(edges(steps).map((e) => e.verb)).toEqual(["borrow USDC", "buy QQQx"]);
    expect(edges(steps)[0].creates).toBe("+$100.00");
    expect(nodes(steps).map((n) => n.value)).toEqual(["$100.00", "$200.00", "$199.00"]);
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
    expect(edges(steps).map((e) => e.verb)).toEqual(["buy NVDAx", "borrow USDC", "buy PAXG"]);
    expect(edges(steps)[1].creates).toBe("+$58.00");
    expect(nodes(steps).at(-1)!.marks[0].symbol).toBe("PAXG");
  });

  it("folds a long ladder into a repeat with the total exposure", () => {
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
    expect(edges(steps).at(-1)!.verb).toBe(`repeat ×${p.rounds.length}`);
    expect(nodes(steps).at(-1)!.value).toBe(`$${p.exposureUsd.toFixed(2)}`);
  });
});
