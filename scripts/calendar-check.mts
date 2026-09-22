// Live check of the Terminal's calendar sources: Nasdaq earnings for every
// catalog company, the ForexFactory weekly calendar, the Fed's RSS feeds, and
// the FOMC meeting registry against the Fed's own calendar page. None of
// these is a contracted API. Run after touching lib/calendar, and at the turn
// of the year when the FOMC registry needs the next year's dates.
//
//   npx tsx scripts/calendar-check.mts

import { earningsCompanies, earningsViews } from "../lib/calendar/earnings";
import { fetchCompanyEarnings } from "../lib/calendar/earnings-server";
import { FOMC_MEETINGS_2026 } from "../lib/calendar/macro";
import { loadMacro } from "../lib/calendar/macro-server";
import { FED_FEEDS } from "../lib/news/feeds";
import { fetchFeed } from "../lib/news/server";

let failures = 0;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

console.log("Earnings (Nasdaq)");
const rows = [];
for (const x of earningsCompanies()) {
  try {
    const { row } = await fetchCompanyEarnings(x);
    rows.push(row);
    const last = row.last
      ? `last ${day(row.last.reportedAt)} eps ${row.last.eps} vs ${row.last.consensus} (${row.last.verdict} ${row.last.surprisePct}%)`
      : "last: none";
    const next = row.nextAt
      ? `next ${row.nextEstimated ? "~" : ""}${day(row.nextAt)}${row.nextConsensus != null ? ` est ${row.nextConsensus}` : ""}`
      : "next: not set";
    console.log(`  ${row.symbol.padEnd(6)} ${next.padEnd(26)} ${last}`);
  } catch (err) {
    failures += 1;
    console.log(`  ${x.symbol.padEnd(6)} FAIL ${err instanceof Error ? err.message : String(err)}`);
  }
}
const views = earningsViews(rows, Date.now());
console.log(
  `  ${views.filter((v) => v.kind === "reported").length} reported recently, ${views.filter((v) => v.kind === "upcoming").length} upcoming, ${views.filter((v) => v.kind === "unknown").length} unknown`,
);

console.log("\nMacro calendar (ForexFactory)");
try {
  const macro = await loadMacro();
  console.log(`  ${macro.events.length} events kept this week`);
  for (const e of macro.events.slice(0, 8)) {
    console.log(`  ${e.flag} ${new Date(e.at).toISOString().slice(0, 16)} ${e.impact.padEnd(6)} ${e.title} (prev ${e.previous ?? "-"}, est ${e.forecast ?? "-"})`);
  }
  if (macro.events.length === 0) failures += 1;
} catch (err) {
  failures += 1;
  console.log(`  FAIL ${err instanceof Error ? err.message : String(err)}`);
}

console.log("\nFed feeds");
for (const feed of FED_FEEDS) {
  try {
    const result = await fetchFeed(feed);
    console.log(`  ${feed.id.padEnd(14)} ${result.items.length} items  ${result.items[0]?.title.slice(0, 70) ?? ""}`);
    if (result.items.length === 0) failures += 1;
  } catch (err) {
    failures += 1;
    console.log(`  ${feed.id.padEnd(14)} FAIL ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\nFOMC registry against federalreserve.gov");
try {
  const res = await fetch("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", {
    headers: { "user-agent": "Mozilla/5.0 (compatible; AerasFinance/0.1)" },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await res.text();
  const start = html.indexOf("2026 FOMC Meetings");
  const stop = html.indexOf("2025 FOMC Meetings");
  const section = start >= 0 ? html.slice(start, stop > start ? stop : undefined) : "";
  const months = [...section.matchAll(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>/g)].map((m) => m[1].trim());
  const days = [...section.matchAll(/fomc-meeting__date[^>]*>\s*([^<]+)</g)].map((m) => m[1].trim());
  const live = months.map((m, i) => `${m} ${days[i] ?? "?"}`);
  const expected = FOMC_MEETINGS_2026.map((m) => {
    const s = new Date(`${m.start}T00:00:00Z`);
    const e = new Date(`${m.end}T00:00:00Z`);
    const month = s.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    return `${month} ${s.getUTCDate()}-${e.getUTCDate()}${m.projections ? "*" : ""}`;
  });
  const same = JSON.stringify(live) === JSON.stringify(expected);
  console.log(`  page:     ${live.join(", ")}`);
  console.log(`  registry: ${expected.join(", ")}`);
  console.log(same ? "  match" : "  MISMATCH");
  if (!same) failures += 1;
} catch (err) {
  failures += 1;
  console.log(`  FAIL ${err instanceof Error ? err.message : String(err)}`);
}

console.log(failures === 0 ? "\nAll calendar sources answered." : `\n${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
