// Borrow-funded hedge verification.
//
// The position this checks: borrow USDC against an xStock, post it as Lighter
// margin, and short the same stock so the two cancel. Nothing about it is
// atomic and both legs can be liquidated, in opposite directions, so the
// arithmetic is worth asserting against the live venue rather than a fixture.
//
//   TRUSTWARE_API_KEY=... npx tsx scripts/lighter-borrow-hedge-check.mts
//   (or: set -a; . ./.env.local; set +a; npx tsx scripts/...)
//
// Read-only. It reads Lighter's public catalog and creates Trustware route
// intents, which cost nothing and move no funds. It signs and submits nothing.
//
// Section 6 is the one to watch, and the reason it walks sizes and reports rather
// than asserting a threshold: whether a bridge road can be SIGNED depends on
// which provider wins Trustware's price auction at that size. LI.FI returns a
// Solana transaction, relay returns none, and the crossover between them moves
// within the hour. Arbitrum has been measured signing every size to $5,000 and,
// twenty minutes later, refusing at $1,000 while still signing at $250. So the
// numbers printed there are a snapshot, not a contract. The flow is built not to
// depend on them: lib/lighter/one-click.ts probes the road before it borrows and
// falls back to the Solana road when the answer is no.

import {
  borrowLiquidationDrop,
  borrowRouteFor,
  borrowRoutes,
  healthAt,
  safeMaxBorrowRatio,
} from "../lib/borrow/route";
import {
  chooseFundingRoute,
  destinationShapeMatches,
  fundingRoute,
  FUNDING_ROUTES,
  MAX_FUNDING_LOSS_BPS,
} from "../lib/lighter/borrow-funding";
import {
  defaultBorrowRatioFor,
  planBorrowHedge,
  PREFERRED_BORROW_RATIO,
  type BorrowHedgePlan,
} from "../lib/lighter/borrow-hedge";
import { hedgeRouteFor, hedgeRoutes } from "../lib/lighter/hedge";
import { buildCatalog, findMarket } from "../lib/lighter/markets";
import { lighterOrderBookDetails } from "../lib/lighter/server";
import type { LighterMarket } from "../lib/lighter/types";
import { uiToAtomic } from "../lib/trustware/amounts";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  pass  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

function pct(value: number | null | undefined): string {
  return value == null ? "  n/a" : `${(value * 100).toFixed(1)}%`;
}

// ── 1. Borrow routes and their unit normalisation ───────────────────────────

function checkRoutes() {
  console.log("\n1. Borrow routes: which venue, and are the units normalised");

  const routes = borrowRoutes();
  check("both venues resolve", routes.length > 0, `${routes.length} mints`);

  // Jupiter carries tenths of a percent, Kamino a fraction and a whole percent.
  // Both must come out of the resolver as fractions of 1. A route whose factor
  // reads above 1 is a unit bug, and it would size a borrow ten times too large.
  const bad = routes.filter(
    (r) =>
      !(r.collateralFactor > 0 && r.collateralFactor < 1) ||
      !(r.liquidationThreshold > 0 && r.liquidationThreshold <= 1),
  );
  check("every factor and threshold is a fraction of 1", bad.length === 0,
    bad.map((r) => `${r.collateralSymbol} ${r.collateralFactor}`).join(", "));

  // A threshold at or below the factor would mean a position is liquidatable the
  // instant it is opened at max draw.
  const inverted = routes.filter((r) => r.liquidationThreshold <= r.collateralFactor);
  check("liquidation threshold sits above the collateral factor", inverted.length === 0,
    inverted.map((r) => r.collateralSymbol).join(", "));

  // Jupiter is preferred where both exist, and the preference is only defensible
  // if its terms are actually better. Asserted so a change upstream surfaces.
  const tsla = borrowRouteFor("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB");
  check("TSLAx resolves to Jupiter", tsla?.venue === "jupiter", tsla?.venueLabel);
  check("TSLAx factor reads 65%", tsla?.collateralFactor === 0.65,
    String(tsla?.collateralFactor));
  check("TSLAx threshold reads 75%", tsla?.liquidationThreshold === 0.75,
    String(tsla?.liquidationThreshold));

  // A Kamino-only mint, to prove the fallback and its separate unit handling.
  const hood = routes.find((r) => r.collateralSymbol === "HOODx");
  check("HOODx falls back to Kamino", hood?.venue === "kamino", hood?.venueLabel);

  console.log("\n     venue        symbol   factor  liq.thr  safe max draw");
  for (const r of routes) {
    console.log(
      `     ${r.venueLabel.padEnd(12)} ${r.collateralSymbol.padEnd(8)} ` +
        `${pct(r.collateralFactor)}   ${pct(r.liquidationThreshold)}   ` +
        `${pct(safeMaxBorrowRatio(r))}`,
    );
  }
}

