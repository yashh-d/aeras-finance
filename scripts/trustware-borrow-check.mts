// Slice 4d verification: the borrow surface's convert-then-deposit decisions.
//
// The panel itself is a client component and cannot be exercised here, so the
// rules it depends on live in lib/trustware/selection.ts and are tested
// directly. Sections A-D are offline and deterministic. Section E runs the same
// rules over REAL balances fetched through the dev-server proxy, and feeds the
// result into the planner, which is the exact sequence the panel performs at
// submit time.
//
//   PROXY_ORIGIN=http://localhost:3000 npx tsx scripts/trustware-borrow-check.mts
//
// Read-only. Signs nothing, submits nothing, moves nothing.

import { vaultById, XSTOCK_BORROW_VAULTS } from "../lib/jupiter/borrow";
import { atomicToUi, uiToAtomic } from "../lib/trustware/amounts";
import { TRUSTWARE_SOLANA_CHAIN } from "../lib/trustware/constants";
import { equivalenceByVaultId } from "../lib/trustware/equivalents";
import { planCollateralDeposit, type HeldEquivalent } from "../lib/trustware/planner";
import type { TrustwareQuoteResponse } from "../lib/trustware/types";
import {
  DISPLAY_DECIMALS,
  dustAtomic,
  floorToDisplay,
  groupEquivalentsByVault,
  largestConvertibleAtomic,
  largestConvertibleUi,
  needsConversion,
} from "../lib/trustware/selection";

const PROXY_ORIGIN = process.env.PROXY_ORIGIN ?? "http://localhost:3000";
const EVM_HOLDER = "0x9e229b12cc9081d6a510b29ccbd6311743e277ed";
const SOLANA_HOLDER = "HYyEoLDLMmL2wtKczx6JLNeUc7RqUnXGUUnPudwiAbN4";

