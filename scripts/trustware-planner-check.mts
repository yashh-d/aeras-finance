// Slice 4a verification: exercise the conversion planner's decision logic.
//
// Cases A-E run against a stubbed quote so the sizing maths is deterministic and
// offline. Case F hits the real /api/trustware/quote proxy through a running dev
// server, so the API key stays server-side exactly as it does in the browser.
//
//   npx tsx scripts/trustware-planner-check.mts
//   PROXY_ORIGIN=http://localhost:3000 npx tsx scripts/trustware-planner-check.mts
//
// Read-only. Signs nothing, submits nothing, moves nothing.

import { vaultById } from "../lib/jupiter/borrow";
import { atomicToUi, rescaleAtomic, uiToAtomic } from "../lib/trustware/amounts";
import { equivalenceByVaultId } from "../lib/trustware/equivalents";
import {
  directQuote,
  quoteSolanaConversion,
} from "../lib/jupiter/convert";
import {
  describePlan,
  planCollateralDeposit,
  type ConversionPlan,
  type HeldEquivalent,
  type SolanaQuoteFn,
} from "../lib/trustware/planner";
import type {
  TrustwareQuoteRequest,
  TrustwareQuoteResponse,
} from "../lib/trustware/types";

const TSLA_VAULT = vaultById(77)!;
const SOL_ADDR = "3Gk1L9tHxYVSHqCS1w5aBpKZ7fJvcWjZ4kQ9EanKPUFY";
const EVM_ADDR = "0x1111111111111111111111111111111111111111";

const tslaSources = equivalenceByVaultId(77)!.sources;
const ethTslaOn = tslaSources.find(
  (s) => s.chain === "1" && s.symbol === "TSLAon",
)!;

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

// Stub route that loses `lossPct` of value, so sizing has something real to
// correct for. 18-dec source in, 8-dec destination out.
function stubQuote(lossPct: number) {
  return async (req: TrustwareQuoteRequest): Promise<TrustwareQuoteResponse> => {
    const notional = BigInt(rescaleAtomic(req.fromAmount, 18, 8));
    const toAmount =
      (notional * BigInt(Math.round((100 - lossPct) * 100))) / 10_000n;
    return {
      estimate: {
        toAmount: toAmount.toString(),
        toAmountMin: ((toAmount * 99n) / 100n).toString(),
        fromAmountUsd: 1000,
        toAmountUsd: 1000 * (1 - lossPct / 100),
        totalFeesUsd: 7.5,
      },
    };
  };
}

const held = (balanceUi: string): HeldEquivalent[] => [
  { source: ethTslaOn, balanceAtomic: uiToAtomic(balanceUi, 18) },
];

function summarise(plan: ConversionPlan) {
  console.log(`        kind=${plan.kind}`);
  console.log(`        ${describePlan(plan)}`);
}