// ── 2. Coverage: what can actually be hedged this way ───────────────────────

function checkCoverage(catalog: LighterMarket[]) {
  console.log("\n2. Coverage: a borrow market AND a Lighter market");

  const routable: string[] = [];
  const borrowOnly: string[] = [];

  for (const r of borrowRoutes()) {
    const hedge = hedgeRouteFor(r.collateralSymbol);
    if (!hedge) {
      borrowOnly.push(r.collateralSymbol);
      continue;
    }
    const market = findMarket(catalog, hedge.market);
    if (market?.tradeable) routable.push(r.collateralSymbol);
    else borrowOnly.push(`${r.collateralSymbol} (${hedge.market} not tradeable)`);
  }

  check("nine or more assets are fully routable", routable.length >= 9,
    routable.join(", "));
  console.log(`     borrowable but not hedgeable: ${borrowOnly.join(", ") || "none"}`);

  // The reverse gap, for the record: hedgeable but nothing lends against it, so
  // these keep the existing wallet-USDC funding path. Derived from the hedge
  // table rather than hardcoded, so a new borrow market moves an asset out of
  // this list without anyone editing the script.
  const lendable = new Set(borrowRoutes().map((r) => r.collateralSymbol));
  const hedgeOnly = hedgeRoutes()
    .map((h) => h.xstockSymbol)
    .filter((s) => !lendable.has(s));
  console.log(`     hedgeable but not borrowable: ${hedgeOnly.join(", ")}`);

  return routable;
}

// ── 3. The plan, against the live catalog ───────────────────────────────────

function checkPlans(catalog: LighterMarket[]) {
  console.log(
    `\n3. Plans on a $2,000 holding, asking for ${PREFERRED_BORROW_RATIO * 100}% and settling for what the venue lends`,
  );
  console.log(
    "\n     asset    market   ratio  borrow    margin    short     cover  lev   health  fall   rise",
  );

  const route = fundingRoute("solana-cctp");

  for (const r of borrowRoutes()) {
    const hedge = hedgeRouteFor(r.collateralSymbol);
    if (!hedge) continue;
    const market = findMarket(catalog, hedge.market);
    if (!market?.tradeable) continue;

    // Mark price stands in for the token price. Every routable asset is an exact
    // match, so the two track the same instrument at the same level by
    // construction; the one proxy route (GLDx) has no borrow market and so never
    // reaches here.
    const price = Number(market.markPrice);
    const quantity = (2000 / price).toFixed(8);

    const plan = planBorrowHedge({
      xstockSymbol: r.collateralSymbol,
      quantity,
      tokenPriceUsd: market.markPrice,
      borrowRoute: r,
      hedgeRoute: hedge,
      market,
      funding: route,
    });

    if (plan.kind === "blocked") {
      console.log(
        `     ${r.collateralSymbol.padEnd(8)} ${market.symbol.padEnd(8)} blocked: ${plan.reason}`,
      );
      // A $2,000 holding at 50% clears every minimum on every venue, so a block
      // here is a real regression rather than a small-size edge case.
      failures += 1;
      continue;
    }

    console.log(
      `     ${plan.xstockSymbol.padEnd(8)} ${plan.marketSymbol.padEnd(8)} ` +
        `${pct(plan.borrowRatio)}  ` +
        `$${plan.borrowedUsd.toFixed(0).padStart(6)}  ` +
        `$${plan.marginUsd.toFixed(0).padStart(6)}  ` +
        `$${plan.shortNotionalUsd.toFixed(0).padStart(6)}  ` +
        `${pct(plan.coverage)}  ${plan.leverage.toFixed(2)}x  ` +
        `${plan.risk.borrowHealth.toFixed(2)}   ` +
        `${pct(plan.risk.borrowLiquidationDrop)}  ` +
        `${pct(plan.risk.shortLiquidationRise)}`,
    );

    assertPlanInvariants(plan, r.collateralSymbol);
  }
}

