import { describe, expect, it } from "vitest";

import { borrowRouteFor } from "@/lib/borrow/route";
import { isDepositable, uniswapPoolById } from "@/lib/uniswap/pools";

import { PLAYS, resolvePlay, resolvePlayStatic } from "./plays";
import { uniswapOption, type StrategyRatesState, type UsdcEarnOption } from "./rates";

// Every play names a catalog asset with a borrow market; a leverage play
// names one with a flashloan venue; a ladder's next pick is in the catalog.
// resolvePlayStatic throws on any of those, so this is the whole check.
describe("plays registry", () => {
  it("has unique ids", () => {
    const ids = PLAYS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(PLAYS.map((p) => [p.id, p] as const))("%s resolves against the catalog", (_, play) => {
    const { xstock, next, pool } = resolvePlayStatic(play);
    expect(xstock.symbol).toBe(play.symbol);
    expect(borrowRouteFor(xstock.mint)).toBeDefined();
    if (play.preset.kind === "ladder" && play.preset.nextSymbol) {
      expect(next?.symbol).toBe(play.preset.nextSymbol);
    }
    if (play.preset.kind === "leverage") {
      expect(borrowRouteFor(xstock.mint)?.vault).toBeDefined();
    }
    // A play naming a pool resolves it, and it is one a deposit can reach.
    if (play.preset.kind === "earn" && play.preset.poolId) {
      expect(pool?.id.toLowerCase()).toBe(play.preset.poolId.toLowerCase());
      expect(isDepositable(pool!)).toBe(true);
      expect(play.preset.venue).toBe("uniswap");
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
  // Every pool a play names, priced, so a pool play resolves.
  const poolOptions: UsdcEarnOption[] = PLAYS.flatMap((p) => {
    const { pool } = resolvePlayStatic(p);
    return pool ? [uniswapOption(pool, 0.14)] : [];
  });
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
    earnOptions: [{ venue: "morpho", label: "Vault", apy: 0.08 }, ...poolOptions.slice(0, 1)],
    uniswapOptions: poolOptions,
    loading: false,
  };

  it("runs a play whose venue is answering", () => {
    const r = resolvePlay(PLAYS.find((p) => p.id === "nvda-carry")!, loaded);
    expect(r.blocked).toBeNull();
  });

  it("runs a pool play when its own pool is priced", () => {
    const r = resolvePlay(PLAYS.find((p) => p.id === "nvda-lp")!, loaded);
    expect(r.blocked).toBeNull();
    expect(r.pool?.label).toBe("USDG / NVDA");
  });

  it("blocks a pool play when its own pool has no rate, even if another does", () => {
    const other = uniswapPoolById(4663, "0xc61284332117c3FB23A2A56cceFFD07F7aF60029")!;
    const r = resolvePlay(PLAYS.find((p) => p.id === "nvda-lp")!, {
      ...loaded,
      uniswapOptions: [uniswapOption(other, 0.2)],
    });
    expect(r.blocked).toBe("No fee rate for the USDG / NVDA yet");
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
    const loading: StrategyRatesState = {
      rows: [],
      defaultEarn: null,
      earnOptions: [],
      uniswapOptions: [],
      loading: true,
    };
    for (const p of PLAYS) expect(resolvePlay(p, loading).blocked).toBeNull();
  });
});
