// Ondo Perps collateral and margin-funding verification.
//
//   npx tsx scripts/ondo-collateral-check.mts
//
// Answers the question the hedge depends on and the docs get wrong: which Ondo
// assets actually credit as margin, what they are worth, and whether the user's
// Solana holdings can be converted into them.
//
// Read-only against Ondo. It does provision deposit addresses on a burner
// account, because that is the only way to show that a deposit address proves
// nothing about collateral, and it prices Trustware routes without signing or
// broadcasting anything.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  collateralBySymbol,
  creditableCollateral,
  creditedMargin,
  collateralCeilingUsd,
  ONDO_MARGIN_TOKENS,
} from "../lib/ondo/collateral";
import { ONDO_API_BASE_URL, ONDO_DEPOSIT_NETWORK, ONDO_ENV } from "../lib/ondo/constants";
import {
  bestMarginSource,
  marginSources,
  readyMarginUsd,
} from "../lib/ondo/margin-sources";
import { MAX_FUNDING_LOSS_BPS, planOndoFunding } from "../lib/ondo/fund";
import { buildCatalog, collateralAssets } from "../lib/ondo/markets";
import {
  OndoApiError,
  ondoAccount,
  ondoCompleteChallenge,
  ondoContracts,
  ondoGetChallenge,
  ondoMarkets,
  ondoProvisionAddress,
} from "../lib/ondo/server";
import { TRUSTWARE_SOLANA_CHAIN } from "../lib/trustware/constants";
import type { TrustwareQuoteRequest, TrustwareQuoteResponse } from "../lib/trustware/types";

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

// The scripts run outside the browser, so the proxy's relative path does not
// resolve. This calls Trustware directly with the same server key the proxy
// uses, which means it bypasses the allowlist in lib/trustware/server.ts. That
// allowlist is asserted separately below rather than exercised here.
const TRUSTWARE_QUOTE_URL = "https://api.trustware.io/api/v1/routes/quote";

async function directQuote(req: TrustwareQuoteRequest): Promise<TrustwareQuoteResponse> {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) throw new Error("TRUSTWARE_API_KEY is not set");

  const res = await fetch(TRUSTWARE_QUOTE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(req),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as TrustwareQuoteResponse;
  } catch {
    throw new Error(`Trustware quote ${res.status}: ${text.slice(0, 120)}`);
  }
}