function assertPlanInvariants(plan: BorrowHedgePlan, symbol: string) {
  if (plan.kind !== "ok") return;

  // The whole point of the position. Coverage below 1 is allowed (an increment
  // or a leverage cap can bind) but above 1 would mean the "hedge" is a net
  // short, which is the one outcome that must be impossible.
  if (plan.coverage > 1) {
    failures += 1;
    console.log(`  FAIL  ${symbol}: coverage ${plan.coverage} exceeds 1, that is a net short`);
  }

  // borrowRatio * leverage == 1 is the neutrality invariant. Only the funding
  // spread and the size increment may push it off, so it is checked loosely
  // rather than exactly.
  const product = plan.borrowRatio * plan.leverage;
  if (Math.abs(product - 1) > 0.02) {
    failures += 1;
    console.log(
      `  FAIL  ${symbol}: borrowRatio * leverage = ${product.toFixed(4)}, expected 1`,
    );
  }

  // Both directions must be reported. A plan that knows only one of them looks
  // safe in exactly the direction it is not.
  if (plan.risk.borrowLiquidationDrop == null || plan.risk.shortLiquidationRise == null) {
    failures += 1;
    console.log(`  FAIL  ${symbol}: a liquidation distance is missing`);
  }

  if (plan.netExposureUsd < 0) {
    failures += 1;
    console.log(`  FAIL  ${symbol}: net exposure went negative`);
  }
}

// ── 4. The refusals ─────────────────────────────────────────────────────────

function checkRefusals(catalog: LighterMarket[]) {
  console.log("\n4. Refusals: the cases that must not produce an order");

  const route = borrowRouteFor("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB")!;
  const hedge = hedgeRouteFor("TSLAx")!;
  const market = findMarket(catalog, hedge.market)!;
  const price = Number(market.markPrice);

  const plan = (holdingUsd: number, borrowRatio?: number) =>
    planBorrowHedge({
      xstockSymbol: "TSLAx",
      quantity: (holdingUsd / price).toFixed(8),
      tokenPriceUsd: market.markPrice,
      borrowRoute: route,
      hedgeRoute: hedge,
      market,
      funding: fundingRoute("solana-cctp"),
      borrowRatio,
    });

  const tiny = plan(4);
  check("a $4 holding is refused", tiny.kind === "blocked",
    tiny.kind === "blocked" ? tiny.reason : "produced a plan");

  const greedy = plan(2000, 0.95);
  check("a 95% borrow is refused", greedy.kind === "blocked",
    greedy.kind === "blocked" ? greedy.reason : "produced a plan");

  // Right at the venue's own factor, which is above the safe cap. Must refuse:
  // a borrow that lands exactly at the factor is one oracle tick from being
  // unwindable only at a loss.
  const atCap = plan(2000, route.collateralFactor);
  check("a borrow at exactly the collateral factor is refused",
    atCap.kind === "blocked",
    atCap.kind === "blocked" ? atCap.reason : "produced a plan");

  const atSafeCap = plan(2000, safeMaxBorrowRatio(route));
  check("a borrow at the safe cap is allowed", atSafeCap.kind === "ok",
    atSafeCap.kind === "blocked" ? atSafeCap.reason : "");

  // Health must fall as the draw rises, and cross 1.0 only past the threshold.
  check("health at the liquidation threshold is exactly 1",
    Math.abs(healthAt(route, route.liquidationThreshold) - 1) < 1e-9);
  check("a zero draw cannot be liquidated",
    borrowLiquidationDrop(route, 0) === null);

  // The default adapts to the venue instead of asking every market for 50%.
  // Jupiter lends enough against TSLAx to grant it; Kamino does not against
  // MSTRx, and the plan must settle rather than refuse.
  const mstr = borrowRoutes().find((r) => r.collateralSymbol === "MSTRx")!;
  check("TSLAx defaults to the full 50%",
    defaultBorrowRatioFor(route) === 0.5, pct(defaultBorrowRatioFor(route)));
  check("MSTRx defaults down to what Kamino lends",
    defaultBorrowRatioFor(mstr) < 0.5 &&
      defaultBorrowRatioFor(mstr) === safeMaxBorrowRatio(mstr),
    pct(defaultBorrowRatioFor(mstr)));
}

// ── 5. Funding roads ────────────────────────────────────────────────────────

