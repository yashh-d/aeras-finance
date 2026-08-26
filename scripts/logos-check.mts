// Asserts that every asset, venue and curator the UI renders resolves to a logo
// file that actually exists on disk.
//
// The failure this catches is silent by design: <AssetLogo /> falls back to a
// symbol monogram when an image 404s, so a typo'd path or a deleted file looks
// like "that asset just has no logo" rather than like a bug. Run after touching
// lib/tokens/logos.ts or public/logos.
//
//   npx tsx scripts/logos-check.mts

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { EARN_ASSETS } from "../lib/jupiter/earn";
import { MONAD_USDC_VAULTS } from "../lib/morpho/vaults";
import { XSTOCKS, assetIdentity } from "../lib/jupiter/xstocks";
import {
  MARKET_BADGE_TICKERS,
  MARKET_LOGO_TICKERS,
  marketBadge,
  marketLogo,
} from "../lib/tokens/market-logos";
import {
  CURATOR_LOGOS,
  VENUE_LOGOS,
  curatorLogo,
  tokenLogoBySymbol,
} from "../lib/tokens/logos";

const PUBLIC = join(process.cwd(), "public");
let failures = 0;

function check(label: string, logo: string | undefined) {
  if (!logo) {
    console.log(`  MISSING  ${label.padEnd(28)} no logo mapped`);
    failures += 1;
    return;
  }
  const path = join(PUBLIC, logo.replace(/^\//, ""));
  if (!existsSync(path)) {
    console.log(`  404      ${label.padEnd(28)} ${logo}`);
    failures += 1;
    return;
  }
  const bytes = statSync(path).size;
  if (bytes < 200) {
    console.log(`  EMPTY    ${label.padEnd(28)} ${logo} (${bytes}B)`);
    failures += 1;
    return;
  }
  console.log(`  ok       ${label.padEnd(28)} ${logo} (${bytes.toLocaleString()}B)`);
}

console.log("Earn assets (resolved through assetIdentity, the path the UI uses):");
for (const a of EARN_ASSETS) {
  check(`${a.symbol} / ${a.name}`, assetIdentity(a.assetMint, a.symbol).logo);
}

console.log("\nxStock catalog:");
for (const x of XSTOCKS) check(`${x.symbol} / ${x.name}`, x.logo);

console.log("\nOther symbols:");
check("MON (Monad gas)", tokenLogoBySymbol("MON"));

console.log("\nOndo perps catalog (52 markets):");
{
  const files = new Set(MARKET_LOGO_TICKERS);
  const badges = new Set(MARKET_BADGE_TICKERS);
  for (const t of MARKET_LOGO_TICKERS) check(t, marketLogo(`${t}-USD.P`));
  const badged = MARKET_BADGE_TICKERS.map((t) => `${t} "${marketBadge(`${t}-USD.P`).label}"`);
  console.log(`  ok       ${String(badges.size).padEnd(28)} designed monogram badges: ${badged.join(", ")}`);
  console.log(`           ${String(files.size + badges.size).padEnd(28)} of 52 markets covered`);
}

console.log("\nVenues:");
for (const [name, logo] of Object.entries(VENUE_LOGOS)) check(name, logo);

console.log("\nMorpho curators (every curated Monad vault):");
for (const v of MONAD_USDC_VAULTS) check(v.curator, curatorLogo(v.curator));

const orphans = Object.keys(CURATOR_LOGOS).filter(
  (c) => !MONAD_USDC_VAULTS.some((v) => v.curator === c),
);
if (orphans.length) {
  console.log(`\nNote: ${orphans.length} curator logo(s) mapped but unused: ${orphans.join(", ")}`);
}

// Every mapping above can resolve while the UI still shows none of them, which
// is exactly what happened the first time: the registry was correct but the
// vault row rendered the symbol as plain text and never called assetIdentity.
// Resolving a path proves the data; this proves something draws it.
console.log("\nRender wiring:");
const WIRED: ReadonlyArray<[string, string, RegExp]> = [
  ["Earn vault row", "components/EarnPanel.tsx", /<AssetLogo\s+xstock=\{assetIdentity\(meta\.assetMint/],
  ["Earn vault detail", "components/EarnPanel.tsx", /<AssetLogo\s+xstock=\{assetIdentity\(mint/],
  ["Earn venue headers", "components/EarnPanel.tsx", /<VenueMark\s+src=\{VENUE_LOGOS\./],
  ["Morpho curator row", "components/MorphoVaultsCard.tsx", /logo:\s*curatorLogo\(vault\.curator\)/],
  ["Monad section head", "components/MorphoVaultsCard.tsx", /<VenueMark\s+src=\{VENUE_LOGOS\.monad\}/],
  ["Morpho merged into Vaults", "components/EarnPanel.tsx", /<MorphoVaultsSection/],
  ["Selector row logos", "components/MarketSelector.tsx", /<MarketLogo market=\{m\.market\}/],
  ["Perps tab dropdown", "components/PerpsPanel.tsx", /<MarketHeader/],
  ["Perps tab list removed", "components/PerpsPanel.tsx", /^(?![\s\S]*<MarketPicker)[\s\S]*$/],
  // The venue switch in HedgePanel is the trap here: the browser was first
  // mounted inside LighterBody(), so it rendered on the Lighter venue and was
  // invisible on the Ondo one it belongs to. Assert it sits in the Ondo branch.
  ["Perps browser on Ondo venue", "components/HedgePanel.tsx",
   /venue === "ondo" \? \([\s\S]{0,120}<OndoMarketsCard/],
  ["Lighter row holding logo", "components/HedgePanel.tsx", /<AssetLogo\s+xstock=\{assetIdentity\(holding\.mint/],
  ["Lighter row market logo", "components/HedgePanel.tsx", /<MarketLogo market=\{route\.market\}/],
  ["Ondo row holding logo", "components/OndoHedgeSection.tsx", /<AssetLogo\s+xstock=\{assetIdentity\(holding\.mint/],
  ["Ondo row market logo", "components/OndoHedgeSection.tsx", /<MarketLogo\s+market=\{market \? market\.market/],
];
for (const [label, file, pattern] of WIRED) {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  if (pattern.test(src)) {
    console.log(`  ok       ${label.padEnd(28)} ${file}`);
  } else {
    console.log(`  UNWIRED  ${label.padEnd(28)} ${file} renders no logo`);
    failures += 1;
  }
}

console.log(failures === 0 ? "\nAll logos resolve." : `\n${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