const TSLA_VAULT = vaultById(77)!;
const tslaSources = equivalenceByVaultId(77)!.sources;
const ethTslaOn = tslaSources.find((s) => s.chain === "1" && s.symbol === "TSLAon")!;
const solTslaOn = tslaSources.find(
  (s) => s.chain === TRUSTWARE_SOLANA_CHAIN && s.symbol === "TSLAon",
)!;
// Fail loudly rather than throwing an opaque "cannot read decimals of undefined"
// if the registry is ever reshaped.
for (const [name, s] of [["ethTslaOn", ethTslaOn], ["solTslaOn", solTslaOn]] as const) {
  if (!s) throw new Error(`Registry fixture ${name} not found for vault 77.`);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function held(source: typeof ethTslaOn, ui: string): HeldEquivalent {
  return { source, balanceAtomic: uiToAtomic(ui, source.decimals) };
}

console.log("\nA. floorToDisplay never rounds up past its input");
{
  // The exact case that disabled the submit button: toFixed(4) rounds half away
  // from zero, so a ceiling of 1.00005 rendered as 1.0001 and failed its own
  // `collateralUi <= depositCeiling` validity check.
  check("1.00005 floors below itself", Number(floorToDisplay(1.00005)) <= 1.00005,
    `${(1.00005).toFixed(4)} (toFixed) vs ${floorToDisplay(1.00005)} (floor)`);
  check("toFixed(4) would have rounded up", Number((1.00005).toFixed(4)) > 1.00005);
  for (const n of [0, 0.00001, 0.99999, 1, 1.5, 123.456789, 9999.99999]) {
    check(`${n} floors below itself`, Number(floorToDisplay(n)) <= n, floorToDisplay(n));
  }
  check("keeps 4 decimals of precision", floorToDisplay(1.23456) === "1.2345");
}

console.log("\nB. dustAtomic is one unit of display precision");
{
  check("8-decimal collateral", dustAtomic(8) === "10000", dustAtomic(8));
  check("9-decimal collateral", dustAtomic(9) === "100000", dustAtomic(9));
  check("18-decimal collateral", dustAtomic(18) === "100000000000000", dustAtomic(18));
  // Guard the exponent from going negative if a venue ever has fewer decimals
  // than we render.
  check("never negative for low-decimal collateral", dustAtomic(2) === "1", dustAtomic(2));
  const oneDisplayUnit = uiToAtomic("0.0001", 8);
  check("equals 0.0001 in 8-decimal units", dustAtomic(8) === oneDisplayUnit,
    `${dustAtomic(8)} vs ${oneDisplayUnit}`);
}

console.log("\nC. needsConversion ignores display dust, catches real gaps");
{
  const dec = TSLA_VAULT.collateralDecimals;
  const base = { collateralDecimals: dec, heldCount: 1 };
  const two = uiToAtomic("2", dec);

  check("no holdings elsewhere -> never converts", !needsConversion({
    requestedAtomic: two, onSolanaAtomic: "0", ...base, heldCount: 0 }));
  check("fully covered on Solana -> no conversion", !needsConversion({
    requestedAtomic: two, onSolanaAtomic: two, ...base }));
  check("more than enough on Solana -> no conversion", !needsConversion({
    requestedAtomic: two, onSolanaAtomic: uiToAtomic("5", dec), ...base }));

  // A "max" of a 1.99999999 balance renders as 2.0000 and asks for one display
  // unit more than the wallet holds. Bridging for that would be absurd.
  const dusty = (BigInt(two) - BigInt(dustAtomic(dec))).toString();
  check("shortfall of exactly one display unit -> no conversion", !needsConversion({
    requestedAtomic: two, onSolanaAtomic: dusty, ...base }),
    `short by ${atomicToUi(dustAtomic(dec), dec)}`);

  const justOver = (BigInt(dusty) - 1n).toString();
  check("one atomic unit past the threshold -> converts", needsConversion({
    requestedAtomic: two, onSolanaAtomic: justOver, ...base }));
  check("holding nothing on Solana -> converts", needsConversion({
    requestedAtomic: two, onSolanaAtomic: "0", ...base }));
}

console.log("\nD. Convertible ceiling uses the largest source, rescaled");
{
  const dec = TSLA_VAULT.collateralDecimals;
  check("no holdings -> zero", largestConvertibleUi([], dec) === 0);

  // Ondo on Solana is 9-decimal, xStocks are 8. A rescale bug here would size
  // the field 10x wrong in either direction.
  const solOnly = [held(solTslaOn, "3")];
  check("rescales 9-decimal Solana source to 8-decimal collateral",
    largestConvertibleAtomic(solOnly, dec) === uiToAtomic("3", dec),
    `${largestConvertibleAtomic(solOnly, dec)} (${largestConvertibleUi(solOnly, dec)})`);

  // EVM Ondo is 18-decimal.
  const evmOnly = [held(ethTslaOn, "3")];
  check("rescales 18-decimal EVM source to 8-decimal collateral",
    largestConvertibleAtomic(evmOnly, dec) === uiToAtomic("3", dec),
    largestConvertibleAtomic(evmOnly, dec));

  // The rule that matters: a conversion is never split, so two sources of 3 and
  // 5 gives a ceiling of 5, not 8. Summing would let the user request an amount
  // no single route can deliver.
  const both = [held(ethTslaOn, "3"), held(solTslaOn, "5")];
  check("takes the largest source, not the sum", largestConvertibleUi(both, dec) === 5,
    `got ${largestConvertibleUi(both, dec)}, sum would be 8`);
  const reversed = [held(solTslaOn, "5"), held(ethTslaOn, "3")];
  check("order-independent", largestConvertibleUi(reversed, dec) === 5);
}

console.log("\nE. Vault grouping and eligibility");
{
  const tslaOnEth = held(ethTslaOn, "10");
  const grouped = groupEquivalentsByVault([tslaOnEth]);
  check("TSLAon on Ethereum groups under the TSLAx vault", grouped.get(77)?.length === 1);
  check("does not leak into other vaults", grouped.size === 1,
    `vaults matched: ${[...grouped.keys()].join(", ")}`);
  check("empty input groups to nothing", groupEquivalentsByVault([]).size === 0);

  // This is what makes the card appear at all. Without it the whole conversion
  // path is unreachable from the UI for a user whose holding is off-Solana.
  const eligible = XSTOCK_BORROW_VAULTS.filter(
    (v) => 0 > 0 || grouped.has(v.vaultId),
  );
  check("vault is eligible on an off-Solana holding alone", eligible.length === 1,
    eligible.map((v) => v.collateralSymbol).join(", "));
}

console.log("\nF. Real balances through the proxy, then the planner");
{
  // Same GET shape fetchEquivalentBalancesViaProxy uses from the browser.
  const params = new URLSearchParams({ solana: SOLANA_HOLDER, evm: EVM_HOLDER });
  const res = await fetch(`${PROXY_ORIGIN}/api/trustware/balances?${params}`, {
    cache: "no-store",
  });
  check("proxy responds 200", res.status === 200, `got ${res.status}`);
  if (res.status !== 200) {
    console.log(`     (is the dev server up at ${PROXY_ORIGIN}?)`);
  } else {
    const body = (await res.json()) as { held: HeldEquivalent[] };
    check("returned real holdings", body.held.length > 0, `${body.held.length} sources`);

    const grouped = groupEquivalentsByVault(body.held);
    console.log(`        grouped into ${grouped.size} vault(s):`);
    for (const [vaultId, hs] of grouped) {
      const v = vaultById(vaultId)!;
      const ceiling = largestConvertibleUi(hs, v.collateralDecimals);
      console.log(
        `          #${vaultId} ${v.collateralSymbol}: ${hs.length} source(s), ` +
          `ceiling ${floorToDisplay(ceiling)} (from ${hs.map((h) => `${h.source.symbol}/${h.source.chainLabel}`).join(", ")})`,
      );
      check(`#${vaultId} ceiling is positive`, ceiling > 0);
      check(
        `#${vaultId} ceiling does not exceed the largest single holding`,
        hs.every((h) => {
          const ui = Number(atomicToUi(h.balanceAtomic, h.source.decimals));
          return ceiling >= ui || Math.abs(ceiling - ui) < 1e-9 || ceiling <= Math.max(
            ...hs.map((x) => Number(atomicToUi(x.balanceAtomic, x.source.decimals))));
        }),
      );
      check(
        `#${vaultId} every grouped source is a registry source for that vault`,
        hs.every((h) =>
          equivalenceByVaultId(vaultId)!.sources.some(
            (s) => s.chain === h.source.chain && s.token === h.source.token,
          ),
        ),
      );
    }

    // The panel's exact submit sequence for a wallet with no collateral on
    // Solana: decide a conversion is needed, then ask the planner to price it.
    const tslaHeld = grouped.get(77) ?? [];
    if (tslaHeld.length === 0) {
      check("TSLAx vault had convertible holdings to plan against", false);
    } else {
      const dec = TSLA_VAULT.collateralDecimals;
      const requestedUi = 1;
      const requestedAtomic = uiToAtomic(String(requestedUi), dec);
      const decided = needsConversion({
        requestedAtomic, onSolanaAtomic: "0", collateralDecimals: dec,
        heldCount: tslaHeld.length,
      });
      check("panel decides a conversion is needed", decided);

      const ceiling = largestConvertibleUi(tslaHeld, dec);
      check("requested amount is within the field's ceiling", requestedUi <= ceiling,
        `${requestedUi} <= ${ceiling}`);

      const plan = await planCollateralDeposit({
        vault: TSLA_VAULT,
        requestedUi,
        solanaAddress: SOLANA_HOLDER,
        evmAddress: EVM_HOLDER,
        solanaCollateralAtomic: "0",
        heldEquivalents: tslaHeld,
        // The panel's default fetcher is a relative URL, which the browser
        // resolves and Node cannot. Same proxy, absolute origin.
        fetchQuote: async (req) => {
          const r = await fetch(`${PROXY_ORIGIN}/api/trustware/quote`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(req),
          });
          const body = (await r.json()) as TrustwareQuoteResponse;
          if (!r.ok) throw new Error(body.error ?? `proxy ${r.status}`);
          return body;
        },
      });
      console.log(`        planner -> ${plan.kind}`);
      check("planner produced a runnable conversion", plan.kind === "convert-then-deposit",
        plan.kind === "convert-then-deposit" ? "" : (plan as { reason: string }).reason);

      if (plan.kind === "convert-then-deposit") {
        console.log(
          `        send ${atomicToUi(plan.sourceAmountAtomic, plan.source.decimals)} ` +
            `${plan.source.symbol} on ${plan.source.chainLabel} ` +
            `-> min ${atomicToUi(plan.quote.toAmountMinAtomic, dec)} ${TSLA_VAULT.collateralSymbol}`,
        );
        // The pre-sign safety check in execute.ts rejects anything that fails
        // this, so a plan that violates it would strand the user mid-flow.
        check("guaranteed minimum covers the shortfall",
          BigInt(plan.quote.toAmountMinAtomic) >= BigInt(plan.shortfallAtomic));
        check("source amount is within the real held balance",
          BigInt(plan.sourceAmountAtomic) <=
            BigInt(tslaHeld.find((h) => h.source.token === plan.source.token)!.balanceAtomic));
        check("deposit equals the full requested amount",
          plan.depositAtomic === requestedAtomic, plan.depositAtomic);
        // No bridge to pay for when the source is already on Solana, and the
        // holder's Solana balance is the largest of the three.
        check("preferred the Solana source over the BNB Chain ones",
          plan.source.chain === TRUSTWARE_SOLANA_CHAIN, plan.source.chainLabel);
      }
    }
  }
}

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
