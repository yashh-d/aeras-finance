// Ondo Perps hedge slice verification. Checks the facts the sizing and risk
// math are built on against the live production API, so a change on Ondo's side
// shows up as a failed assertion rather than a mis-sized order.
//
//   npx tsx scripts/ondo-hedge-check.mts
//
// No dev server, no credentials: every endpoint used here is unauthenticated.
// Read-only. Signs nothing, submits nothing, moves nothing.

import { creditableCollateral } from "../lib/ondo/collateral";
import { ONDO_API_HOSTS, ONDO_DEPOSIT_NETWORK } from "../lib/ondo/constants";
import { buildOndoHedgeViews, ondoHedgeTotals } from "../lib/ondo/exposure";
import { hedgeRouteFor, resolveHedgeRoute } from "../lib/ondo/hedge";
import {
  buildCatalog,
  collateralAssets,
  collateralOnNetwork,
  findMarket,
  type OndoCatalog,
} from "../lib/ondo/markets";
import { previewHedge } from "../lib/ondo/preview";
import {
  autoExchangeCostUsd,
  autoExchangePriceMove,
  autoExchangeTrigger,
  projectLtv,
} from "../lib/ondo/risk";
import { ondoContracts, ondoMarkets } from "../lib/ondo/server";
import { computeHedgeSize } from "../lib/ondo/sizing";
import { XSTOCKS } from "../lib/jupiter/xstocks";
import { equivalenceByUnderlying } from "../lib/trustware/equivalents";

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

function usd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// What one token of the xStock is worth, which is not the same as the price of
// the perp it is hedged with. Ondo carries a perp for the underlying itself in
// every case except GLD, whose only market is spot gold at roughly 11x the ETF
// share price. That route falls back to the perp price, so its notional in the
// availability table below reads high by that multiple. The production path
// takes the token price from Jupiter and never has to guess.
function tokenPriceFor(catalog: OndoCatalog, xstockSymbol: string): string {
  const route = hedgeRouteFor(xstockSymbol);
  if (!route) return "0";

  const own = findMarket(catalog.markets, `${route.underlying}-USD.P`);
  if (own && Number(own.indexPrice) > 0) return own.indexPrice;

  const resolved = resolveHedgeRoute(route, catalog.markets);
  return resolved?.market.price ?? "0";
}

// Production, always. Sandbox disagrees with production about which markets are
// enabled and what the collateral addresses are, so asserting against sandbox
// would confirm the wrong facts. Section 9 checks that divergence deliberately.
const PROD = `https://${ONDO_API_HOSTS.production}`;
const SANDBOX = `https://${ONDO_API_HOSTS.sandbox}`;

