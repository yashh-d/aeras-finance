// Lighter hedge slice verification. Checks the facts the sizing and risk math
// are built on against the live production API, so a change on Lighter's side
// shows up as a failed assertion rather than a mis-sized order.
//
//   npx tsx scripts/lighter-check.mts
//
// No dev server, no credentials, no wallet: every endpoint used here is
// unauthenticated. Read-only. Signs nothing, submits nothing, moves nothing.
//
// The Ondo equivalent had to diff sandbox against production because the two
// disagreed on which markets were enabled and which addresses were real. Lighter
// has no sandbox, so everything below is read from the same host orders would go
// to.

import { XSTOCKS } from "../lib/jupiter/xstocks";
import {
  LIGHTER_COLLATERAL_SYMBOL,
  LIGHTER_MARGIN_FRACTION_SCALE,
  SOLANA_USDC_MINT,
} from "../lib/lighter/constants";
import {
  hedgeRoutes,
  hedgeRouteFor,
  INDEX_LEVEL_MARKETS,
} from "../lib/lighter/hedge";
import { buildCatalog, findMarket } from "../lib/lighter/markets";
import { estimateFundingFromInterest, isFeeFree, liquidationDistance } from "../lib/lighter/risk";
import { lighterIntentAddress, lighterOrderBookDetails } from "../lib/lighter/server";
import { computeHedgeSize, slippageBoundPrice, toWireInteger } from "../lib/lighter/sizing";
import type { LighterMarket } from "../lib/lighter/types";

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

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

