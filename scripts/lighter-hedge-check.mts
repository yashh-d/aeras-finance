// Hedge tab verification. Checks the position read against live accounts and the
// exposure join against fixtures, so a change in either the wire shape or the
// coverage rules fails here rather than mis-stating whether a user is hedged.
//
//   npx tsx scripts/lighter-hedge-check.mts
//
// Read-only. Signs nothing and submits nothing.

import { readFileSync } from "node:fs";

import { Keypair, PublicKey } from "@solana/web3.js";

import {
  LIGHTER_API_BASE_URL,
  LIGHTER_API_PREFIX,
  LIGHTER_DEFAULT_INTENT_CHAIN,
  LIGHTER_MIN_CCTP_DEPOSIT_USDC,
} from "../lib/lighter/constants";
import { buildHedgeViews, coverageFor, hedgeTotals } from "../lib/lighter/exposure";
import { hedgeRouteFor, INDEX_LEVEL_MARKETS } from "../lib/lighter/hedge";
import { buildCatalog, findMarket } from "../lib/lighter/markets";
import { marginForLeverage } from "../lib/lighter/risk";
import { getConnection } from "../lib/solana/balances";
import { fundingBlock, resolveMarginFunding } from "../lib/lighter/funding";
import {
  lighterAccountDetail,
  lighterIntentAddress,
  lighterOrderBookDetails,
} from "../lib/lighter/server";
import { computeHedgeSize } from "../lib/lighter/sizing";
import type { LighterPosition } from "../lib/lighter/types";

// The deposit guard reads Solana, and lib/solana/balances.ts takes its RPC from
// the Next public env. Scripts are run as bare tsx, which does not load
// .env.local, so it is read here rather than making every invocation pass a flag.
if (!process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
  try {
    const match = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .find((line) => line.startsWith("NEXT_PUBLIC_SOLANA_RPC_URL="));
    if (match) {
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL = match.slice(match.indexOf("=") + 1).trim();
    }
  } catch {
    // Left unset. The deposit section reports it rather than failing the run.
  }
}

const { inspectIntentAccount } = await import("../lib/lighter/deposit");

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  pass  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

