import { describe, expect, it } from "vitest";

import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import type {
  TrustwareQuoteRequest,
  TrustwareQuoteResponse,
} from "@/lib/trustware/types";

import {
  HARD_MAX_GOLD_FUNDING_LOSS_BPS,
  MAX_GOLD_FUNDING_LOSS_BPS,
  planGoldFunding,
} from "./gold-fund";
import { XAUT } from "./gold-market";
import type { GoldCollateralSource } from "./gold-sources";

// XAUt0 on Solana, one troy ounce, the source the $10 test was run with.
const XAUT0: GoldCollateralSource = {
  id: `${TRUSTWARE_SOLANA_CHAIN}:XAUt0`,
  symbol: "XAUt0",
  name: "Tether Gold (LayerZero)",
  denomination: "One troy ounce",
  chain: TRUSTWARE_SOLANA_CHAIN,
  chainLabel: "Solana",
  kind: "solana",
  token: "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P",
  decimals: 6,
  approxUnitUsd: 4_618,
};

const ORACLE = 4_600; // USD per XAUt
const SOLANA = "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
const EVM = "0x000000000000000000000000000000000000dEaD";

// A quote stub shaped like the live two-hop path: the direct route 502s, the
// sale delivers `usdcOut` USDC, and the buy delivers XAUt worth `usdcOut`
// less a fixed dollar fee, with a 1% slippage floor under it.
function quoter(opts: { usdcOut: number; fixedFeeUsd: number }) {
  return async (req: TrustwareQuoteRequest): Promise<TrustwareQuoteResponse> => {
    if (req.toToken === XAUT.address && req.fromChain === TRUSTWARE_SOLANA_CHAIN && req.fromToken !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
      throw new Error("Trustware proxy failed: 502");
    }
    if (req.toChain === TRUSTWARE_SOLANA_CHAIN) {
      const out = Math.round(opts.usdcOut * 1e6);
      return {
        estimate: {
          toAmount: String(out),
          toAmountMin: String(Math.floor(out * 0.99)),
          totalFeesUsd: 0.03,
        },
      } as TrustwareQuoteResponse;
    }
    const usdcIn = Number(req.fromAmount) / 1e6;
    const xaut = Math.round(((usdcIn - opts.fixedFeeUsd) / ORACLE) * 1e6);
    return {
      estimate: {
        toAmount: String(Math.max(0, xaut)),
        toAmountMin: String(Math.max(0, Math.floor(xaut * 0.99))),
        totalFeesUsd: opts.fixedFeeUsd,
      },
    } as TrustwareQuoteResponse;
  };
}

function plan(opts: {
  usdcOut: number;
  fixedFeeUsd: number;
  acceptLossBps?: number;
}) {
  return planGoldFunding({
    source: XAUT0,
    sourceAmountAtomic: BigInt(Math.round((opts.usdcOut / ORACLE) * 1e6)),
    solanaAddress: SOLANA,
    evmAddress: EVM,
    solanaUsdcAtomic: "100000000",
    // Plenty of ETH, so the gas leg never quotes and the value check is
    // the only thing deciding the outcome.
    ethBalanceAtomic: "1000000000000000000",
    gasPriceWei: "100000000",
    oracleUnitPrice: ORACLE,
    acceptLossBps: opts.acceptLossBps,
    fetchQuote: quoter(opts),
  });
}

describe("planGoldFunding value bound", () => {
  it("is ready under the soft bound", async () => {
    // $1,000 with a $1 fixed fee: about 2% worst case with the two floors.
    const result = await plan({ usdcOut: 1_000, fixedFeeUsd: 1 });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.lossBps).toBeLessThanOrEqual(MAX_GOLD_FUNDING_LOSS_BPS);
    expect(result.expectedLossBps).toBeLessThan(result.lossBps);
    expect(result.feesUsd).toBeCloseTo(1.03, 2);
  });

  it("asks, rather than refuses, on the $10 test", async () => {
    // The case from 2026-09-22: $10 in, a dollar of fixed cost, 10% and up.
    const result = await plan({ usdcOut: 10.1, fixedFeeUsd: 1.08 });
    expect(result.kind).toBe("needs-confirmation");
    if (result.kind !== "needs-confirmation") return;
    expect(result.lossBps).toBeGreaterThan(MAX_GOLD_FUNDING_LOSS_BPS);
    expect(result.lossBps).toBeLessThanOrEqual(HARD_MAX_GOLD_FUNDING_LOSS_BPS);
    expect(result.costUsd).toBeGreaterThan(result.expectedCostUsd);
    expect(result.reason).toContain("Nothing is sent until you accept it");
    expect(result.reason).toContain("$1.11");
  });

  it("runs once that exact figure has been accepted", async () => {
    const asked = await plan({ usdcOut: 10.1, fixedFeeUsd: 1.08 });
    if (asked.kind !== "needs-confirmation") throw new Error(asked.kind);
    const accepted = await plan({
      usdcOut: 10.1,
      fixedFeeUsd: 1.08,
      acceptLossBps: asked.lossBps,
    });
    expect(accepted.kind).toBe("ready");
    if (accepted.kind !== "ready") return;
    expect(accepted.lossBps).toBe(asked.lossBps);
    expect(accepted.minXautAtomic).toBe(asked.minXautAtomic);
  });

  it("re-prompts when the quote moves past what was accepted", async () => {
    const asked = await plan({ usdcOut: 10.1, fixedFeeUsd: 1.08 });
    if (asked.kind !== "needs-confirmation") throw new Error(asked.kind);
    const worse = await plan({
      usdcOut: 10.1,
      fixedFeeUsd: 1.6,
      acceptLossBps: asked.lossBps,
    });
    expect(worse.kind).toBe("needs-confirmation");
  });

  it("still refuses a route that delivers a fraction of the value", async () => {
    // $10 in and $6 of fixed cost is not a fee, whatever the user accepts.
    const result = await plan({ usdcOut: 10, fixedFeeUsd: 6, acceptLossBps: 9_999 });
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") return;
    expect(result.reason).toContain("broken route");
  });
});
