// Live check for the Morpho-on-Monad funding leg: can Trustware convert
// Solana USDC into Monad USDC, and does the route come back in the shape
// lib/morpho/fund.ts executes?
//
//   TRUSTWARE_API_KEY=... npx tsx scripts/morpho-fund-check.mts
//   (or: set -a; . ./.env.local; set +a; npx tsx scripts/...)
//
// Read-only. It creates route intents, which cost nothing and move no funds,
// and it signs and submits nothing.
//
// What this verified when the funding leg was built (2026-08-25):
//   - Monad (chainId "143") is listed by GET /routes/chains.
//   - /quote and /route both price solana-USDC -> monad-USDC (provider "lifi",
//     ~0.3% total fees plus a $0.025 fixed fee at a 10 USDC size).
//   - Native MON is quotable via the zero-address sentinel: 0.5 USDC delivered
//     ~17 MON (MON ~ $0.03). This is the deposit flow's gas top-up leg; the
//     embedded wallet is born with no MON and cannot pay for its own approve.
//   - For the Solana source, execution.transaction carries ONLY `data`: a
//     base64 Solana transaction. No EVM fields (to/chainId/gas).
//   - execution.approvals echoes an ERC-20-style approval with a Solana mint
//     and LI.FI's Solana chain id (1151111081099710). It is meaningless on
//     Solana and fund.ts ignores approvals entirely for this leg.

import { USDC_MINT } from "../lib/jupiter/constants";
import { MONAD_CHAIN_ID, MONAD_USDC } from "../lib/morpho/constants";
import { planMorphoDeposit } from "../lib/morpho/fund";
import {
  TRUSTWARE_API_ROOT,
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";
import type {
  TrustwareQuoteRequest,
  TrustwareQuoteResponse,
} from "../lib/trustware/types";

// Any valid, existing Solana pubkey. Funding does not change quote/route
// outcomes (established by scripts/trustware-solana-route-check.mts).
const SOL_ADDR = "HYyEoLDLMmL2wtKczx6JLNeUc7RqUnXGUUnPudwiAbN4";
const EVM_ADDR = "0x1111111111111111111111111111111111111111";

function apiKey(): string {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) throw new Error("TRUSTWARE_API_KEY is not set");
  return key;
}

const request = {
  fromChain: TRUSTWARE_SOLANA_CHAIN,
  toChain: String(MONAD_CHAIN_ID),
  fromToken: USDC_MINT,
  toToken: MONAD_USDC.address,
  fromAmount: "10000000", // 10 USDC
  fromAddress: SOL_ADDR,
  toAddress: EVM_ADDR,
  slippage: 1,
};

