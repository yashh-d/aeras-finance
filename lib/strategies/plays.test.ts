import { describe, expect, it } from "vitest";

import { borrowRouteFor } from "@/lib/borrow/route";

import { PLAYS, resolvePlay, resolvePlayStatic } from "./plays";
import type { StrategyRatesState } from "./rates";

// Every play names a catalog asset with a borrow market; a leverage play
// names one with a flashloan venue; a ladder's next pick is in the catalog.
// resolvePlayStatic throws on any of those, so this is the whole check.
describe("plays registry", () => {
  it("has unique ids", () => {
    const ids = PLAYS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(PLAYS.map((p) => [p.id, p] as const))("%s resolves against the catalog", (_, play) => {
    const { xstock, next } = resolvePlayStatic(play);
    expect(xstock.symbol).toBe(play.symbol);
    expect(borrowRouteFor(xstock.mint)).toBeDefined();
    if (play.preset.kind === "ladder" && play.preset.nextSymbol) {
      expect(next?.symbol).toBe(play.preset.nextSymbol);
    }
    if (play.preset.kind === "leverage") {
      expect(borrowRouteFor(xstock.mint)?.vault).toBeDefined();
    }
  });

  it("keeps the copy inside the writing rules", () => {
    for (const p of PLAYS) {
      for (const text of [p.name, p.thesis, p.risk, ...p.steps]) {
        expect(text, `${p.id}: em dash`).not.toContain("—");
        expect(text, `${p.id}: exclamation`).not.toContain("!");
      }
    }
  });
});

describe("resolvePlay", () => {
  const loaded: StrategyRatesState = {
    rows: PLAYS.map((p) => {
      const { xstock } = resolvePlayStatic(p);
      return {
        xstock,
        route: borrowRouteFor(xstock.mint)!,
        borrowApr: 0.05,
        liquidityUsd: 1_000_000,
        collateralSupplyApy: 0,
      };
    }),
    defaultEarn: { venue: "morpho", label: "Vault", apy: 0.08 },
    earnOptions: [{ venue: "morpho", label: "Vault", apy: 0.08 }],
    loading: false,
  };

  it("runs a play whose venue is answering", () => {
    const r = resolvePlay(PLAYS.find((p) => p.id === "nvda-carry")!, loaded);
    expect(r.blocked).toBeNull();
  });

  it("blocks an earn play whose venue is absent, with the reason", () => {
    const r = resolvePlay(PLAYS.find((p) => p.id === "qqq-mag7")!, loaded);
    expect(r.blocked).toBe("Bitwise boost has ended");
  });

  it("blocks a play whose market has no rate once loading is done", () => {
    const noRates: StrategyRatesState = {
      ...loaded,
      rows: loaded.rows.map((r) => ({ ...r, borrowApr: null })),
    };
    const r = resolvePlay(PLAYS.find((p) => p.id === "spy-2x")!, noRates);
    expect(r.blocked).toBe("SPYx market unavailable");
  });

  it("never blocks while rates are still loading", () => {
    const loading: StrategyRatesState = { rows: [], defaultEarn: null, earnOptions: [], loading: true };
    for (const p of PLAYS) expect(resolvePlay(p, loading).blocked).toBeNull();
  });
});
