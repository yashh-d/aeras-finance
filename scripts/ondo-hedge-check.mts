// Ondo Perps hedge slice verification. Checks the facts the sizing and risk
// math are built on against the live production API, so a change on Ondo's side
// shows up as a failed assertion rather than a mis-sized order.
//
//   npx tsx scripts/ondo-hedge-check.mts
//
// No dev server, no credentials: every endpoint used here is unauthenticated.
// Read-only. Signs nothing, submits nothing, moves nothing.

import { ONDO_API_HOSTS, ONDO_DEPOSIT_NETWORK } from "../lib/ondo/constants";
import { hedgeRouteFor } from "../lib/ondo/hedge";
import {
  buildCatalog,
  collateralAssets,
  collateralOnNetwork,
  findMarket,
  type OndoCatalog,
} from "../lib/ondo/markets";
import { previewHedge } from "../lib/ondo/preview";
import { autoExchangePriceMove, projectLtv } from "../lib/ondo/risk";
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

  // The single most expensive thing to get wrong: these two exist as symbols and
  // would be accepted by a naive symbol lookup, but every order against them is
  // rejected. Everything about the SPYx and QQQx routes follows from this.
  const disabled = catalog.markets.filter((m) => !m.tradeable).map((m) => m.market).sort();
  for (const symbol of ["SPY-USD.P", "QQQ-USD.P"] as const) {
    check(`${symbol} exists but is untradeable`,
      findMarket(catalog.markets, symbol) !== undefined && disabled.includes(symbol));
  }
  note("all untradeable markets", disabled.join(", ") || "none");

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
  // one, and it binds at a holding a real user could have.
  for (const symbol of ["US500-USD.P", "US100-USD.P"] as const) {
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

  section("6. Sizing: 12 SPYx at the live SPY index price");
  const spy = findMarket(catalog.markets, "SPY-USD.P");
  const us500 = findMarket(catalog.markets, "US500-USD.P");
  if (spy && us500) {
    const tokenPrice = spy.indexPrice;
    const size = computeHedgeSize({
      quantity: "12",
      tokenPriceUsd: tokenPrice,
      hedgeRatio: 1,
      marketPriceUsd: us500.price,
      baseIncrement: us500.baseIncrement,
      maxPositionBaseSize: us500.maxPositionBaseSize,
    });
    note("exposure", usd(Number(size.exposureNotionalUsd)));
    note("order", `${size.size} ${us500.market} = ${usd(Number(size.notionalUsd))}`);
    note("limited by", size.limitedBy);

    // Rounding to baseIncrement always costs something. It must cost less than
    // one increment of notional, and it must never round up.
    const shortfall = Number(size.targetNotionalUsd) - Number(size.notionalUsd);
    const oneIncrement = Number(us500.baseIncrement) * Number(us500.price);
    check("rounds down, never up", shortfall >= 0, `shortfall ${usd(shortfall)}`);
    check("rounding cost is under one increment", shortfall < oneIncrement,
      `one increment = ${usd(oneIncrement)}`);
    check("effective ratio lands within 1% of the request",
      Math.abs(size.effectiveRatio - 1) < 0.01, size.effectiveRatio.toFixed(6));

    // A share-count hedge would short 12 base units instead. Showing the gap
    // makes the trap concrete rather than theoretical.
    const naive = 12 * Number(us500.price);
    note("if sized by share count instead", `${usd(naive)}, ${(naive / Number(size.notionalUsd)).toFixed(1)}x too large`);
  } else {
    check("SPY-USD.P and US500-USD.P both present for sizing", false);
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
  const safe = autoExchangePriceMove({
    collateralValueUsd,
    shortNotionalUsd: collateralValueUsd * 0.25,
    usdcBalanceUsd: 0,
  });
  check("hedge ratio 0.25 never triggers", safe === null);
  check("a fall in the market leaves LTV at zero",
    projectLtv({ collateralValueUsd, shortNotionalUsd: collateralValueUsd, usdcBalanceUsd: 0 }, -0.3) === 0);

  section("8. Hedge availability across the curated xStocks");
  for (const xstock of XSTOCKS) {
    const route = hedgeRouteFor(xstock.symbol);
    const market = route ? findMarket(catalog.markets, route.market) : undefined;
    const price = market?.price ?? "0";

    const result = previewHedge({
      catalog,
      xstockSymbol: xstock.symbol,
      quantity: "10",
      // Index perps are priced at index level, so the ETF routes need the ETF
      // ticker's index price as the token price rather than the perp's.
      tokenPriceUsd: route?.match === "proxy"
        ? (findMarket(catalog.markets, `${route.underlying}-USD.P`)?.indexPrice ?? "0")
        : price,
      hedgeRatio: 1,
    });

    if (result.ok) {
      const trigger = result.risk.autoExchangePriceUsd;
      console.log(
        `  ${xstock.symbol.padEnd(7)} hedge via ${result.route.market.padEnd(12)} ` +
        `${result.size.size} base = ${usd(Number(result.size.notionalUsd))}, ` +
        `margin ${result.collateral.symbol}, ` +
        `auto-exchange at ${trigger === null ? "never" : usd(trigger)}` +
        `${result.basisRisk ? ", proxy" : ""}`,
      );
    } else {
      console.log(`  ${xstock.symbol.padEnd(7)} blocked: ${result.reason}`);
    }
  }

  const available = XSTOCKS.filter(
    (x) => previewHedge({ catalog, xstockSymbol: x.symbol, quantity: "10", tokenPriceUsd: "100", hedgeRatio: 1 }).ok,
  ).map((x) => x.symbol);
  check("exactly SPYx and QQQx are hedgeable in v1",
    available.length === 2 && available.includes("SPYx") && available.includes("QQQx"),
    available.join(", ") || "none");

  section("9. Sandbox divergence");
  // Sandbox is a different exchange configuration, not production with fake
  // money. These assertions exist to keep that fact visible: they are expected
  // to pass while the environments differ, and a failure means the divergence
  // closed and the warnings in constants.ts and the doc can be relaxed.
  const sandbox = await ondoMarkets(SANDBOX);
  const sandboxCollateral = collateralAssets(sandbox);

  for (const symbol of ["SPYon", "QQQon"] as const) {
    const prod = collateralOnNetwork(catalog.collateral, symbol, ONDO_DEPOSIT_NETWORK);
    const sand = collateralOnNetwork(sandboxCollateral, symbol, ONDO_DEPOSIT_NETWORK);
    check(`${symbol} deploys to a different address in sandbox`,
      prod !== undefined && sand !== undefined &&
        prod.contractAddress.toLowerCase() !== sand.contractAddress.toLowerCase(),
      `prod ${prod?.contractAddress.toLowerCase()} vs sandbox ${sand?.contractAddress.toLowerCase()}`);
  }

  const sandboxNetworks = new Set(
    sandboxCollateral.flatMap((a) => a.networks.map((n) => n.network)),
  );
  check("sandbox advertises a Solana deposit path that production does not",
    sandboxNetworks.has("solana") && !networks.has("solana"),
    `sandbox: ${[...sandboxNetworks].sort().join(", ")}`);

  const sandboxDisabled = sandbox.perps.tradingPairs
    .filter((p) => p.disabled === true)
    .map((p) => p.market);
  check("sandbox leaves SPY-USD.P and QQQ-USD.P enabled",
    !sandboxDisabled.includes("SPY-USD.P") && !sandboxDisabled.includes("QQQ-USD.P"),
    `sandbox disables: ${sandboxDisabled.join(", ") || "none"}`);

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