async function post(endpoint: "quote" | "route") {
  const res = await fetch(`${TRUSTWARE_API_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify(request),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  console.log("=== Monad in Trustware's chain list ===");
  const chainsRes = await fetch(`${TRUSTWARE_API_BASE_URL}/chains`, {
    headers: { "x-api-key": apiKey() },
  });
  const chainsText = await chainsRes.text();
  const hasMonad = /"chainId"\s*:\s*"143"/.test(chainsText);
  console.log(`  ${chainsRes.status} chainId "143" listed: ${hasMonad ? "OK" : "MISSING!"}`);

  console.log("\n=== Quote: 10 solana-USDC -> monad-USDC ===");
  const quote = await post("quote");
  const qData = (quote.json.data ?? quote.json) as Record<string, unknown>;
  const qEst = (qData.estimate ?? {}) as Record<string, string>;
  console.log(
    `  ${quote.status} toAmount=${qEst.toAmount} min=${qEst.toAmountMin} feesUsd=${qEst.totalFeesUsd}`,
  );

  console.log("\n=== Route: same request ===");
  const route = await post("route");
  const rData = (route.json.data ?? route.json) as Record<string, unknown>;
  const rRoute = (rData.route ?? rData) as Record<string, unknown>;
  const exec = rRoute.execution as
    | { transaction?: Record<string, unknown>; approvals?: unknown[] }
    | undefined;
  const tx = exec?.transaction;
  const data = tx?.data as string | undefined;
  const isBase64Solana = Boolean(data) && !data!.startsWith("0x");
  console.log(`  ${route.status} provider=${rRoute.provider} intentId=${rData.intentId}`);
  console.log(
    `  transaction keys: [${tx ? Object.keys(tx).join(",") : "-"}]` +
      ` base64-solana tx: ${isBase64Solana ? "OK" : "MISSING!"}` +
      (data ? ` (${data.length} chars)` : ""),
  );
  console.log(
    `  approvals echoed (ignored by fund.ts): ${exec?.approvals?.length ?? 0}`,
  );

  // The real planner, quoting through the live API directly (the browser goes
  // through /api/trustware/quote instead; the sizing code is identical).
  console.log("\n=== planMorphoDeposit: 25 USDC deposit, 5 on Monad, 100 on Solana ===");
  const directQuote = async (
    req: TrustwareQuoteRequest,
  ): Promise<TrustwareQuoteResponse> => {
    const res = await fetch(`${TRUSTWARE_API_BASE_URL}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey() },
      body: JSON.stringify(req),
    });
    return (await res.json()) as TrustwareQuoteResponse;
  };
  // monBalanceAtomic "0" forces the gas top-up leg as well, exercising both.
  const plan = await planMorphoDeposit({
    depositAtomic: 25_000_000n,
    monadUsdcAtomic: "5000000",
    solanaUsdcAtomic: "100000000",
    monBalanceAtomic: "0",
    solanaAddress: SOL_ADDR,
    evmAddress: EVM_ADDR,
    fetchQuote: directQuote,
  });
  if (plan.kind === "fund-then-deposit") {
    if (plan.funding) {
      console.log(
        `  USDC leg: send ${plan.funding.sourceAmountAtomic} (atomic) Solana USDC,` +
          ` min out ${plan.funding.toAmountMinAtomic}, shortfall ${plan.shortfallAtomic},` +
          ` feesUsd=${plan.funding.totalFeesUsd}`,
      );
      const ok = BigInt(plan.funding.toAmountMinAtomic) >= BigInt(plan.shortfallAtomic);
      console.log(`  guaranteed minimum covers the shortfall: ${ok ? "OK" : "SHORT!"}`);
    } else {
      console.log("  no USDC leg (unexpected for this input)");
    }
    if (plan.gas) {
      console.log(
        `  gas leg: send ${plan.gas.sourceAmountAtomic} (atomic) USDC,` +
          ` min out ${Number(plan.gas.toAmountMinAtomic) / 1e18} MON,` +
          ` feesUsd=${plan.gas.totalFeesUsd}`,
      );
    } else {
      console.log("  no gas leg (unexpected: monBalanceAtomic was 0)");
    }
  } else {
    console.log(`  unexpected plan: ${JSON.stringify(plan)}`);
  }
  // The return leg: Monad USDC back to canonical Solana USDC. An EVM-source
  // route (chainId-143 transaction plus ERC-20 approval), executed by
  // executeEvmRoute in lib/trustware/execute.ts.
  console.log("\n=== Return-leg quote: 10 monad-USDC -> solana-USDC ===");
  const backRes = await fetch(`${TRUSTWARE_API_BASE_URL}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify({
      fromChain: String(MONAD_CHAIN_ID),
      toChain: TRUSTWARE_SOLANA_CHAIN,
      fromToken: MONAD_USDC.address,
      toToken: USDC_MINT,
      fromAmount: "10000000",
      fromAddress: EVM_ADDR,
      toAddress: SOL_ADDR,
      slippage: 1,
    }),
  });
  const backJson = (await backRes.json()) as Record<string, unknown>;
  const backData = (backJson.data ?? backJson) as Record<string, unknown>;
  const backEst = (backData.estimate ?? {}) as Record<string, string>;
  console.log(
    `  ${backRes.status} toAmount=${backEst.toAmount} min=${backEst.toAmountMin} feesUsd=${backEst.totalFeesUsd}`,
  );

  console.log(`\n  API root: ${TRUSTWARE_API_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
