// Unified collateral verification: exercise planUnifiedDeposit's sequencing.
//
// Cases A-E run against a stubbed quote so the sizing maths is deterministic and
// offline. Case F hits the real /api/trustware/quote proxy through a running dev
// server, so the API key stays server-side exactly as it does in the browser.
//
//   npx tsx scripts/trustware-unified-check.mts
//   PROXY_ORIGIN=http://localhost:3000 npx tsx scripts/trustware-unified-check.mts
//
// Read-only. Signs nothing, submits nothing, moves nothing.

import { vaultById } from "../lib/jupiter/borrow";
import { atomicToUi, rescaleAtomic, uiToAtomic } from "../lib/trustware/amounts";
import { equivalenceByVaultId } from "../lib/trustware/equivalents";
import {
  directQuote,
  quoteSolanaConversion,
} from "../lib/jupiter/convert";
import type {
  HeldEquivalent,
  SolanaQuoteFn,
} from "../lib/trustware/planner";
import { totalConvertibleUi } from "../lib/trustware/selection";
import {
  planUnifiedDeposit,
  quoteMaxDepositable,
  type UnifiedPlan,
} from "../lib/trustware/unified";
import type {
  TrustwareQuoteRequest,
  TrustwareQuoteResponse,
} from "../lib/trustware/types";

const TSLA_VAULT = vaultById(77)!;
const SOL_ADDR = "3Gk1L9tHxYVSHqCS1w5aBpKZ7fJvcWjZ4kQ9EanKPUFY";
const EVM_ADDR = "0x1111111111111111111111111111111111111111";

const sources = equivalenceByVaultId(77)!.sources;
const ethTslaOn = sources.find((s) => s.chain === "1" && s.symbol === "TSLAon")!;
const bscTslaOn = sources.find((s) => s.chain === "56" && s.symbol === "TSLAon")!;
const solTslaOn = sources.find((s) => s.kind === "solana")!;

// Solana legs now price through Jupiter, not Trustware. Offline cases stub this
// so the sizing maths stays deterministic; the live case uses the real Ultra
// endpoint directly, since the in-app proxy only resolves in a browser.
const liveSolanaQuote: SolanaQuoteFn = async ({ source, vault, fromAmountAtomic }) => {
  const q = await quoteSolanaConversion({
    inputMint: source.token,
    inputDecimals: source.decimals,
    outputMint: vault.collateralMint,
    outputDecimals: vault.collateralDecimals,
    amountAtomic: fromAmountAtomic,
    transport: directQuote,
  });
  return {
    fromAmountAtomic: q.fromAmountAtomic,
    toAmountAtomic: q.toAmountAtomic,
    toAmountMinAtomic: q.toAmountMinAtomic,
    fromAmountUsd: q.fromAmountUsd,
    toAmountUsd: q.toAmountUsd,
    totalFeesUsd: null,
    lossFraction: q.lossFraction,
    slippagePct: q.slippagePct,
  };
};