async function main() {
  console.log(`Ondo Perps hedge check against ${PROD}`);

  const [markets, contracts] = await Promise.all([
    ondoMarkets(PROD),
    ondoContracts(PROD),
  ]);
  const catalog: OndoCatalog = {
    environment: "production",
    markets: buildCatalog(markets, contracts),
    collateral: collateralAssets(markets),
  };

  section("1. Market catalog");
  check("markets and contracts both returned", catalog.markets.length > 0 && contracts.length > 0,
    `${catalog.markets.length} pairs, ${contracts.length} tickers`);

  // A disabled market resolves by name and then rejects every order, so the
  // question is never "does this symbol exist". It is "which of this route's
  // candidates is tradeable right now", and Ondo has changed the answer once
  // already: SPY-USD.P and QQQ-USD.P carried disabled: true on 2026-08-10 and
  // are enabled, open and trading at ETF level on 2026-08-25. Nothing
  // announced it. The route table keeps both the exact market and an index
  // proxy for exactly this reason, so what is asserted here is that resolution
  // never lands on a market that would reject the order.
  const disabled = catalog.markets.filter((m) => !m.tradeable).map((m) => m.market).sort();
  note("all untradeable markets", disabled.join(", ") || "none");

  for (const symbol of ["SPYx", "QQQx"] as const) {
    const route = hedgeRouteFor(symbol);
    const resolved = route ? resolveHedgeRoute(route, catalog.markets) : undefined;
    check(`${symbol} resolves to a tradeable market`,
      resolved !== undefined && resolved.market.tradeable,
      resolved ? `${resolved.market.market} (${resolved.match})` : "no tradeable candidate");
    check(`${symbol} never routes to a disabled market`,
      resolved === undefined || !disabled.includes(resolved.market.market));
  }

  // The fallback is only worth keeping if it still exists. If Ondo ever retires
  // the index perps while the ETF markets are live, this is the warning.
  for (const symbol of ["US500-USD.P", "US100-USD.P"] as const) {
    check(`${symbol} is still available as a fallback`,
      findMarket(catalog.markets, symbol)?.tradeable === true);
  }

  section("2. Index perps price at index level, not ETF level");
  // Sizing a SPY hedge by share count instead of USD notional opens a position
  // many times too large. The multiple is not the same for the two indices
  // (SPY tracks about a tenth of the S&P level, QQQ about a fortieth of the
  // Nasdaq-100 level), which is exactly why sizing.ts converts through notional
  // instead of applying any fixed factor.
  for (const [indexMarket, etfMarket] of [
    ["US500-USD.P", "SPY-USD.P"],
    ["US100-USD.P", "QQQ-USD.P"],
  ] as const) {
    const index = findMarket(catalog.markets, indexMarket);
    const etf = findMarket(catalog.markets, etfMarket);
    if (!index || !etf) {
      check(`${indexMarket} and ${etfMarket} both present`, false);
      continue;
    }
    const ratio = Number(index.price) / Number(etf.indexPrice);
    check(`${indexMarket} is not priced 1:1 with ${etfMarket}`, ratio > 2,
      `${Number(index.price).toFixed(2)} vs ${Number(etf.indexPrice).toFixed(2)} = ${ratio.toFixed(2)}x`);
  }

  section("3. Per-market increments and caps");
  // maxPositionBaseSize is far tighter on the Nasdaq index perp than the S&P
  // one, and it binds at a holding a real user could have. The ETF markets are
  // capped in shares, so their USD ceilings are lower than the S&P proxy's
  // despite the larger base-unit number.
  for (const symbol of ["SPY-USD.P", "QQQ-USD.P", "US500-USD.P", "US100-USD.P"] as const) {
    const market = findMarket(catalog.markets, symbol);
    if (!market) {
      check(`${symbol} present`, false);
      continue;
    }
    const capUsd = Number(market.maxPositionBaseSize) * Number(market.price);
    check(`${symbol} exposes an increment and a position cap`,
      Number(market.baseIncrement) > 0 && Number(market.maxPositionBaseSize) > 0,
      `increment ${market.baseIncrement}, cap ${market.maxPositionBaseSize} base = ${usd(capUsd)}`);
    note(`${symbol} leverage`, `${market.maxLeverage}x, maintenance ${market.maintenanceMarginRate}`);
    note(`${symbol} state`, market.isClosed ? "closed" : "open");
  }

  section("4. Collateral: which assets Ondo credits, on which chains");
  const networks = new Set(catalog.collateral.flatMap((a) => a.networks.map((n) => n.network)));
  check("no Solana deposit path exists for any collateral asset", !networks.has("solana"),
    `networks: ${[...networks].sort().join(", ")}`);
  note("accepted collateral", catalog.collateral.map((a) => a.symbol).join(", "));

  // v1 hedges are margined with the stock being hedged, so a route is only live
  // if its Ondo token is still on this list.
  for (const symbol of ["SPYon", "QQQon"] as const) {
    const onchain = collateralOnNetwork(catalog.collateral, symbol, ONDO_DEPOSIT_NETWORK);
    check(`${symbol} is accepted as margin on ${ONDO_DEPOSIT_NETWORK}`, onchain !== undefined,
      onchain?.contractAddress ?? "absent");
  }
  for (const symbol of ["TSLAon", "NVDAon"] as const) {
    const onchain = collateralOnNetwork(catalog.collateral, symbol, ONDO_DEPOSIT_NETWORK);
    check(`${symbol} is still NOT accepted as margin`, onchain === undefined,
      "the reason TSLAx and NVDAx have no v1 hedge");
  }

  section("5. Registry addresses still match Ondo's live tokenConfig");
  // lib/trustware/equivalents.ts owns these addresses for the deposit leg. If
  // Ondo ever redeploys a token, the conversion would deliver the wrong asset.
  for (const [underlying, collateralSymbol] of [
    ["SPY", "SPYon"],
    ["QQQ", "QQQon"],
  ] as const) {
    const source = equivalenceByUnderlying(underlying)?.sources.find(
      (s) => s.issuer === "ondo" && s.kind === "evm" && s.chain === "1" && s.symbol === collateralSymbol,
    );
    const live = collateralOnNetwork(catalog.collateral, collateralSymbol, ONDO_DEPOSIT_NETWORK);
    check(`${collateralSymbol} address in equivalents.ts matches Ondo`,
      source !== undefined && live !== undefined &&
        source.token.toLowerCase() === live.contractAddress.toLowerCase(),
      `${source?.token ?? "missing"} vs ${live?.contractAddress.toLowerCase() ?? "missing"}`);
  }

  section("6. Sizing: 12 SPYx, on the exact market and on the proxy");
  // Both paths are exercised even though only one is live, because which one is
  // live is Ondo's to change. The proxy path is the one with the sharp edge:
  // sizing by share count there is off by the index-to-ETF multiple.
  const spy = findMarket(catalog.markets, "SPY-USD.P");
  if (!spy) {
    check("SPY-USD.P present for sizing", false);
  } else {
    const tokenPrice = spy.indexPrice;

    for (const symbol of ["SPY-USD.P", "US500-USD.P"] as const) {
      const market = findMarket(catalog.markets, symbol);
      if (!market) {
        check(`${symbol} present for sizing`, false);
        continue;
      }

      const size = computeHedgeSize({
        quantity: "12",
        tokenPriceUsd: tokenPrice,
        hedgeRatio: 1,
        marketPriceUsd: market.price,
        baseIncrement: market.baseIncrement,
        maxPositionBaseSize: market.maxPositionBaseSize,
      });
      note("exposure", usd(Number(size.exposureNotionalUsd)));
      note("order", `${size.size} ${market.market} = ${usd(Number(size.notionalUsd))}, limited by ${size.limitedBy}`);

      // Rounding to baseIncrement always costs something. It must cost less
      // than one increment of notional, and it must never round up.
      const shortfall = Number(size.targetNotionalUsd) - Number(size.notionalUsd);
      const oneIncrement = Number(market.baseIncrement) * Number(market.price);
      check(`${symbol} rounds down, never up`, shortfall >= 0, `shortfall ${usd(shortfall)}`);
      check(`${symbol} rounding cost is under one increment`, shortfall < oneIncrement,
        `one increment = ${usd(oneIncrement)}`);
      check(`${symbol} effective ratio lands within 1% of the request`,
        Math.abs(size.effectiveRatio - 1) < 0.01, size.effectiveRatio.toFixed(6));

      // A share-count hedge would short 12 base units instead. On the exact
      // market that is very nearly right, which is the point: the trap only
      // bites on the proxy, so the sizing path cannot be allowed to depend on
      // which market it happens to be pointed at.
      const naive = 12 * Number(market.price);
      note(`${symbol} if sized by share count instead`,
        `${usd(naive)}, ${(naive / Number(size.notionalUsd)).toFixed(1)}x the correct notional`);
    }
  }

  section("7. Auto-exchange triggers");
  // LTV(x) = r*x / (0.9(1+x)) for a fully self-collateralized hedge, so the
  // trigger sits at x = 0.27 / (r - 0.27). Below r = 0.27 the LTV converges
  // under the 30% threshold and no rally reaches it.
  const collateralValueUsd = 10_000;
  for (const [ratio, expected] of [
    [1, 0.3699],
    [0.75, 0.5625],
    [0.5, 1.1739],
  ] as const) {
    const move = autoExchangePriceMove({
      collateralValueUsd,
      shortNotionalUsd: collateralValueUsd * ratio,
      usdcBalanceUsd: 0,
    });
    check(`hedge ratio ${ratio} triggers at ${pct(expected)}`,
      move !== null && Math.abs(move - expected) < 0.001,
      move === null ? "never" : pct(move));
  }
  // Below a hedge ratio of 0.27 the LTV converges under the threshold and no
  // rally reaches it. The flat $100,000 debt cap is still reachable in
  // principle, so the combined trigger is finite but absurdly distant. Both
  // halves are asserted, because collapsing them loses the distinction between
  // "the collateral ratio holds" and "nothing can ever fire".
  const quarterHedge = {
    collateralValueUsd,
    shortNotionalUsd: collateralValueUsd * 0.25,
    usdcBalanceUsd: 0,
  };
  check(
    "hedge ratio 0.25 never triggers on the collateral ratio",
    autoExchangeTrigger(quarterHedge) === "debt-cap",
  );
  const safe = autoExchangePriceMove(quarterHedge);
  check(
    "its only trigger is the debt cap, far out of reach",
    safe !== null && safe > 10,
    safe === null ? "never" : `+${(safe * 100).toFixed(0)}%`,
  );

  // The two limits bind in opposite regimes. A large account reaches the flat
  // $100,000 ceiling long before 30% of its collateral is consumed, so a
  // trigger derived from LTV alone would sit in the wrong place for exactly the
  // positions with the most at stake.
  const large = {
    collateralValueUsd: 2_000_000,
    shortNotionalUsd: 2_000_000,
    usdcBalanceUsd: 0,
  };
  check(
    "a $2m hedge trips the flat debt cap, not the collateral ratio",
    autoExchangeTrigger(large) === "debt-cap",
    `${pct(autoExchangePriceMove(large) ?? 0)} move`,
  );

  // Auto-exchange over a weekend costs 2.5% of the debt on top, sold out of the
  // same collateral. A short accrues debt on a rally, and the weekend is when
  // the collateral cannot be sold into an open market, so the expensive case
  // and the likely case coincide.
  check(
    "a weekend auto-exchange sells 2.5% more collateral",
    Math.abs(autoExchangeCostUsd(1_000, true) - 1_025) < 0.001,
    `${usd(autoExchangeCostUsd(1_000, true))} of collateral to clear $1,000 of debt`,
  );
  check(
    "an open-market auto-exchange carries no such fee",
    autoExchangeCostUsd(1_000, false) === 1_000,
  );
  check("a fall in the market leaves LTV at zero",
    projectLtv({ collateralValueUsd, shortNotionalUsd: collateralValueUsd, usdcBalanceUsd: 0 }, -0.3) === 0);

  section("8. Hedge availability across the curated xStocks");
  for (const xstock of XSTOCKS) {
    const result = previewHedge({
      catalog,
      xstockSymbol: xstock.symbol,
      quantity: "10",
      tokenPriceUsd: tokenPriceFor(catalog, xstock.symbol),
      hedgeRatio: 1,
    });

    if (result.ok) {
      const trigger = result.risk.autoExchangePriceUsd;
      console.log(
        `  ${xstock.symbol.padEnd(7)} hedge via ${result.market.market.padEnd(12)} ` +
        `${result.size.size} base = ${usd(Number(result.size.notionalUsd))}, ` +
        `margin ${result.collateral.symbol}, ` +
        `auto-exchange at ${trigger === null ? "never" : usd(trigger)}` +
        `${result.basisRisk ? ", proxy" : ""}`,
      );
    } else {
      console.log(`  ${xstock.symbol.padEnd(7)} blocked: ${result.reason}`);
    }
  }

  // A hedge is offered only where the stock can post as its own margin, so this
  // set tracks Ondo's collateral list rather than its market list. CRCLon and
  // GLDon joined it between 2026-08-10 and 2026-08-25; TSLAon and NVDAon are
  // still absent despite both markets being live.
  const available = XSTOCKS.filter(
    (x) => previewHedge({
      catalog,
      xstockSymbol: x.symbol,
      quantity: "10",
      tokenPriceUsd: tokenPriceFor(catalog, x.symbol),
      hedgeRatio: 1,
    }).ok,
  ).map((x) => x.symbol);
  const expected = ["SPYx", "QQQx", "CRCLx", "GLDx"];
  check("hedgeable set matches Ondo's accepted collateral",
    available.length === expected.length && expected.every((s) => available.includes(s)),
    available.join(", ") || "none");

  section("9. Sandbox divergence");
  // Sandbox is a different exchange configuration, not production with fake
  // money. These assertions exist to keep that fact visible: they are expected
  // to pass while the environments differ, and a failure means the divergence
  // closed and the warnings in constants.ts and the doc can be relaxed.
  const sandbox = await ondoMarkets(SANDBOX);
  const sandboxCollateral = collateralAssets(sandbox);

  // The divergence that decides ONDO_PERPS_ENV. Sandbox does not list the
  // tokenized-equity collateral at all any more, so the self-collateralized
  // hedge, the entire reason this integration exists, cannot be exercised
  // there. On 2026-08-10 it listed them at different addresses, which was
  // already a trap; now the asset is simply absent.
  for (const symbol of ["SPYon", "QQQon"] as const) {
    const prod = collateralOnNetwork(catalog.collateral, symbol, ONDO_DEPOSIT_NETWORK);
    const sand = collateralOnNetwork(sandboxCollateral, symbol, ONDO_DEPOSIT_NETWORK);
    check(`${symbol} cannot be posted as margin in sandbox`,
      prod !== undefined && sand === undefined,
      sand === undefined
        ? "absent from sandbox tokenConfig"
        : `sandbox has it at ${sand.contractAddress.toLowerCase()}, production at ${prod?.contractAddress.toLowerCase()}`);
  }

  note("sandbox collateral", sandboxCollateral.map((a) => a.symbol).join(", ") || "none");

  const sandboxNetworks = new Set(
    sandboxCollateral.flatMap((a) => a.networks.map((n) => n.network)),
  );
  check("sandbox advertises a Solana deposit path that production does not",
    sandboxNetworks.has("solana") && !networks.has("solana"),
    `sandbox: ${[...sandboxNetworks].sort().join(", ")}`);

  // The two environments disable different sets, in both directions. This is
  // the assertion that says "do not carry an enabled flag across environments"
  // in executable form.
  const sandboxDisabled = sandbox.perps.tradingPairs
    .filter((p) => p.disabled === true)
    .map((p) => p.market)
    .sort();
  const onlySandbox = sandboxDisabled.filter((m) => !disabled.includes(m));
  const onlyProd = disabled.filter((m) => !sandboxDisabled.includes(m));
  check("the disabled sets still differ between environments",
    onlySandbox.length > 0 || onlyProd.length > 0,
    `sandbox-only: ${onlySandbox.join(", ") || "none"} | production-only: ${onlyProd.join(", ") || "none"}`);

  section("10. Hedge rows, as the panel builds them");

  // The pure join the Ondo hedge surface renders from. Exercised against the
  // live catalog with a synthetic holding and a synthetic short, because the
  // arithmetic is what a user reads before committing money and none of it
  // needs a browser to check.
  const collateral = creditableCollateral(
    collateralAssets(markets),
    catalog.markets,
  );
  const spyMarket = findMarket(catalog.markets, "SPY-USD.P");
  const spyPrice = Number(spyMarket?.indexPrice ?? "0");

  const rows = buildOndoHedgeViews({
    holdings: [
      { xstockSymbol: "SPYx", mint: "spy-mint", quantity: "10" },
      { xstockSymbol: "AAPLx", mint: "aapl-mint", quantity: "20" },
    ],
    priceUsdByMint: { "spy-mint": spyPrice, "aapl-mint": 300 },
    markets: catalog.markets,
    positions: [
      {
        market: "SPY-USD.P",
        direction: "short",
        netQuantity: "5",
        averageEntryPrice: String(spyPrice),
        usedMargin: "0",
        unrealizedPnl: "0",
        markPrice: String(spyPrice),
        liquidationPrice: "0",
        bankruptcyPrice: "0",
        maintenanceMargin: "0",
        // Half the 10-token holding, so coverage should read 50%.
        notionalValue: String(spyPrice * 5),
        leverage: "2",
        netFundingSinceNeutral: "0",
        returnOnEquity: "0",
      },
    ],
    collateral,
    usdcBalanceUsd: 0,
  });

  const spyRow = rows.find((r) => r.holding.xstockSymbol === "SPYx");
  const aaplRow = rows.find((r) => r.holding.xstockSymbol === "AAPLx");

  check("a holding with a short reports partial coverage",
    spyRow?.coverage === "partial" && Math.abs(spyRow.coverageRatio - 0.5) < 0.01,
    spyRow ? `${(spyRow.coverageRatio * 100).toFixed(1)}%` : "no row");

  // The distinctive number on this venue: what the holding credits if posted as
  // its own margin. 10 SPYon at a 10% haircut is 9 tokens' worth.
  //
  // Marked at SPYon's own mark price, which is the market's last trade, not the
  // index price used above to value the holding. Ondo credits collateral at the
  // mark, so the two figures differ slightly and conflating them would put a
  // wrong margin number in front of the user.
  const spyonMark = Number(
    collateral.find((c) => c.symbol === "SPYon")?.markPriceUsd ?? "0",
  );
  check("the row knows what the holding would credit as margin",
    spyRow?.creditableUsd !== null &&
      Math.abs((spyRow?.creditableUsd ?? 0) - spyonMark * 10 * 0.9) < 0.01,
    spyRow?.creditableUsd
      ? `${usd(spyRow.creditableUsd)} at a ${usd(spyonMark)} mark`
      : "null");

  // AAPLon is not accepted collateral, so the row must say so rather than
  // implying the holding can pay for its own hedge.
  check("a holding with no Ondo collateral reports none",
    aaplRow?.collateral === null && aaplRow?.creditableUsd === null);

  // A short exists, so the auto-exchange trigger is projectable. It is the
  // number that ends a self-collateralized hedge before liquidation does.
  check("an open hedge carries an auto-exchange trigger",
    spyRow?.autoExchangePriceUsd !== null && spyRow?.autoExchangeTrigger !== "never",
    spyRow?.autoExchangePriceUsd
      ? `${usd(spyRow.autoExchangePriceUsd)} via ${spyRow.autoExchangeTrigger}`
      : "none");

  // A long on the hedge market is not a hedge. Counting it as one would report
  // a user who is doubly long as covered.
  const longOnly = buildOndoHedgeViews({
    holdings: [{ xstockSymbol: "SPYx", mint: "spy-mint", quantity: "10" }],
    priceUsdByMint: { "spy-mint": spyPrice },
    markets: catalog.markets,
    positions: [
      {
        market: "SPY-USD.P",
        direction: "long",
        netQuantity: "5",
        averageEntryPrice: String(spyPrice),
        usedMargin: "0",
        unrealizedPnl: "0",
        markPrice: String(spyPrice),
        liquidationPrice: "0",
        bankruptcyPrice: "0",
        maintenanceMargin: "0",
        notionalValue: String(spyPrice * 5),
        leverage: "2",
        netFundingSinceNeutral: "0",
        returnOnEquity: "0",
      },
    ],
    collateral,
  });
  check("a long on the hedge market does not count as a hedge",
    longOnly[0]?.coverage === "unhedged" && longOnly[0]?.position === null);

  const totals = ondoHedgeTotals(rows);
  check("totals sum in USD notional across rows",
    Math.abs(totals.exposureUsd - (spyPrice * 10 + 20 * 300)) < 0.01,
    usd(totals.exposureUsd));

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