function checkFunding() {
  console.log("\n5. Funding roads");

  console.log("\n     road                 delivers   sigs      lag   loss   min");
  for (const r of FUNDING_ROUTES) {
    console.log(
      `     ${r.id.padEnd(20)} ${r.deliversOn.padEnd(10)} ` +
        `${r.solanaSignatures}sol/${r.evmSignatures}evm  ` +
        `${String(r.latencyMinutesEstimate).padStart(3)}m  ` +
        `${String(r.plannedLossBps).padStart(4)}bp  $${r.minimumUsd}`,
    );
  }

  // No road may require an EVM signature. Every one of them delivers to an
  // address the solver reaches on its own, which is what keeps the embedded EVM
  // wallet, born without gas, out of the flow entirely.
  check("no road needs an EVM signature",
    FUNDING_ROUTES.every((r) => r.evmSignatures === 0));

  const noKey = chooseFundingRoute(
    { hasBuilderKey: false, trustwareChains: [] },
    500,
  );
  check("without a builder key or Trustware, the CCTP road is chosen",
    noKey?.id === "solana-cctp", noKey?.id);

  // Base is the preferred bridge road and the chooser no longer second-guesses
  // it on size: whether a road can be signed is settled at runtime by
  // prepareSolanaBridge at pay time, not by a constant here. Two constants were tried and both
  // were contradicted within the hour.
  const bridged = chooseFundingRoute(
    { hasBuilderKey: false, trustwareChains: ["arbitrum", "base"] },
    500,
  );
  check("a $500 deposit prefers Base", bridged?.id === "trustware-base",
    bridged?.id);

  const arbOnly = chooseFundingRoute(
    { hasBuilderKey: false, trustwareChains: ["arbitrum"] },
    500,
  );
  check("with only Arbitrum available, it is chosen",
    arbOnly?.id === "trustware-arbitrum", arbOnly?.id);

  check("both bridge roads are marked probe-before-use",
    fundingRoute("trustware-base").probeBeforeUse &&
      fundingRoute("trustware-arbitrum").probeBeforeUse);
  check("neither Solana road needs probing",
    !fundingRoute("solana-cctp").probeBeforeUse &&
      !fundingRoute("solana-uda").probeBeforeUse);

  const withKey = chooseFundingRoute(
    { hasBuilderKey: true, trustwareChains: ["arbitrum", "base"] },
    500,
  );
  check("with a builder key, the UDA road wins", withKey?.id === "solana-uda",
    withKey?.id);

  const belowMin = chooseFundingRoute(
    { hasBuilderKey: true, trustwareChains: [] },
    2,
  );
  check("$2 is below every minimum", belowMin === undefined, belowMin?.id);

  // The shape guard. Sending a base58 address on an EVM road, or the reverse,
  // loses the funds outright.
  const evm = "0x2222222222222222222222222222222222222222";
  const sol = "So1anaDepositAddressExample11111111111111111";
  check("an EVM address is rejected on a Solana road",
    !destinationShapeMatches(fundingRoute("solana-cctp"), evm));
  check("a Solana address is rejected on an EVM road",
    !destinationShapeMatches(fundingRoute("trustware-arbitrum"), sol));
  check("matching shapes pass",
    destinationShapeMatches(fundingRoute("trustware-arbitrum"), evm) &&
      destinationShapeMatches(fundingRoute("solana-cctp"), sol));
}

// ── 6. The Trustware leg, against the real endpoint ─────────────────────────

const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Native USDC on each chain, from Circle's deployments. The Arbitrum address is
// the one Lighter's own bridge docs show a deposit arriving in.
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETHEREUM_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

// Any valid addresses. A route intent does not check funding, as
// trustware-solana-route-check.mts demonstrates.
//
// The destination must be an ordinary-looking address, though. A repeated-digit
// placeholder like 0x2222...2222 is screened somewhere upstream and silently
// drops the route to relay, which returns no signable transaction. That cost an
// afternoon: it made Monad, a healthy production path, look like an outage. Use
// a real address that holds no relevance to us rather than a pattern.
const FROM_SOL = "HYyEoLDLMmL2wtKczx6JLNeUc7RqUnXGUUnPudwiAbN4";
const TO_EVM = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