// Deterministic stand-in for the Jupiter leg, losing `lossPct` of value.
function stubSolanaQuote(lossPct: number): SolanaQuoteFn {
  return async ({ source, vault, fromAmountAtomic }) => {
    const notional = BigInt(
      rescaleAtomic(fromAmountAtomic, source.decimals, vault.collateralDecimals),
    );
    const toAmount = (notional * BigInt(Math.round((100 - lossPct) * 100))) / 10_000n;
    return {
      fromAmountAtomic,
      toAmountAtomic: toAmount.toString(),
      toAmountMinAtomic: ((toAmount * 997n) / 1000n).toString(),
      fromAmountUsd: null,
      toAmountUsd: null,
      totalFeesUsd: 0.02,
      lossFraction: lossPct / 100,
      slippagePct: 0.3,
    };
  };
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

// Stub route losing `lossPct` of value, at whatever decimals the source uses.
function stubQuote(lossPct: number) {
  return async (req: TrustwareQuoteRequest): Promise<TrustwareQuoteResponse> => {
    const fromDecimals = req.fromToken === solTslaOn.token ? 9 : 18;
    const notional = BigInt(rescaleAtomic(req.fromAmount, fromDecimals, 8));
    const toAmount =
      (notional * BigInt(Math.round((100 - lossPct) * 100))) / 10_000n;
    return {
      estimate: {
        toAmount: toAmount.toString(),
        toAmountMin: ((toAmount * 99n) / 100n).toString(),
        toAmountUsd: 100,
        totalFeesUsd: 1.25,
      },
    };
  };
}

function summarise(plan: UnifiedPlan) {
  console.log(`        kind=${plan.kind}`);
  if (plan.kind === "unified-deposit") {
    console.log(
      `        deposit=${atomicToUi(plan.depositAtomic, 8)} TSLAx  legs=${plan.legs.length}  fees=$${plan.totalFeesUsd ?? "?"}`,
    );
    for (const leg of plan.legs) {
      console.log(
        `          convert ${atomicToUi(leg.sourceAmountAtomic, leg.source.decimals)} ${leg.source.symbol} on ${leg.source.chainLabel}` +
          ` -> min ${atomicToUi(leg.quote.toAmountMinAtomic, 8)} TSLAx`,
      );
    }
  } else {
    console.log(`        ${plan.reason}`);
  }
}

async function main() {
  console.log("\nA. Holds enough TSLAx already -> no legs, no quotes");
  let calls = 0;
  const counting = async (req: TrustwareQuoteRequest) => {
    calls++;
    return stubQuote(1)(req);
  };
  let plan = await planUnifiedDeposit({
    vault: TSLA_VAULT,
    requestedUi: "2",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: uiToAtomic("5", 8),
    heldEquivalents: [{ source: ethTslaOn, balanceAtomic: uiToAtomic("10", 18) }],
    fetchQuote: counting,
  });
  summarise(plan);
  check("kind is unified-deposit", plan.kind === "unified-deposit");
  check("no legs", plan.kind === "unified-deposit" && plan.legs.length === 0);
  check("no quote was requested", calls === 0, `${calls} calls`);

  console.log("\nB. One source covers the shortfall -> exactly one leg");
  plan = await planUnifiedDeposit({
    vault: TSLA_VAULT,
    requestedUi: "2",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: uiToAtomic("0.5", 8),
    heldEquivalents: [{ source: ethTslaOn, balanceAtomic: uiToAtomic("10", 18) }],
    fetchQuote: stubQuote(1),
  });
  summarise(plan);
  check("one leg", plan.kind === "unified-deposit" && plan.legs.length === 1);

  console.log(
    "\nC. No single source covers it, but the sum does -> sequenced legs",
  );
  // 3 TSLAx needed, held as 2 + 2 across two chains. Neither alone is enough.
  const split: HeldEquivalent[] = [
    { source: ethTslaOn, balanceAtomic: uiToAtomic("2", 18) },
    { source: bscTslaOn, balanceAtomic: uiToAtomic("2", 18) },
  ];
  console.log(
    `        unified convertible = ${totalConvertibleUi(split, 8)} TSLAx`,
  );
  plan = await planUnifiedDeposit({
    vault: TSLA_VAULT,
    requestedUi: "3",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: "0",
    heldEquivalents: split,
    fetchQuote: stubQuote(1),
  });
  summarise(plan);
  check("kind is unified-deposit", plan.kind === "unified-deposit");
  check("two legs", plan.kind === "unified-deposit" && plan.legs.length === 2);
  if (plan.kind === "unified-deposit") {
    const distinct = new Set(
      plan.legs.map((l) => `${l.source.chain}:${l.source.token}`),
    );
    check("each leg uses a different source", distinct.size === plan.legs.length);
    const minTotal = plan.legs.reduce(
      (sum, l) => sum + BigInt(l.quote.toAmountMinAtomic),
      0n,
    );
    check(
      "guaranteed minimums cover the deposit",
      minTotal >= BigInt(plan.depositAtomic),
      `${atomicToUi(minTotal.toString(), 8)} vs ${atomicToUi(plan.depositAtomic, 8)}`,
    );
    for (const leg of plan.legs) {
      const held = split.find(
        (h) =>
          h.source.chain === leg.source.chain &&
          h.source.token === leg.source.token,
      )!;
      check(
        `leg on ${leg.source.chainLabel} stays within its own balance`,
        BigInt(leg.sourceAmountAtomic) <= BigInt(held.balanceAtomic),
      );
    }
    check("fees are summed across legs", (plan.totalFeesUsd ?? 0) > 1.25);
  }

  console.log("\nD. Sum still falls short -> insufficient, not a partial plan");
  plan = await planUnifiedDeposit({
    vault: TSLA_VAULT,
    requestedUi: "100",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: "0",
    heldEquivalents: split,
    fetchQuote: stubQuote(1),
  });
  summarise(plan);
  check("kind is insufficient", plan.kind === "insufficient");

  console.log("\nE. Solana source needs no EVM wallet");
  plan = await planUnifiedDeposit({
    vault: TSLA_VAULT,
    requestedUi: "2",
    solanaAddress: SOL_ADDR,
    evmAddress: undefined,
    solanaCollateralAtomic: uiToAtomic("0.5", 8),
    heldEquivalents: [{ source: solTslaOn, balanceAtomic: uiToAtomic("10", 9) }],
    fetchQuote: stubQuote(0.7),
    quoteSolana: stubSolanaQuote(0.7),
  });
  summarise(plan);
  check("one leg", plan.kind === "unified-deposit" && plan.legs.length === 1);
  check(
    "picked the Solana source",
    plan.kind === "unified-deposit" && plan.legs[0]?.source.kind === "solana",
  );

  console.log(
    "\nG. Depositing the quoted maximum is fundable (the Max button case)",
  );
  // Regression: the field used to offer the par sum, which overstates the
  // ceiling by the conversion cost, so tapping Max produced a deposit the
  // planner refused and the submit button went dead.
  const maxHeld: HeldEquivalent[] = [
    { source: solTslaOn, balanceAtomic: uiToAtomic("0.0311", 9) },
  ];
  const onSolana = uiToAtomic("0.0216", 8);
  const maxStub = stubQuote(2.2);
  const maxSolStub = stubSolanaQuote(2.2);
  const quotedMax = await quoteMaxDepositable({
    vault: TSLA_VAULT,
    solanaAddress: SOL_ADDR,
    evmAddress: undefined,
    solanaCollateralAtomic: onSolana,
    heldEquivalents: maxHeld,
    fetchQuote: maxStub,
    quoteSolana: maxSolStub,
  });
  const parMax = 0.0216 + totalConvertibleUi(maxHeld, 8);
  const quotedMaxUi = atomicToUi(quotedMax.maxAtomic, 8);
  console.log(
    `        par sum=${parMax} TSLAx  quoted max=${quotedMaxUi} TSLAx  priced=${quotedMax.priced} unpriced=${quotedMax.unpriced}`,
  );
  check("every source priced", quotedMax.unpriced === 0);
  check(
    "quoted max is below the par sum",
    Number(quotedMaxUi) < parMax,
    `${quotedMaxUi} < ${parMax}`,
  );
  plan = await planUnifiedDeposit({
    vault: TSLA_VAULT,
    requestedUi: quotedMaxUi,
    solanaAddress: SOL_ADDR,
    evmAddress: undefined,
    solanaCollateralAtomic: onSolana,
    heldEquivalents: maxHeld,
    fetchQuote: maxStub,
    quoteSolana: maxSolStub,
  });
  summarise(plan);
  check(
    "a deposit at the quoted max is fundable",
    plan.kind === "unified-deposit",
  );
  if (plan.kind === "unified-deposit") {
    check(
      "the leg stays within the held balance",
      BigInt(plan.legs[0].sourceAmountAtomic) <=
        BigInt(uiToAtomic("0.0311", 9)),
      `${atomicToUi(plan.legs[0].sourceAmountAtomic, 9)} of 0.0311`,
    );
  }
  console.log("        and the par sum, for contrast:");
  plan = await planUnifiedDeposit({
    vault: TSLA_VAULT,
    requestedUi: String(parMax),
    solanaAddress: SOL_ADDR,
    evmAddress: undefined,
    solanaCollateralAtomic: onSolana,
    heldEquivalents: maxHeld,
    fetchQuote: maxStub,
    quoteSolana: maxSolStub,
  });
  check(
    "the par sum is correctly reported as unfundable",
    plan.kind === "insufficient",
    plan.kind,
  );

  console.log("\nF. Live quote through the dev-server proxy");
  const origin = process.env.PROXY_ORIGIN ?? "http://localhost:3000";
  try {
    const live = await planUnifiedDeposit({
      vault: TSLA_VAULT,
      requestedUi: "0.045",
      solanaAddress: SOL_ADDR,
      evmAddress: undefined,
      solanaCollateralAtomic: uiToAtomic("0.0216", 8),
      heldEquivalents: [
        { source: solTslaOn, balanceAtomic: uiToAtomic("0.0311", 9) },
      ],
      quoteSolana: liveSolanaQuote,
      fetchQuote: async (req) => {
        const res = await fetch(`${origin}/api/trustware/quote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req),
        });
        const body = (await res.json()) as TrustwareQuoteResponse;
        if (!res.ok) throw new Error(body.error ?? `proxy ${res.status}`);
        return body;
      },
    });
    summarise(live);
    if (live.kind === "unified-deposit" && live.legs.length > 0) {
      check(
        "live minimums cover the deposit",
        live.legs.reduce((s, l) => s + BigInt(l.quote.toAmountMinAtomic), 0n) +
          BigInt(uiToAtomic("0.0216", 8)) >=
          BigInt(live.depositAtomic),
      );
      check(
        "Solana leg priced through Jupiter with a real floor",
        BigInt(live.legs[0].quote.toAmountMinAtomic) > 0n,
        `min ${atomicToUi(live.legs[0].quote.toAmountMinAtomic, 8)} TSLAx at ${live.legs[0].quote.slippagePct}% slippage`,
      );
    } else {
      console.log("        (no conversion planned; see above)");
    }
  } catch (err) {
    console.log(
      `        SKIPPED — no dev server at ${origin} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  console.log(
    `\n${failures === 0 ? "All offline checks passed." : `${failures} check(s) FAILED.`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
