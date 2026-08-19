// Rysk V12 option chain verification. Rysk publishes no taker documentation and
// no schema, so every fact the catalog relies on was read off live responses.
// This script asserts those facts against the same host the UI reads, so a
// change on their side shows up as a failed assertion rather than a mispriced
// strike or a mis-scaled collateral amount.
//
//   npx tsx scripts/rysk-check.mts
//
// No dev server, no credentials, no wallet. Every endpoint here is
// unauthenticated and read-only. Signs nothing, submits nothing, moves nothing.

import { buildCatalog } from "../lib/rysk/catalog";
import {
  isMissingQuote,
  RYSK_CHAIN_ETHEREUM,
  RYSK_CHAIN_HYPEREVM,
  RYSK_COMEX_EXPIRY,
  RYSK_COMEX_UNDERLYINGS,
  RYSK_CONTRACT_DECIMALS,
  RYSK_CRYPTO_EXPIRY,
  RYSK_NO_ASK_SENTINEL,
  RYSK_STABLES,
} from "../lib/rysk/constants";
import { ryskAssets, ryskInventory } from "../lib/rysk/server";
import { buildTicket } from "../lib/rysk/strategy";

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

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

async function main() {
  console.log("Rysk V12 option chain verification against mainnet\n");

  const [assets, inventory] = await Promise.all([ryskAssets(), ryskInventory()]);

  section("Endpoints");
  const chainKeys = Object.keys(assets);
  check("/api/assets is keyed by chain id", chainKeys.length > 0, chainKeys.join(", "));
  check(
    "/api/assets covers both chains we model",
    chainKeys.includes(String(RYSK_CHAIN_ETHEREUM)) &&
      chainKeys.includes(String(RYSK_CHAIN_HYPEREVM)),
  );
  check("/api/inventory returns underlyings", Object.keys(inventory).length > 0,
    Object.keys(inventory).join(", "));

  // catalog.ts derives the chain a strike settles on by resolving its token
  // addresses, because inventory carries no chain id. That is only sound if an
  // address is unique across chains.
  section("Address to chain resolution");
  const seen = new Map<string, number[]>();
  for (const [chainId, list] of Object.entries(assets)) {
    if (!Array.isArray(list)) continue;
    for (const asset of list) {
      const key = asset.address.toLowerCase();
      seen.set(key, [...(seen.get(key) ?? []), Number(chainId)]);
    }
  }
  const collisions = [...seen.entries()].filter(([, chains]) => chains.length > 1);
  check(
    "no token address appears on more than one chain",
    collisions.length === 0,
    collisions.length === 0 ? `${seen.size} addresses` : collisions.map(([a]) => a).join(", "),
  );

  // The four stables are the only inventory tokens absent from /api/assets. If
  // that stops being true a strike silently loses its collateral option.
  section("Token coverage");
  const known = new Set([...seen.keys(), ...Object.keys(RYSK_STABLES)]);
  const unresolved = new Set<string>();
  let productCount = 0;
  for (const entry of Object.values(inventory)) {
    for (const combination of Object.values(entry.combinations ?? {})) {
      for (const product of combination.products) {
        productCount += 1;
        for (const address of [product.asset, product.strikeAsset, product.collateralAsset]) {
          if (!known.has(address.toLowerCase())) unresolved.add(address.toLowerCase());
        }
      }
    }
  }
  check(
    "every product token resolves to a known asset or stable",
    unresolved.size === 0,
    unresolved.size === 0 ? `${productCount} products` : [...unresolved].join(", "),
  );

  const stablesUsed = new Set<string>();
  for (const entry of Object.values(inventory)) {
    for (const combination of Object.values(entry.combinations ?? {})) {
      for (const product of combination.products) {
        const c = product.collateralAsset.toLowerCase();
        if (c in RYSK_STABLES) stablesUsed.add(c);
      }
    }
  }
  check(
    "the hardcoded stable registry is still in use",
    stablesUsed.size > 0,
    [...stablesUsed].map((a) => RYSK_STABLES[a].symbol).join(", "),
  );

  section("Collateral convention");
  // types.ts claims a call is written against the underlying and a put against
  // the strike asset. Sizing depends on it: get it backwards and a put would
  // lock one token instead of strike-worth of stable.
  let callMismatch = 0;
  let putMismatch = 0;
  for (const entry of Object.values(inventory)) {
    for (const combination of Object.values(entry.combinations ?? {})) {
      for (const product of combination.products) {
        if (combination.isPut) {
          if (product.collateralAsset.toLowerCase() !== product.strikeAsset.toLowerCase())
            putMismatch += 1;
        } else if (product.collateralAsset.toLowerCase() !== product.asset.toLowerCase()) {
          callMismatch += 1;
        }
      }
    }
  }
  check("puts are collateralised by the strike asset", putMismatch === 0, `${putMismatch} mismatches`);
  check("calls are collateralised by the underlying", callMismatch === 0, `${callMismatch} mismatches`);

  section("Scaling");
  // A contract quantity is e18 regardless of the token's own decimals. WBTC is
  // the case that catches a wrong assumption, being an 8 decimal token.
  const wbtc = (assets[String(RYSK_CHAIN_ETHEREUM)] ?? []).find((a) => a.symbol === "WBTC");
  if (wbtc) {
    const asContracts = Number(wbtc.minTradeSize) / 10 ** RYSK_CONTRACT_DECIMALS;
    note("WBTC token decimals", String(wbtc.decimals));
    note("WBTC minTradeSize", `${wbtc.minTradeSize} -> ${asContracts} contracts at e18`);
    check(
      "minTradeSize is contract-scaled, not token-scaled",
      wbtc.decimals !== RYSK_CONTRACT_DECIMALS && asContracts > 0 && asContracts < 1,
      `${asContracts} contracts`,
    );
  } else {
    check("WBTC is listed on Ethereum", false, "not found");
  }

  section("Quote sentinels");
  let sentinelSeen = 0;
  let zeroSeen = 0;
  let realBids = 0;
  for (const entry of Object.values(inventory)) {
    for (const c of Object.values(entry.combinations ?? {})) {
      if (c.ask >= RYSK_NO_ASK_SENTINEL * 0.999) sentinelSeen += 1;
      if (c.bid === 0) zeroSeen += 1;
      if (!isMissingQuote(c.bid)) realBids += 1;
    }
  }
  note("asks at the int64 sentinel", String(sentinelSeen));
  note("bids at zero", String(zeroSeen));
  note("live maker bids", String(realBids));
  check(
    "the sentinel is recognised rather than rendered",
    isMissingQuote(RYSK_NO_ASK_SENTINEL) && isMissingQuote(0) && !isMissingQuote(12.5),
  );

  section("Expiries");
  // Two schedules, not one. Crypto expires Friday 08:00 UTC; XAUT tracks the
  // COMEX gold calendar at 17:30 UTC on a weekday that moves. Asserting a single
  // rule here is what first surfaced the difference.
  const offCrypto: string[] = [];
  const offComex: string[] = [];
  let expiryCount = 0;
  for (const [symbol, entry] of Object.entries(inventory)) {
    const expiries = new Set(
      Object.values(entry.combinations ?? {}).map((c) => c.expiration_timestamp),
    );
    expiryCount += expiries.size;
    for (const ts of expiries) {
      const d = new Date(ts * 1000);
      const stamp = `${symbol} ${d.toUTCString()}`;
      if (RYSK_COMEX_UNDERLYINGS.has(symbol)) {
        if (
          d.getUTCHours() !== RYSK_COMEX_EXPIRY.hourUtc ||
          d.getUTCMinutes() !== RYSK_COMEX_EXPIRY.minuteUtc
        ) {
          offComex.push(stamp);
        }
      } else if (
        d.getUTCDay() !== RYSK_CRYPTO_EXPIRY.weekdayUtc ||
        d.getUTCHours() !== RYSK_CRYPTO_EXPIRY.hourUtc ||
        d.getUTCMinutes() !== RYSK_CRYPTO_EXPIRY.minuteUtc
      ) {
        offCrypto.push(stamp);
      }
    }
  }
  check(
    "crypto expiries are Friday 08:00 UTC",
    offCrypto.length === 0,
    offCrypto.length === 0 ? `${expiryCount} expiries checked` : offCrypto.join(", "),
  );
  check(
    "XAUT expiries are 17:30 UTC on the COMEX calendar",
    offComex.length === 0,
    offComex.length === 0 ? "gold schedule intact" : offComex.join(", "),
  );

  section("Catalog");
  const catalog = buildCatalog(assets, inventory);
  check("catalog has underlyings", catalog.underlyings.length > 0,
    catalog.underlyings.map((u) => u.symbol).join(", "));

  for (const u of catalog.underlyings) {
    note(
      u.symbol,
      `spot ${u.indexPrice.toFixed(4)}  calls ${u.calls.length}  puts ${u.puts.length}  chains ${u.chainIds.join("/")}`,
    );
  }

  const allOptions = catalog.underlyings.flatMap((u) => [...u.calls, ...u.puts]);
  check(
    "every option keeps at least one resolvable collateral",
    allOptions.every((o) => o.collaterals.length > 0),
  );
  check(
    "no option renders the sentinel as a price",
    allOptions.every((o) => o.ask === null || o.ask < RYSK_NO_ASK_SENTINEL * 0.999),
  );
  check(
    "empty underlyings are dropped rather than shown",
    catalog.underlyings.every((u) => u.calls.length + u.puts.length > 0),
  );

  section("Indicative APY versus the bid");
  // Rysk reports an APY even for strikes no maker has quoted, so it is modelled
  // rather than offered. Where a bid does exist the two disagree by a stable
  // factor, which is why the UI labels them separately instead of picking one.
  const quoted = allOptions.filter((o) => o.bid !== null);
  if (quoted.length === 0) {
    note("quoted strikes", "none right now, ratio not measurable");
  } else {
    const ratios: number[] = [];
    for (const o of quoted) {
      const ticket = buildTicket(o, o.collaterals[0], 1);
      if (ticket.annualizedYield && ticket.annualizedYield > 0) {
        ratios.push(o.indicativeApy / 100 / ticket.annualizedYield);
      }
    }
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    note("quoted strikes", String(quoted.length));
    note("indicative / bid-derived", `${min.toFixed(4)} to ${max.toFixed(4)}`);
    check(
      "the two APYs differ by a consistent factor, so neither is a bug",
      max - min < 0.05,
      `spread ${(max - min).toFixed(4)}`,
    );
  }

  section("Seller economics");
  const sample = quoted[0];
  if (sample) {
    const ticket = buildTicket(sample, sample.collaterals[0], 1);
    note("strike", `${sample.underlying} ${sample.strike} ${sample.isPut ? "put" : "call"}`);
    note("collateral", `${ticket.collateralAmount} ${ticket.collateral.collateralSymbol}`);
    note("premium", String(ticket.premiumUsd));
    note("yield to expiry", ticket.periodYield === null ? "n/a" : pct(ticket.periodYield));
    check(
      "a sold option pays less premium than the collateral it locks",
      ticket.premiumUsd !== null && ticket.premiumUsd < ticket.notionalUsd,
    );
    check(
      "an assigned put buys below the strike and an assigned call sells above it",
      ticket.effectivePrice !== null &&
        (sample.isPut
          ? ticket.effectivePrice < sample.strike
          : ticket.effectivePrice > sample.strike),
    );
  } else {
    note("sample", "no quoted strike available to price");
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