const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function main() {
  console.log(`Ondo Perps collateral check  (${ONDO_ENV} -> ${ONDO_API_BASE_URL})`);

  const [markets, contracts] = await Promise.all([ondoMarkets(), ondoContracts()]);
  const catalog = buildCatalog(markets, contracts);
  const assets = collateralAssets(markets);
  const collateral = creditableCollateral(assets, catalog);

  section("1. The collateral universe, as Ondo reports it");

  note("token config", assets.map((a) => a.symbol).join(", "));
  check(
    "every listed asset is reachable on our deposit network",
    collateral.length === assets.length,
    `${collateral.length} of ${assets.length} on ${ONDO_DEPOSIT_NETWORK}`,
  );

  // A new collateral type is news, not something to swallow. Ondo added three
  // in August 2026 without touching their docs.
  const unknown = collateral.filter((c) => !c.known).map((c) => c.symbol);
  check(
    "no collateral asset is unrecognised by our registry",
    unknown.length === 0,
    unknown.length ? `add ${unknown.join(", ")} to META in lib/ondo/collateral.ts` : "",
  );

  console.log();
  console.log(`        ${"asset".padEnd(8)}${"marked against".padEnd(16)}${"mark".padEnd(12)}${"haircut".padEnd(9)}${"cap".padEnd(24)}source`);
  for (const c of collateral) {
    const ceiling = collateralCeilingUsd(c);
    console.log(
      `        ${c.symbol.padEnd(8)}${(c.pricingMarket ?? "NO MARKET").padEnd(16)}` +
        `${(c.markPriceUsd ? Number(c.markPriceUsd).toFixed(2) : "-").padEnd(12)}` +
        `${`${(c.haircut * 100).toFixed(0)}%`.padEnd(9)}` +
        `${(c.capTokens === null ? "none published" : `${c.capTokens} (${usd(ceiling ?? 0)})`).padEnd(24)}` +
        `${c.documented ? "Ondo docs" : "API only, inferred"}`,
    );
  }

  // Ondo's collateral page says "Supported assets at launch: QQQon and SPYon"
  // while the live token config carries eight assets. Every prior disagreement
  // of this kind resolved in the API's favour, but the haircut and cap for the
  // five undocumented assets are inherited assumptions, not published figures,
  // so the split is asserted rather than flattened.
  const documented = collateral.filter((c) => c.documented).map((c) => c.symbol);
  const inferred = collateral.filter((c) => !c.documented).map((c) => c.symbol);
  check(
    "the documented collateral set is exactly what Ondo publishes",
    documented.length === 3 && ["USDC", "SPYon", "QQQon"].every((s) => documented.includes(s)),
    documented.join(", "),
  );
  note("accepted by the API but not documented", inferred.join(", ") || "none");
  note(
    "what that means",
    "routable and probably credited, but haircut, cap and eligibility are inferred",
  );

  section("2. Which assets can be valued before they land");

  // Ondo prices collateral at "the mark price for the corresponding market on
  // the exchange". GLDon and SLVon have no corresponding market: Ondo lists XAU
  // and XAG, spot metals, not the GLD and SLV ETFs. They are depositable and
  // their credited value is only knowable afterwards.
  const priceable = collateral.filter((c) => c.priceable).map((c) => c.symbol);
  const unpriceable = collateral.filter((c) => !c.priceable).map((c) => c.symbol);
  check("at least the documented three can be valued",
    ["USDC", "SPYon", "QQQon"].every((s) => priceable.includes(s)),
    priceable.join(", "));
  note("cannot be valued up front", unpriceable.join(", ") || "none");

  for (const symbol of unpriceable) {
    const ticker = symbol.replace(/on$/, "");
    check(
      `${symbol} really has no ${ticker}-USD.P market`,
      catalog.find((m) => m.market === `${ticker}-USD.P`) === undefined,
      "if this fails, Ondo added the market and the asset is now priceable",
    );
  }

  section("3. Credited margin math");

  const spy = collateralBySymbol(collateral, "SPYon");
  if (!spy) {
    check("SPYon is present", false);
  } else {
    const mark = Number(spy.markPriceUsd);
    const under = creditedMargin(spy, 10);
    check(
      "10 SPYon credits 90% of market value",
      under !== null && Math.abs(under.creditedUsd - 10 * mark * 0.9) < 0.01,
      under ? `${usd(under.marketValueUsd)} market, ${usd(under.creditedUsd)} credited` : "null",
    );

    // Above the cap, tokens deposit and withdraw normally and credit nothing.
    // A hedge sized against uncapped collateral would be margined by less than
    // it thinks.
    const over = creditedMargin(spy, 200);
    check(
      "quantity above the 146-token cap credits nothing extra",
      over !== null && over.capReached && Math.abs(over.creditedUsd - 146 * mark * 0.9) < 0.01,
      over ? `${over.uncreditedTokens} tokens uncredited` : "null",
    );
  }

  const gld = collateralBySymbol(collateral, "GLDon");
  check(
    "an unpriceable asset returns no projected margin rather than a guess",
    gld === undefined || creditedMargin(gld, 10) === null,
  );

  section("4. The registry still matches Ondo's live token config");

  // ONDO_MARGIN_TOKENS is the allowlist the Trustware proxy validates a funding
  // destination against. It duplicates the live config on purpose, so drift has
  // to fail here rather than silently widen or narrow what can be funded.
  for (const asset of collateral) {
    const pinned = ONDO_MARGIN_TOKENS[asset.symbol];
    check(
      `${asset.symbol} address is pinned and current`,
      pinned !== undefined && pinned === asset.contractAddress.toLowerCase(),
      pinned === undefined
        ? `missing from ONDO_MARGIN_TOKENS: ${asset.contractAddress.toLowerCase()}`
        : pinned === asset.contractAddress.toLowerCase()
          ? pinned
          : `pinned ${pinned} vs live ${asset.contractAddress.toLowerCase()}`,
    );
  }

  const stale = Object.keys(ONDO_MARGIN_TOKENS).filter(
    (symbol) => !collateral.some((c) => c.symbol === symbol),
  );
  check(
    "the registry holds nothing Ondo has dropped",
    stale.length === 0,
    stale.join(", ") || "",
  );

  section("5. A deposit address proves nothing about collateral");

  const burner = privateKeyToAccount(generatePrivateKey());
  const challenge = await ondoGetChallenge(burner.address);
  const signature = await burner.signMessage({ message: challenge.message });
  const { token } = await ondoCompleteChallenge(challenge.id, signature);
  const account = await ondoAccount(token);

  // The load-bearing assertion in this file. TSLAon is not accepted collateral
  // and Ondo hands out a valid deposit address for it anyway, so provisioning
  // cannot be used as a collateral check and lib/ondo/collateral.ts has to be.
  let tslaAddress: string | undefined;
  try {
    const provisioned = await ondoProvisionAddress(token, {
      symbol: "TSLAon",
      network: ONDO_DEPOSIT_NETWORK,
      deposit_destination: { id: account.accountID, wallet: "margin" },
    });
    tslaAddress = provisioned.address;
  } catch {
    tslaAddress = undefined;
  }
  check(
    "Ondo issues a deposit address for TSLAon, which is NOT collateral",
    tslaAddress !== undefined,
    tslaAddress ?? "refused, which would mean provisioning is a real check now",
  );
  check(
    "our own collateral view excludes it",
    collateralBySymbol(collateral, "TSLAon") === undefined,
  );

  let bogus: string | undefined;
  try {
    const provisioned = await ondoProvisionAddress(token, {
      symbol: "NOTAREALTOKEN",
      network: ONDO_DEPOSIT_NETWORK,
      deposit_destination: { id: account.accountID, wallet: "margin" },
    });
    bogus = provisioned.address;
  } catch (err) {
    check(
      "a symbol Ondo has never heard of is refused",
      err instanceof OndoApiError && err.code === "invalid_symbol",
      err instanceof OndoApiError ? (err.code ?? "") : String(err).slice(0, 60),
    );
  }
  if (bogus) check("a symbol Ondo has never heard of is refused", false, bogus);

  section("6. Funding routes from Solana USDC into each collateral asset");

  // Prices the real plan, including the loss guard, against live Trustware.
  // The deposit address is stubbed to the burner's own provisioned addresses so
  // no browser-only proxy call is needed.
  for (const asset of collateral) {
    if (asset.symbol === "USDC") continue;

    const plan = await planOndoFunding({
      collateral: asset,
      source: {
        chain: TRUSTWARE_SOLANA_CHAIN,
        token: SOLANA_USDC,
        decimals: 6,
        symbol: "USDC",
        amountAtomic: "200000000",
        amountUsd: 200,
        ownerAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      },
      fetchQuote: directQuote,
      provisionAddress: async (symbol) => {
        const provisioned = await ondoProvisionAddress(token, {
          symbol,
          network: ONDO_DEPOSIT_NETWORK,
          deposit_destination: { id: account.accountID, wallet: "margin" },
        });
        const live = collateralBySymbol(collateral, symbol);
        return {
          address: provisioned.address,
          contractAddress: live?.contractAddress ?? "",
        };
      },
    });

    if (plan.kind === "ready") {
      console.log(
        `  ${asset.symbol.padEnd(8)} $200 USDC -> ${Number(plan.deliveredTokens).toFixed(6)} ` +
          `= ${plan.deliveredValueUsd === null ? "unpriced" : usd(plan.deliveredValueUsd)}` +
          `${plan.lossBps === null ? "" : `, loss ${(plan.lossBps / 100).toFixed(2)}%`}` +
          `${plan.creditedMarginUsd === null ? "" : `, credits ${usd(plan.creditedMarginUsd)}`}` +
          `${plan.valueUnverified ? "  [value unverified]" : ""}`,
      );
    } else {
      console.log(`  ${asset.symbol.padEnd(8)} blocked: ${plan.reason}`);
    }
  }

  section("7. The loss guard actually refuses");

  // A route that delivers half of what went in is not a bad price, it is a
  // broken one. Rather than depend on a market staying thin, this asserts the
  // guard against a deliberately overstated input valuation.
  const spyForGuard = collateralBySymbol(collateral, "SPYon");
  if (!spyForGuard) {
    check("SPYon present for the guard test", false);
  } else {
    const plan = await planOndoFunding({
      collateral: spyForGuard,
      source: {
        chain: TRUSTWARE_SOLANA_CHAIN,
        token: SOLANA_USDC,
        decimals: 6,
        symbol: "USDC",
        amountAtomic: "200000000",
        // Claim the $200 of USDC is worth $1,000. The route will deliver about
        // $199 of SPYon, an 80% loss against that claim, well past the bound.
        amountUsd: 1_000,
        ownerAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      },
      fetchQuote: directQuote,
      provisionAddress: async () => ({
        address: "0x0000000000000000000000000000000000000001",
        contractAddress: spyForGuard.contractAddress,
      }),
    });
    check(
      `a route losing more than ${MAX_FUNDING_LOSS_BPS / 100}% is refused`,
      plan.kind === "blocked",
      plan.kind === "blocked" ? plan.reason.slice(0, 90) : "it was allowed through",
    );
  }

  // The destination is fetched from Ondo, never taken from a caller. This
  // asserts the other half: a provisioned address for the wrong contract is
  // refused rather than delivered to.
  if (spyForGuard) {
    const plan = await planOndoFunding({
      collateral: spyForGuard,
      source: {
        chain: TRUSTWARE_SOLANA_CHAIN,
        token: SOLANA_USDC,
        decimals: 6,
        symbol: "USDC",
        amountAtomic: "200000000",
        amountUsd: 200,
        ownerAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      },
      fetchQuote: directQuote,
      provisionAddress: async () => ({
        address: "0x0000000000000000000000000000000000000001",
        // Ondo naming a different contract than the one we would send.
        contractAddress: "0x00000000000000000000000000000000deadbeef",
      }),
    });
    check(
      "a contract mismatch between Ondo and our registry is refused",
      plan.kind === "blocked",
      plan.kind === "blocked" ? plan.reason.slice(0, 70) : "it was allowed through",
    );
  }

  section("8. What a wallet can post as margin");

  // The map from "what the user holds" to "what Ondo credits". Pure, so it is
  // checked here against the live collateral list rather than in a browser.
  const sources = marginSources({
    // $250 of USDC on Solana.
    solanaUsdcAtomic: "250000000",
    xstocksAtomic: {
      // 2 SPYx (8 decimals) and 5 AAPLx.
      XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W: "200000000",
      XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp: "500000000",
    },
    priceUsdByMint: {
      XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W: 765,
      XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp: 300,
    },
    stables: [
      {
        chain: "56",
        chainLabel: "BNB Chain",
        symbol: "USDC",
        // Binance-peg USDC is 18 decimals, not 6. Reading it at 6 reports a
        // 100 USDC holding as 100 trillion dollars, which is why the registry
        // pins decimals per chain and matches by contract, never by symbol.
        decimals: 18,
        balanceAtomic: "100000000000000000000",
        contract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      },
    ],
    held: [],
    collateral,
  });

  const byId = (id: string) => sources.find((s) => s.id === id);

  check("USDC on Solana maps to Ondo USDC",
    byId("usdc:solana")?.target.symbol === "USDC",
    `$${byId("usdc:solana")?.balanceUsd?.toFixed(2)}`);

  check("SPYx maps to SPYon",
    sources.find((s) => s.symbol === "SPYx")?.target.symbol === "SPYon");

  // AAPLon is not accepted collateral even though AAPL-USD.P is a live market,
  // so AAPLx must not be offered as a margin source at all.
  check("AAPLx is not offered, because Ondo does not credit AAPLon",
    sources.every((s) => s.symbol !== "AAPLx"));

  check("BNB Chain USDC is read at 18 decimals, not 6",
    Math.abs((byId("usdc:56:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d")?.balanceUsd ?? 0) - 100) < 0.01,
    `${byId("usdc:56:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d")?.balanceUsd} (would be 1e20 read at 6)`);

  // Off-Solana sources are listed but flagged, not dropped. Telling someone
  // they have nothing when their money is one chain away is the wrong answer.
  check("an off-Solana source is listed but not signable yet",
    byId("usdc:56:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d")?.executable === false);
  check("Solana sources are signable",
    byId("usdc:solana")?.executable === true);

  // USDC leads because it is better margin, not because it is simpler: no
  // haircut, no cap, and no correlation with the position it backs.
  check("USDC is offered before an equity",
    bestMarginSource(sources)?.symbol === "USDC" &&
      bestMarginSource(sources)?.chainLabel === "Solana",
    `${bestMarginSource(sources)?.symbol} on ${bestMarginSource(sources)?.chainLabel}`);

  check("ready margin counts only what can be signed today",
    Math.abs(readyMarginUsd(sources) - (250 + 2 * 765)) < 0.01,
    usd(readyMarginUsd(sources)));

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