function note(label: string, value: string) {
  console.log(`        ${label}: ${value}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

// Held open positions when this was written. Used to exercise the filter against
// a real payload rather than a flat account, which would prove nothing.
const ACTIVE_ACCOUNT = 5;

// The leverage HedgePanel opens a hedge at. Asserted against the live market so
// it can never exceed what the exchange permits.
const HEDGE_LEVERAGE = 2;

function position(overrides: Partial<LighterPosition> = {}): LighterPosition {
  return {
    marketId: 0,
    symbol: "SPY",
    isShort: true,
    size: "1",
    notionalUsd: "776",
    entryPriceUsd: "776",
    unrealizedPnlUsd: "0",
    liquidationPriceUsd: "0",
    ...overrides,
  };
}

async function main() {
  console.log("Lighter hedge verification against mainnet\n");

  const catalog = buildCatalog(await lighterOrderBookDetails());
  const spy = findMarket(catalog, "SPY");

  // --- Position read ------------------------------------------------------
  section("Position read");

  const detail = await lighterAccountDetail(ACTIVE_ACCOUNT);
  check("account detail reads", typeof detail.index === "number");
  note("collateral", detail.collateralUsd);
  note("available", detail.availableBalanceUsd);
  note("open positions", String(detail.positions.length));

  // The same account straight from the wire, to prove the filter dropped
  // exactly the closed rows rather than an arbitrary number of them.
  const raw = (await (
    await fetch(
      `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/account?by=index&value=${ACTIVE_ACCOUNT}`,
    )
  ).json()) as {
    accounts?: { positions?: { position: string; sign: number }[] }[];
  };
  const rawPositions = raw.accounts?.[0]?.positions ?? [];
  const rawNonZero = rawPositions.filter((p) => Number(p.position) !== 0);

  check(
    "closed markets are dropped, open ones kept",
    detail.positions.length === rawNonZero.length,
    `${rawPositions.length} rows in, ${detail.positions.length} out`,
  );
  check(
    "every returned position has a non-zero size",
    detail.positions.every((p) => Number(p.size) !== 0),
  );
  // Direction lives in sign, not in the magnitude. If this ever inverted, every
  // short would read as a long and the tab would call an unhedged holding
  // hedged.
  check(
    "direction is taken from sign, not from the size",
    detail.positions.every((p) => Number(p.size) > 0),
  );
  check(
    "sign maps to isShort",
    detail.positions.every((p, i) => p.isShort === (rawNonZero[i].sign < 0)),
  );

  // --- Route sanity -------------------------------------------------------
  section("Route sanity");

  check("SPYx routes to a tradeable market", Boolean(spy?.tradeable));
  check(
    "GLDx routes to spot gold, not to a GLD market",
    hedgeRouteFor("GLDx")?.market === "XAU",
  );
  check(
    "no route lands on an index level market",
    !INDEX_LEVEL_MARKETS.some((m) =>
      ["SPYx", "QQQx"].some((x) => hedgeRouteFor(x)?.market === m),
    ),
  );

  // --- Coverage classification --------------------------------------------
  //
  // The user-facing claim of the whole tab. Perp sizes are quantized and the two
  // legs are priced independently, so an offset hedge never lands on exactly
  // 1.00 and a strict test would report a correct hedge as partial forever.
  section("Coverage classification");

  check("no short is unhedged", coverageFor(0) === "unhedged");
  check("a small short is partial", coverageFor(0.4) === "partial");
  check("an exact offset is hedged", coverageFor(1) === "hedged");
  check("rounding down still counts as hedged", coverageFor(0.99) === "hedged");
  check("rounding up still counts as hedged", coverageFor(1.01) === "hedged");
  check("a materially larger short is over-hedged", coverageFor(1.5) === "over-hedged");
  check("half covered is not called hedged", coverageFor(0.5) !== "hedged");

  // --- Exposure join ------------------------------------------------------
  section("Exposure join");

  const spyMint = "XsSPYmintxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const gldMint = "XsGLDmintxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

  const views = buildHedgeViews({
    holdings: [
      { xstockSymbol: "SPYx", mint: spyMint, quantity: "10" },
      { xstockSymbol: "GLDx", mint: gldMint, quantity: "5" },
    ],
    priceUsdByMint: { [spyMint]: 776, [gldMint]: 400 },
    catalog,
    positions: [position({ symbol: "SPY", notionalUsd: "7760" })],
  });

  check("a holding with a route produces a row", views.length === 2);
  check(
    "rows are ordered by exposure, largest first",
    views[0].holding.exposureUsd >= views[1].holding.exposureUsd,
  );

  const spyView = views.find((v) => v.holding.xstockSymbol === "SPYx");
  const gldView = views.find((v) => v.holding.xstockSymbol === "GLDx");

  check("exposure is quantity times price", spyView?.holding.exposureUsd === 7760);
  check("a matching short is found", spyView?.position !== null);
  check("a fully offset holding reads as hedged", spyView?.coverage === "hedged");
  check("an unhedged holding reads as unhedged", gldView?.coverage === "unhedged");
  // GLDx hedges against XAU. Matching positions by the xStock symbol rather than
  // the routed market would silently never find this one.
  check(
    "the proxy route is matched by market, not by ticker",
    gldView?.route.market === "XAU" && gldView?.market !== null,
  );

  // A long is not a hedge. Counting it as one would tell a user who is doubled
  // up that they are protected.
  const longOnly = buildHedgeViews({
    holdings: [{ xstockSymbol: "SPYx", mint: spyMint, quantity: "10" }],
    priceUsdByMint: { [spyMint]: 776 },
    catalog,
    positions: [position({ isShort: false, notionalUsd: "7760" })],
  });
  check("a long position is not counted as a hedge", longOnly[0].coverage === "unhedged");

  const unpriced = buildHedgeViews({
    holdings: [{ xstockSymbol: "SPYx", mint: spyMint, quantity: "10" }],
    priceUsdByMint: {},
    catalog,
    positions: [],
  });
  check(
    "a holding with no price does not divide by zero",
    unpriced[0].coverageRatio === 0,
  );

  const noRoute = buildHedgeViews({
    holdings: [{ xstockSymbol: "NOTAx", mint: "x", quantity: "10" }],
    priceUsdByMint: { x: 100 },
    catalog,
    positions: [],
  });
  check("an xStock with no market is left out", noRoute.length === 0);

  const totals = hedgeTotals(views);
  check("totals sum exposure across holdings", totals.exposureUsd === 7760 + 2000);
  check("totals sum shorts across holdings", totals.shortNotionalUsd === 7760);
  check(
    "portfolio coverage is notional weighted",
    Math.abs(totals.coverageRatio - 7760 / 9760) < 1e-9,
  );

  // --- Order sizing -------------------------------------------------------
  section("Order sizing");

  if (spy) {
    note("SPY mark", spy.markPrice);
    note("size decimals", String(spy.sizeDecimals));

    const size = computeHedgeSize({
      quantity: "10",
      tokenPriceUsd: spy.markPrice,
      hedgeRatio: 1,
      marketPriceUsd: spy.markPrice,
      sizeDecimals: spy.sizeDecimals,
      minBaseAmount: spy.minBaseAmount,
      minQuoteAmount: spy.minQuoteAmount,
      orderQuoteLimit: spy.orderQuoteLimit,
    });

    check("a ten share hedge sizes to an order", size.baseAmount !== "0");
    note("size", `${size.size} SPY`);
    note("notional", `$${size.notionalUsd}`);
    // Rounding down is what keeps a hedge from becoming a net short.
    check(
      "the order never exceeds the exposure it offsets",
      Number(size.notionalUsd) <= Number(size.exposureNotionalUsd),
    );
    check("effective ratio is reported, not assumed", size.effectiveRatio <= 1);

    const dust = computeHedgeSize({
      quantity: "0.0001",
      tokenPriceUsd: spy.markPrice,
      hedgeRatio: 1,
      marketPriceUsd: spy.markPrice,
      sizeDecimals: spy.sizeDecimals,
      minBaseAmount: spy.minBaseAmount,
      minQuoteAmount: spy.minQuoteAmount,
      orderQuoteLimit: spy.orderQuoteLimit,
    });
    check(
      "a holding under the minimum returns zero with a reason",
      dust.baseAmount === "0" && dust.limitedBy !== "none",
      dust.limitedBy,
    );

    // --- Panel leverage ---------------------------------------------------
    section("Panel leverage");

    const margin = marginForLeverage(10000, HEDGE_LEVERAGE, spy);
    check(
      "the panel's hedge leverage is inside what the market allows",
      !margin.clamped,
      `${HEDGE_LEVERAGE}x against a max of ${spy.maxLeverage}x`,
    );
    check(
      "margin is notional over leverage",
      Math.abs(margin.marginUsd - 10000 / HEDGE_LEVERAGE) < 1e-9,
    );
  }

  // --- Margin funding -----------------------------------------------------
  //
  // Which of the user's USDC can pay for a hedge, and why it cannot when it
  // cannot. Pure, so every branch is exercised without a wallet.
  section("Margin funding");

  const bnbStable = {
    chain: "56",
    chainLabel: "BNB Chain",
    symbol: "USDC" as const,
    // Binance-peg USDC is 18 decimals, not 6. Reading it at 6 would report this
    // 250 USDC holding as 250 trillion dollars.
    decimals: 18,
    balanceAtomic: "250000000000000000000",
    contract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  };

  const onSolana = resolveMarginFunding({
    solanaUsdcAtomic: "120000000",
    stables: [],
  });
  check("Solana USDC is read at 6 decimals", onSolana.readyUsd === 120);
  check("USDC already on Solana can fund now", onSolana.canFundNow);
  check("the direct route needs no bridge", onSolana.sources[0].route === "solana-direct");

  const offChain = resolveMarginFunding({
    solanaUsdcAtomic: "0",
    stables: [bnbStable],
  });
  check("BNB Chain USDC is read at 18 decimals", offChain.bridgeableUsd === 250);
  check(
    "USDC on another chain cannot fund without bridging",
    !offChain.canFundNow && fundingBlock(offChain).kind === "bridge-first",
  );
  check(
    "a wallet with USDC elsewhere is not reported as empty",
    fundingBlock(offChain).kind !== "empty",
  );

  const both = resolveMarginFunding({
    solanaUsdcAtomic: "120000000",
    stables: [bnbStable],
  });
  check("total spans every chain", both.totalUsd === 370);
  // Ready first: the cheapest route is the one a user would pick by hand.
  check("the no-bridge source is offered first", both.sources[0].route === "solana-direct");

  const dust = resolveMarginFunding({ solanaUsdcAtomic: "1000000", stables: [] });
  check(
    "a balance under Lighter's minimum is not called spendable",
    !dust.canFundNow && fundingBlock(dust).kind === "below-minimum",
    `$1 against a $${LIGHTER_MIN_CCTP_DEPOSIT_USDC} minimum`,
  );
  check(
    "an empty wallet is reported as empty",
    fundingBlock(resolveMarginFunding({ solanaUsdcAtomic: "0", stables: [] })).kind ===
      "empty",
  );

  // --- Deposit destination guard ------------------------------------------
  //
  // The one check in this file that guards real money. Lighter's deposit address
  // is a bare SPL token account, so the ordinary wallet-to-wallet send would
  // derive an associated token address from it and deliver USDC to an account
  // nobody can sign for. Everything below asserts that the guard recognises the
  // real thing and refuses every shape that is not it.
  section("Deposit destination guard");

  if (!process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
    note("skipped", "NEXT_PUBLIC_SOLANA_RPC_URL is not set");
  } else {
    const intent = await lighterIntentAddress(
      "0x0000000000000000000000000000000000000000",
      LIGHTER_DEFAULT_INTENT_CHAIN,
    );
    note("intent address", intent);

    const live = await inspectIntentAccount(intent);
    check("the live intent address is usable", live.usable, live.problem ?? "");
    // Non-zero means a deposit has landed on Solana but Lighter has not credited
    // the L2 balance yet. Worth surfacing rather than reading as lost funds.
    note("unswept balance", `${live.pendingUsdc ?? "0"} atomic USDC`);

    check(
      "an unparseable address is refused",
      (await inspectIntentAccount("not-a-pubkey")).problem === "malformed",
    );
    check(
      "an address that does not exist is refused",
      (await inspectIntentAccount(Keypair.generate().publicKey.toBase58())).problem ===
        "missing",
    );
    // The intent account's own authority. A real, live account that is not a
    // token account, which is exactly the confusion the guard exists to catch.
    check(
      "a non-token account is refused",
      (await inspectIntentAccount("9FdmWyDEWuUpDeVRUxca8i8Hyd5LEPqe2gviKpBDTjUX"))
        .problem === "not-a-token-account",
    );

    // Real token accounts of other mints, found live rather than hardcoded so
    // the assertion cannot go stale against an account that closes.
    //
    // JitoSOL is a legacy SPL mint, so its accounts have the right owner program
    // and the wrong mint. PYUSD is Token-2022, which is the shape that actually
    // threatens this code: xStocks are Token-2022 too, so a future change that
    // widened the program check would be caught here.
    const others: [string, string, string][] = [
      ["a token account of the wrong mint is refused", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", "wrong-mint"],
      [
        "a Token-2022 account is refused",
        "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
        "not-a-token-account",
      ],
    ];
    for (const [label, mint, expected] of others) {
      const largest = await getConnection().getTokenLargestAccounts(
        new PublicKey(mint),
      );
      const account = largest.value[0]?.address.toBase58();
      if (!account) {
        note("skipped", `${label}: no live account for ${mint}`);
        continue;
      }
      check(label, (await inspectIntentAccount(account)).problem === expected, account);
    }
  }

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check${failures === 1 ? "" : "s"} failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nVerification could not run:", err instanceof Error ? err.message : err);
  process.exit(1);
});