async function checkTrustwareLeg() {
  console.log("\n6. Trustware: can borrowed Solana USDC actually reach an EVM road");

  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) {
    console.log("     skipped, TRUSTWARE_API_KEY is not set");
    return;
  }

  const leg = async (label: string, toChain: string, toToken: string, ui: string) => {
    const body = {
      fromChain: TRUSTWARE_SOLANA_CHAIN,
      toChain,
      fromToken: SOLANA_USDC,
      toToken,
      fromAmount: uiToAtomic(ui, 6),
      fromAddress: FROM_SOL,
      // Deliver-direct. In production this is Lighter's intent address for the
      // chain, fetched from Lighter and never caller-supplied, which is the
      // guard lib/ondo/fund.ts applies to Ondo's deposit address.
      toAddress: TO_EVM,
      slippage: 0.3,
    };
    const res = await fetch(`${TRUSTWARE_API_BASE_URL}/route`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    // The estimate nests at data.route.estimate, not on the route itself, and
    // the transaction (when there is one) at data.route.execution.transaction.
    // Reading either off the route directly silently reports every road as
    // broken, which is exactly what an earlier version of this script did.
    const data = (json?.["data"] ?? json) as Record<string, unknown> | undefined;
    const route = (data?.["route"] ?? data) as Record<string, unknown> | undefined;
    const estimate = route?.["estimate"] as
      | { toAmount?: string; toAmountMin?: string; etaSeconds?: number }
      | undefined;
    const execution = route?.["execution"] as
      | { transaction?: { data?: string } }
      | undefined;
    const executable = Boolean(execution?.transaction?.data);
    const provider = (route?.["provider"] as string) ?? "-";

    // Guaranteed rather than expected, matching what execute.ts commits against.
    // A road that quotes well and guarantees badly still under-hedges.
    const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
    const lossBps =
      guaranteed != null
        ? ((Number(ui) - Number(guaranteed) / 1e6) / Number(ui)) * 10_000
        : null;

    console.log(
      `     ${label.padEnd(28)} ${res.status}  provider=${provider.padEnd(8)}` +
        `  signable=${executable ? "YES" : "NO "}` +
        (lossBps != null ? `  loss=${lossBps.toFixed(1).padStart(5)}bp` : "") +
        (estimate?.etaSeconds != null ? `  eta=${estimate.etaSeconds}s` : ""),
    );
    return { executable, lossBps, priced: guaranteed != null };
  };

  // Which sizes can actually be signed, per chain. Walked rather than asserted,
  // because the boundary is a pricing crossover and can move either way.
  const sweep = async (label: string, chain: string, token: string) => {
    console.log(`\n     ${label}, by size:`);
    let largest = 0;
    for (const ui of ["5", "10", "50", "250", "1000"]) {
      const r = await leg(`$${ui} -> ${label}`, chain, token, ui);
      if (r.executable) largest = Math.max(largest, Number(ui));
    }
    return largest;
  };

  const arbMax = await sweep("Arbitrum USDC", "42161", ARBITRUM_USDC);
  const baseMax = await sweep("Base USDC", "8453", BASE_USDC);

  console.log("\n     Controls:");
  const eth = await leg("$500 -> Ethereum USDC", "1", ETHEREUM_USDC, "500");
  // Monad is the counter-example. Relay does not outbid LI.FI there, so the same
  // Solana source signs at any size. If this row ever stops being signable,
  // lib/morpho/fund.ts is broken in production and that matters more than
  // anything else in this script.
  const monad = await leg("$500 -> Monad USDC (must be signable)", "143", MONAD_USDC, "500");

  // Deliberately NOT an assertion about how much Arbitrum will sign. That
  // number is a live price auction and moves within the hour: measured signing
  // every size to $5,000 (8 runs of 8), then refusing at $1,000 while still
  // signing at $250 twenty minutes later. Asserting a threshold here would make
  // this script fail on Trustware's mood rather than on our code. What must hold
  // is that the mechanism works at all, and that the one-click flow probes
  // before it borrows so a low ceiling costs a slower road and never a stranded
  // position (see the 1b step in lib/lighter/one-click.ts).
  check("at least one bridge road can still be signed",
    arbMax > 0 || baseMax > 0,
    `Arbitrum $${arbMax}, Base $${baseMax}`);
  check("Monad still signs, so shipped Morpho funding is healthy",
    monad.executable,
    monad.executable ? "" : "lib/morpho/fund.ts CANNOT SIGN — this is a production outage");
  check("Ethereum still prices", eth.priced);
  check("pricing stays inside the plan's bound",
    eth.lossBps != null && eth.lossBps <= MAX_FUNDING_LOSS_BPS,
    `eth ${eth.lossBps?.toFixed(1)}bp`);

  console.log(
    `\n     largest signable this run: Base $${baseMax}, Arbitrum $${arbMax}`,
  );
  console.log(
    "     note  these are a snapshot, not a contract. The crossover where relay\n" +
      "           outbids LI.FI moves within the hour, which is why nothing in\n" +
      "           lib/lighter/borrow-funding.ts encodes a ceiling and why\n" +
      "           one-click.ts probes the road before it borrows. A low number\n" +
      "           here costs a slower deposit, not a stranded position.",
  );
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const details = await lighterOrderBookDetails();
  const catalog = buildCatalog(details);
  console.log(`Lighter catalog: ${catalog.length} markets`);

  checkRoutes();
  checkCoverage(catalog);
  checkPlans(catalog);
  checkRefusals(catalog);
  checkFunding();
  await checkTrustwareLeg();

  console.log(
    failures === 0
      ? "\nAll checks passed.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