async function main() {
  console.log("\nA. Holds enough TSLAx on Solana -> direct deposit, no Trustware");
  let calls = 0;
  const counting = async (req: TrustwareQuoteRequest) => {
    calls++;
    return stubQuote(1)(req);
  };
  let plan = await planCollateralDeposit({
    vault: TSLA_VAULT,
    requestedUi: "2",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: uiToAtomic("5", 8),
    heldEquivalents: held("10"),
    fetchQuote: counting,
  });
  summarise(plan);
  check("kind is direct-deposit", plan.kind === "direct-deposit");
  check(
    "deposits the full requested amount",
    plan.kind === "direct-deposit" && plan.depositAtomic === uiToAtomic("2", 8),
  );
  check("no quote was requested", calls === 0, `${calls} calls`);

  console.log("\nB. Short on Solana, holds nothing elsewhere -> insufficient");
  plan = await planCollateralDeposit({
    vault: TSLA_VAULT,
    requestedUi: "1",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: "0",
    heldEquivalents: [],
    fetchQuote: stubQuote(1),
  });
  summarise(plan);
  check("kind is insufficient", plan.kind === "insufficient");

  console.log("\nC. Short on Solana, holds TSLAon on Ethereum -> convert then deposit");
  plan = await planCollateralDeposit({
    vault: TSLA_VAULT,
    requestedUi: "2",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: uiToAtomic("0.5", 8),
    heldEquivalents: held("10"),
    fetchQuote: stubQuote(1),
  });
  summarise(plan);
  check("kind is convert-then-deposit", plan.kind === "convert-then-deposit");
  if (plan.kind === "convert-then-deposit") {
    const shortfall = BigInt(plan.shortfallAtomic);
    console.log(
      `        shortfall=${atomicToUi(plan.shortfallAtomic, 8)} TSLAx` +
        `  send=${atomicToUi(plan.sourceAmountAtomic, 18)} TSLAon` +
        `  minOut=${atomicToUi(plan.quote.toAmountMinAtomic, 8)} TSLAx`,
    );
    check(
      "shortfall is request minus Solana balance",
      plan.shortfallAtomic === uiToAtomic("1.5", 8),
    );
    check(
      "guaranteed minimum clears the shortfall",
      BigInt(plan.quote.toAmountMinAtomic) >= shortfall,
    );
    check(
      "source amount exceeds 1:1 notional (fees are covered)",
      BigInt(plan.sourceAmountAtomic) >
        BigInt(rescaleAtomic(plan.shortfallAtomic, 8, 18)),
    );
    check(
      "source amount stays within the held balance",
      BigInt(plan.sourceAmountAtomic) <= BigInt(uiToAtomic("10", 18)),
    );
    check(
      "deposit is still the full requested amount",
      plan.depositAtomic === uiToAtomic("2", 8),
    );
    check(
      "loss fraction is reported",
      plan.quote.lossFraction !== null && plan.quote.lossFraction > 0,
      `${((plan.quote.lossFraction ?? 0) * 100).toFixed(2)}%`,
    );
  }

  console.log("\nD. Equivalent balance too small to cover the shortfall -> insufficient");
  plan = await planCollateralDeposit({
    vault: TSLA_VAULT,
    requestedUi: "100",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: "0",
    heldEquivalents: held("10"),
    fetchQuote: stubQuote(1),
  });
  summarise(plan);
  check("kind is insufficient", plan.kind === "insufficient");

  console.log("\nE. Route errors (chain under maintenance) -> unavailable, not insufficient");
  plan = await planCollateralDeposit({
    vault: TSLA_VAULT,
    requestedUi: "2",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    solanaCollateralAtomic: "0",
    heldEquivalents: held("10"),
    fetchQuote: async () => {
      throw new Error("Chain support is currently under maintenance.");
    },
  });
  summarise(plan);
  check("kind is unavailable", plan.kind === "unavailable");

  console.log("\nG. Solana source is preferred over EVM and needs no EVM wallet");
  const solTslaOn = tslaSources.find((s) => s.kind === "solana")!;
  plan = await planCollateralDeposit({
    vault: TSLA_VAULT,
    requestedUi: "2",
    solanaAddress: SOL_ADDR,
    // Deliberately absent: a Solana source must not require an EVM wallet.
    evmAddress: undefined,
    solanaCollateralAtomic: uiToAtomic("0.5", 8),
    heldEquivalents: [
      // Larger EVM balance, so a balance-only ranking would wrongly pick it.
      { source: ethTslaOn, balanceAtomic: uiToAtomic("100", 18) },
      { source: solTslaOn, balanceAtomic: uiToAtomic("10", 9) },
    ],
    quoteSolana: stubSolanaQuote(0.7),
    fetchQuote: async (req) => {
      // 9-decimal Solana source, not 18.
      const notional = BigInt(rescaleAtomic(req.fromAmount, 9, 8));
      const toAmount = (notional * 993n) / 1000n;
      return {
        data: {
          estimate: {
            toAmount: toAmount.toString(),
            toAmountMin: ((toAmount * 99n) / 100n).toString(),
            toAmountUsd: 500,
            totalFeesUsd: 2.37,
          },
        },
      };
    },
  });
  summarise(plan);
  check("kind is convert-then-deposit", plan.kind === "convert-then-deposit");
  if (plan.kind === "convert-then-deposit") {
    check(
      "picked the Solana source over the larger EVM balance",
      plan.source.kind === "solana",
      `picked ${plan.source.symbol} on ${plan.source.chainLabel}`,
    );
    check(
      "sized in 9-decimal source units",
      plan.sourceAmountAtomic.length <= 11,
      `${plan.sourceAmountAtomic} (${atomicToUi(plan.sourceAmountAtomic, 9)})`,
    );
    check(
      "guaranteed minimum clears the shortfall",
      BigInt(plan.quote.toAmountMinAtomic) >= BigInt(plan.shortfallAtomic),
    );
  }

  console.log("\nH. Only an EVM source held, but no EVM wallet -> unavailable");
  plan = await planCollateralDeposit({
    vault: TSLA_VAULT,
    requestedUi: "2",
    solanaAddress: SOL_ADDR,
    evmAddress: undefined,
    solanaCollateralAtomic: "0",
    heldEquivalents: held("10"),
    fetchQuote: stubQuote(1),
  });
  summarise(plan);
  check("kind is unavailable", plan.kind === "unavailable");

  console.log("\nF. Live quote through the dev-server proxy");
  const origin = process.env.PROXY_ORIGIN ?? "http://localhost:3000";
  try {
    const live = await planCollateralDeposit({
      vault: TSLA_VAULT,
      requestedUi: "2",
      solanaAddress: SOL_ADDR,
      evmAddress: EVM_ADDR,
      solanaCollateralAtomic: uiToAtomic("0.5", 8),
      heldEquivalents: held("50"),
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
    if (live.kind === "convert-then-deposit") {
      console.log(
        `        send=${atomicToUi(live.sourceAmountAtomic, 18)} TSLAon` +
          `  minOut=${atomicToUi(live.quote.toAmountMinAtomic, 8)} TSLAx` +
          `  loss=${((live.quote.lossFraction ?? 0) * 100).toFixed(2)}%` +
          `  fees=$${live.quote.totalFeesUsd ?? "?"}`,
      );
      check(
        "live minimum clears the live shortfall",
        BigInt(live.quote.toAmountMinAtomic) >= BigInt(live.shortfallAtomic),
      );
      // Live payloads omit fromAmountUsd, so this exercises the unit-parity
      // fallback. A conversion that costs real fees must never report 0% loss.
      check(
        "live loss fraction is populated and non-zero",
        live.quote.lossFraction !== null && live.quote.lossFraction > 0,
        `${((live.quote.lossFraction ?? 0) * 100).toFixed(2)}%`,
      );
    } else {
      console.log("        (not a conversion plan; see reason above)");
    }
  } catch (err) {
    console.log(
      `        SKIPPED — no dev server at ${origin} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  console.log(`\n${failures === 0 ? "All offline checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
