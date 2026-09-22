// Live check of the asset detail's sources: every listed catalog asset's
// Nasdaq sections, and every TradingView symbol against TradingView's own
// search. Run after touching lib/company.
//
//   npx tsx scripts/company-check.mts

import { XSTOCKS } from "../lib/jupiter/xstocks";
import { nasdaqListing, sectionsFor, tradingViewSymbol } from "../lib/company/listing";
import { loadSection } from "../lib/company/server";
import { computeHighlights } from "../lib/company/highlights";
import type { CompanyFinancials, CompanyQuote } from "../lib/company/types";

let failures = 0;

console.log("Nasdaq sections");
for (const x of XSTOCKS) {
  const listing = nasdaqListing(x);
  if (!listing) {
    console.log(`  ${x.symbol.padEnd(7)} no listing (expected for bullion)`);
    continue;
  }
  const parts: string[] = [];
  for (const section of sectionsFor(listing)) {
    try {
      const res = await loadSection(section, listing, x.name);
      if (section === "quote") {
        const q = res.data as CompanyQuote;
        parts.push(`quote ${q.last ?? "?"} (${q.marketStatus})`);
      } else if (section === "financials") {
        const h = computeHighlights(res.data as CompanyFinancials, null);
        parts.push(`fin rev ${h.revenueTtm == null ? "?" : (h.revenueTtm / 1e9).toFixed(1) + "B"} eps ${h.epsTtm?.toFixed(2) ?? "?"}`);
      } else {
        const d = res.data;
        parts.push(`${section} ${Array.isArray(d) ? d.length : "ok"}`);
      }
    } catch (err) {
      failures += 1;
      parts.push(`${section} FAIL ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`  ${x.symbol.padEnd(7)} ${listing.assetClass.padEnd(6)} ${parts.join(" · ")}`);
}

console.log("\nTradingView symbols");
for (const x of XSTOCKS) {
  const symbol = tradingViewSymbol(x);
  if (!symbol) {
    failures += 1;
    console.log(`  ${x.symbol.padEnd(7)} MISSING`);
    continue;
  }
  const [exchange, ticker] = symbol.split(":");
  try {
    const res = await fetch(
      `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(ticker)}&hl=0&exchange=${encodeURIComponent(exchange)}&lang=en&search_type=undefined&domain=production`,
      {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; AerasFinance/0.1)",
          origin: "https://www.tradingview.com",
          referer: "https://www.tradingview.com/",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await res.json()) as { symbols?: { symbol: string; exchange: string; description?: string }[] };
    // TradingView writes NYSE Arca listings as "AMEX:" in symbol strings but
    // reports the venue's display name from search.
    const venues = exchange === "AMEX" ? ["AMEX", "NYSE Arca"] : [exchange];
    const hit = (body.symbols ?? []).find((s) => s.symbol === ticker && venues.includes(s.exchange));
    if (hit) {
      console.log(`  ${x.symbol.padEnd(7)} ${symbol.padEnd(14)} ${hit.description ?? ""}`);
    } else {
      failures += 1;
      console.log(`  ${x.symbol.padEnd(7)} ${symbol.padEnd(14)} NOT FOUND (${(body.symbols ?? []).slice(0, 3).map((s) => `${s.exchange}:${s.symbol}`).join(", ")})`);
    }
  } catch (err) {
    failures += 1;
    console.log(`  ${x.symbol.padEnd(7)} ${symbol.padEnd(14)} FAIL ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(failures === 0 ? "\nAll sources answered." : `\n${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