async function main() {
  console.log("Lighter hedge verification against mainnet\n");

  const details = await lighterOrderBookDetails();
  const catalog = buildCatalog(details);

  section("Catalog");
  check("orderBookDetails returns markets", catalog.length > 0, `${catalog.length} markets`);
  note("tradeable", String(catalog.filter((m) => m.tradeable).length));

  // --- Route coverage -----------------------------------------------------
  //
  // Every xStock we sell must either have a route or be a known, named gap.
  // A silent omission would show as "hedging unavailable" with no explanation.
  section("Route coverage");

  for (const xstock of XSTOCKS) {
    const route = hedgeRouteFor(xstock.symbol);
    check(`${xstock.symbol} has a route`, route !== undefined, route?.market ?? "none");
  }

  const routed: { symbol: string; market: LighterMarket }[] = [];

  for (const route of hedgeRoutes()) {
    const market = findMarket(catalog, route.market);
    check(
      `${route.xstockSymbol} -> ${route.market} exists and is tradeable`,
      market !== undefined && market.tradeable,
      market ? `status ${market.status}, mark ${market.markPrice}` : "not in catalog",
    );
    if (market?.tradeable) routed.push({ symbol: route.xstockSymbol, market });
  }

  // --- The Ondo failure mode ----------------------------------------------
  //
  // Ondo forced SPY and QQQ through index perps priced 10x and 41x off the ETF,
  // so a hedge sized by share count would have been that many times too large.
  // Lighter lists both at share level. These assertions exist so that if Lighter
  // ever disables SPY the way Ondo did, we find out here rather than by opening
  // a ten-times-oversized short.
  section("Share-level pricing, not index-level");

  const spy = findMarket(catalog, "SPY");
  const us500 = findMarket(catalog, "US500");

  check("SPYx routes to SPY, not US500", hedgeRouteFor("SPYx")?.market === "SPY");
  check("QQQx routes to QQQ, not US100", hedgeRouteFor("QQQx")?.market === "QQQ");

  for (const route of hedgeRoutes()) {
    check(
      `${route.xstockSymbol} does not route to an index-level market`,
      !INDEX_LEVEL_MARKETS.includes(route.market as (typeof INDEX_LEVEL_MARKETS)[number]),
    );
  }

  if (spy && us500) {
    const ratio = Number(us500.markPrice) / Number(spy.markPrice);
    // The index sits near 10x the ETF. If SPY ever started printing at index
    // level this ratio would collapse toward 1 and the assertion would fail.
    check("SPY is priced at ETF level, well below the index", ratio > 5, `US500/SPY = ${ratio.toFixed(2)}x`);
    note("SPY mark", spy.markPrice);
    note("US500 mark", us500.markPrice);
  } else {
    check("SPY and US500 both present for the ratio check", false);
  }

  // --- Margin fraction scale ----------------------------------------------
  //
  // Nothing documents that the fractions are scaled by 10000. It was derived
  // from BTC and ETH carrying 200 against an advertised 50x maximum. If the
  // scale ever changed, every margin and liquidation figure we show would be
  // wrong by a factor of ten, so it is pinned here.
  section("Margin fraction scale");

  const btc = findMarket(catalog, "BTC");
  check(
    "BTC max leverage resolves to 50x under the assumed scale",
    btc?.maxLeverage === 50,
    btc ? `${btc.maxLeverage}x from minIMF ${btc.minInitialMarginFraction}` : "BTC missing",
  );
  note("assumed scale", String(LIGHTER_MARGIN_FRACTION_SCALE));

  for (const { symbol, market } of routed) {
    check(
      `${symbol} margin fractions are sane`,
      market.minInitialMarginFraction > 0 &&
        market.minInitialMarginFraction <= 1 &&
        market.maintenanceMarginFraction > 0 &&
        market.maintenanceMarginFraction < market.minInitialMarginFraction &&
        market.maxLeverage >= 1 &&
        market.maxLeverage <= 50,
      `${market.maxLeverage}x max, MMF ${pct(market.maintenanceMarginFraction)}`,
    );
  }

  // --- Fees and hours -----------------------------------------------------
  section("Fees and trading hours");

  for (const { symbol, market } of routed) {
    check(`${symbol} is fee free`, isFeeFree(market), `taker ${market.takerFee}, maker ${market.makerFee}`);
  }

  for (const { symbol, market } of routed) {
    check(
      `${symbol} has no trading-hours restriction`,
      market.tradingHours === "",
      market.tradingHours === "" ? "24/7" : market.tradingHours,
    );
  }

  // --- Sizing -------------------------------------------------------------
  //
  // On an exact route the perp and the token are the same instrument, so a full
  // hedge sized by USD notional must reproduce the share count. That is the
  // strongest single assertion available without submitting an order: it proves
  // the notional path, the decimal scaling and the increment alignment all agree.
  section("Sizing: full hedge on an exact route reproduces share count");

  for (const { symbol, market } of routed) {
    const route = hedgeRouteFor(symbol);
    if (route?.match !== "exact") continue;

    const quantity = "10";
    const size = computeHedgeSize({
      quantity,
      tokenPriceUsd: market.markPrice,
      hedgeRatio: 1,
      marketPriceUsd: market.markPrice,
      sizeDecimals: market.sizeDecimals,
      minBaseAmount: market.minBaseAmount,
      minQuoteAmount: market.minQuoteAmount,
      orderQuoteLimit: market.orderQuoteLimit,
    });

    check(
      `${symbol} 10 tokens hedges as 10 contracts`,
      Number(size.size) === 10,
      `size ${size.size}, notional ${usd(Number(size.notionalUsd))}, ratio ${size.effectiveRatio}`,
    );

    check(
      `${symbol} base_amount matches the size at ${market.sizeDecimals} decimals`,
      size.baseAmount === toWireInteger(size.size, market.sizeDecimals),
      `base_amount ${size.baseAmount}`,
    );
  }

  // The proxy route is the one place notional sizing earns its keep: gold marks
  // near 4400 against a GLD share near 400, and no share-count conversion would
  // survive that without a hardcoded factor.
  section("Sizing: proxy route absorbs the price-level difference");

  const gld = routed.find((r) => r.symbol === "GLDx");
  if (gld) {
    const tokenPriceUsd = "400";
    const quantity = "10";
    const size = computeHedgeSize({
      quantity,
      tokenPriceUsd,
      hedgeRatio: 1,
      marketPriceUsd: gld.market.markPrice,
      sizeDecimals: gld.market.sizeDecimals,
      minBaseAmount: gld.market.minBaseAmount,
      minQuoteAmount: gld.market.minQuoteAmount,
      orderQuoteLimit: gld.market.orderQuoteLimit,
    });

    const target = 4000;
    const drift = Math.abs(Number(size.notionalUsd) - target) / target;
    // Tolerance is one size increment's worth of notional, not an arbitrary
    // epsilon: rounding down to the increment is the only permitted loss.
    const incrementNotional =
      Math.pow(10, -gld.market.sizeDecimals) * Number(gld.market.markPrice);

    check(
      "GLDx hedge notional matches exposure within one increment",
      Math.abs(Number(size.notionalUsd) - target) <= incrementNotional,
      `notional ${usd(Number(size.notionalUsd))} vs exposure ${usd(target)}, drift ${pct(drift)}`,
    );
    note("XAU mark", gld.market.markPrice);
    note("assumed GLD token price", tokenPriceUsd);
    note("size", size.size);
  } else {
    check("GLDx route resolved for the proxy check", false);
  }

  // --- Minimums -----------------------------------------------------------
  //
  // min_quote_amount is $10 and usually binds before min_base_amount does. A
  // dust holding must be refused with a reason, not sized to something the
  // exchange rejects on submission.
  section("Sizing: minimums are enforced before submission");

  if (spy) {
    const dust = computeHedgeSize({
      quantity: "0.001",
      tokenPriceUsd: spy.markPrice,
      hedgeRatio: 1,
      marketPriceUsd: spy.markPrice,
      sizeDecimals: spy.sizeDecimals,
      minBaseAmount: spy.minBaseAmount,
      minQuoteAmount: spy.minQuoteAmount,
      orderQuoteLimit: spy.orderQuoteLimit,
    });
    check(
      "a sub-minimum SPY holding is refused with a reason",
      dust.size === "0" && dust.limitedBy !== "none",
      `limitedBy ${dust.limitedBy}, would have been ${usd(Number(dust.targetNotionalUsd))}`,
    );

    // A partial hedge must offset less than the holding, never more. Rounding
    // down to the increment is what guarantees a hedge cannot become a net short.
    const partial = computeHedgeSize({
      quantity: "7",
      tokenPriceUsd: spy.markPrice,
      hedgeRatio: 0.5,
      marketPriceUsd: spy.markPrice,
      sizeDecimals: spy.sizeDecimals,
      minBaseAmount: spy.minBaseAmount,
      minQuoteAmount: spy.minQuoteAmount,
      orderQuoteLimit: spy.orderQuoteLimit,
    });
    check(
      "a 50% SPY hedge never rounds above the requested ratio",
      partial.effectiveRatio <= 0.5 && partial.effectiveRatio > 0.49,
      `effective ${partial.effectiveRatio}`,
    );
  }

  // --- Slippage bound -----------------------------------------------------
  //
  // A hedge is a sell, so its worst acceptable price sits below the mark.
  // Getting the direction backwards would let a market order fill at any price.
  section("Slippage bound direction");

  if (spy) {
    const ask = slippageBoundPrice(spy.markPrice, 50, true, spy.priceDecimals);
    const bid = slippageBoundPrice(spy.markPrice, 50, false, spy.priceDecimals);
    check("sell bound is below mark", Number(ask.price) < Number(spy.markPrice), `${ask.price} < ${spy.markPrice}`);
    check("buy bound is above mark", Number(bid.price) > Number(spy.markPrice), `${bid.price} > ${spy.markPrice}`);
  }

  // --- Deposit path -------------------------------------------------------
  //
  // Lighter accepts USDC deposits from Solana, which its docs do not mention.
  // The whole onboarding design rests on that: with it, a user funds from the
  // Privy Solana wallet they already have, and no bridge is needed. Without it,
  // USDC has to be bridged to Arbitrum first.
  //
  // Because it is undocumented it could be withdrawn without notice, so it is
  // asserted here rather than assumed. The probe address is a fixed burn address
  // so repeated runs reuse one token account instead of making Lighter pay rent
  // for a new one each time.
  section("Deposit path");

  const PROBE_L1 = "0x000000000000000000000000000000000000dEaD";

  const solanaIntent = await lighterIntentAddress(PROBE_L1, "solana");
  check(
    "Solana is an accepted deposit chain",
    solanaIntent.length > 0 && !solanaIntent.startsWith("0x"),
    `intent address ${solanaIntent}`,
  );

  const evmIntent = await lighterIntentAddress(PROBE_L1, "arbitrum");
  check(
    "Arbitrum still works as the documented fallback",
    evmIntent.startsWith("0x"),
    evmIntent,
  );

  check(
    "Solana and EVM intent addresses are different shapes",
    solanaIntent !== evmIntent && !solanaIntent.startsWith("0x"),
    "sending to the wrong one would lose the funds",
  );

  // Attributability: two users must not share a deposit address, or credits
  // could not be assigned.
  const otherIntent = await lighterIntentAddress(
    "0x1111111111111111111111111111111111111111",
    "solana",
  );
  check(
    "each L1 address gets its own Solana deposit account",
    otherIntent !== solanaIntent,
    `${solanaIntent.slice(0, 8)}... vs ${otherIntent.slice(0, 8)}...`,
  );

  // The strongest available evidence short of an actual deposit: the address is
  // a live SPL token account for USDC, not a placeholder. Degrades to a note if
  // the public RPC is unreachable, since that is not Lighter's fault.
  try {
    const rpc = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [solanaIntent, { encoding: "jsonParsed" }],
      }),
    });
    const info = (await rpc.json()) as {
      result?: { value?: { data?: { parsed?: { info?: { mint?: string } } } } };
    };
    const mint = info.result?.value?.data?.parsed?.info?.mint;

    check(
      "the Solana intent address is a live USDC token account",
      mint === SOLANA_USDC_MINT,
      mint ? `mint ${mint}` : "account not found on chain",
    );
  } catch {
    note("on-chain confirmation", "skipped, Solana RPC unreachable");
  }

  note(
    "still unproven",
    "that a real deposit credits the L2 balance. Confirm with one small live deposit.",
  );

  // --- Collateral ---------------------------------------------------------
  //
  // The one thing Lighter is worse at than Ondo: the stock cannot pay for its
  // own hedge. Recorded here so the constraint stays visible.
  section("Collateral");
  note("margin asset", `${LIGHTER_COLLATERAL_SYMBOL} only`);

  if (spy) {
    const notional = 10 * Number(spy.markPrice);
    const collateral = notional * spy.initialMarginFraction;
    const distance = liquidationDistance({
      entryPriceUsd: Number(spy.markPrice),
      size: 10,
      collateralUsd: collateral,
      isShort: true,
      market: spy,
    });
    const funding = estimateFundingFromInterest(notional, spy, true);

    note("10 SPY short notional", usd(notional));
    note(`margin at default ${(1 / spy.initialMarginFraction).toFixed(1)}x`, usd(collateral));
    note("liquidation distance", distance === null ? "n/a" : pct(distance));
    note(
      "funding at zero premium",
      `short ${funding.annualizedPercent <= 0 ? "receives" : "pays"} ${Math.abs(funding.annualizedPercent).toFixed(2)}%/yr`,
    );

    check(
      "a default-leverage short is not liquidated by a trivial move",
      distance !== null && distance > 0.02,
      distance === null ? "n/a" : pct(distance),
    );
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
