// Lighter UpdateLeverage verification.
//
//   npx tsx scripts/lighter-leverage-check.mts
//
// Signs, but SUBMITS NOTHING. The account index is fake and the seed is a
// constant, so nothing here corresponds to a real Lighter account and no
// signature made here is ever sent. It reads the live market catalog to check
// the fraction arithmetic against real markets.
//
// WHY THIS EXISTS. placeHedge shipped for months drawing a "2x" margin figure
// and a matching liquidation price while sending no UpdateLeverage transaction
// at all, so the exchange opened every hedge cross-margined at the market
// default. On a $14.62 hedge the panel said $7.31 of margin and Lighter reserved
// $0.97, and the panel's liquidation price was $65 away from the real one. The
// blocker on fixing it was that nobody had verified the transaction tag or the
// argument order, and a wrong tag is not a loud failure: it is a valid signature
// the sequencer routes somewhere else.
//
// THE THREE THINGS THAT ARE EASY TO GET WRONG, all checked below:
//
//   1. The TAG. TxTypeL2UpdateLeverage is 20, read from lighter-go's
//      types/txtypes/constants.go at commit cef81af, which is the commit
//      public/lighter/main.wasm was built from (signer.ts documents the build).
//      Reading upstream main instead would be a different binary's answer. This
//      script re-fetches that pinned file so the constant cannot rot silently.
//   2. The SCALE. InitialMarginFraction is a uint16 where 10000 is 100%, so 2x
//      is 5000, not 2 and not 0.5. lighter-go rejects anything outside 1..10000.
//   3. The ARGUMENT ORDER. _signUpdateLeverage is curried and positional, and
//      marketIndex/initialMarginFraction/marginMode are all small integers, so
//      transposing two of them still signs cleanly. The only way to catch it is
//      to parse the signed txInfo back out and read the field names.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import {
  LIGHTER_API_KEY_INDEX,
  LIGHTER_CHAIN_ID,
  LIGHTER_MARGIN_FRACTION_SCALE,
  LIGHTER_MARGIN_MODE_CROSS,
  LIGHTER_MARGIN_MODE_ISOLATED,
  LIGHTER_TX_TYPE_UPDATE_LEVERAGE,
} from "../lib/lighter/constants";
import { buildCatalog, findMarket, tradeableMarkets } from "../lib/lighter/markets";
import { marginForLeverage, wireInitialMarginFraction } from "../lib/lighter/risk";
import { lighterOrderBookDetails } from "../lib/lighter/server";
import { HEDGE_LEVERAGE } from "../lib/lighter/order";

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

const PUBLIC_DIR = resolvePath(process.cwd(), "public", "lighter");
const SEED = "a".repeat(130);
const ACCOUNT_INDEX = 12345;

// The commit main.wasm was built from. Not "main": the tag has to match the
// binary that signs.
const LIGHTER_GO_COMMIT = "cef81af";
const CONSTANTS_URL =
  `https://raw.githubusercontent.com/elliottech/lighter-go/${LIGHTER_GO_COMMIT}` +
  `/types/txtypes/constants.go`;

type GoExport = (...args: unknown[]) => () => Promise<unknown>;

async function callGo<T>(name: string, args: unknown[]): Promise<T> {
  const fn = (globalThis as Record<string, unknown>)[name];
  if (typeof fn !== "function") {
    throw new Error(`missing export ${name}`);
  }
  return (await (fn as GoExport)(...args)()) as T;
}

function isError(result: unknown): result is { error: string } {
  return typeof result === "object" && result !== null && "error" in result;
}

interface SignedTx {
  txHash: string;
  txInfo: string;
}

async function main() {
  console.log("Lighter UpdateLeverage verification\n");

  // --- The tag, against the pinned source ---------------------------------
  section("Transaction tag");

  const source = await fetch(CONSTANTS_URL).then((r) =>
    r.ok ? r.text() : Promise.reject(new Error(`constants.go ${r.status}`)),
  );

  // Parse rather than eyeball. Three shapes appear in this file and a regex
  // written for only the first silently reports "not defined" for the others,
  // which reads as a missing constant rather than a bad pattern:
  //
  //   TxTypeL2CreateOrder        = 14         plain
  //   MarginFractionTick int64  = 10_000      typed, underscore-separated
  //   CrossMargin    = iota                   iota
  function constantIn(name: string): number | null {
    const match = source.match(
      new RegExp(`\\b${name}\\b[^=\\n]*=\\s*([0-9_]+|iota)`),
    );
    if (!match) return null;
    // iota opens a const block, so the entry carrying it is 0. Both uses here
    // (CrossMargin, RemoveFromIsolatedMargin) are the first line of their block
    // and their sibling is written as a literal 1, so there is no run to track.
    if (match[1] === "iota") return 0;
    return Number(match[1].replace(/_/g, ""));
  }

  const upstreamTag = constantIn("TxTypeL2UpdateLeverage");
  check(
    "TxTypeL2UpdateLeverage is defined upstream",
    upstreamTag !== null,
    `commit ${LIGHTER_GO_COMMIT}`,
  );
  check(
    "constants.ts agrees with lighter-go",
    upstreamTag === LIGHTER_TX_TYPE_UPDATE_LEVERAGE,
    `upstream ${upstreamTag}, ours ${LIGHTER_TX_TYPE_UPDATE_LEVERAGE}`,
  );

  // The four tags already in production are the control. If these agree, the
  // table is the one our constants came from and the fifth value is trustworthy.
  for (const [name, ours] of [
    ["TxTypeL2ChangePubKey", 8],
    ["TxTypeL2Withdraw", 13],
    ["TxTypeL2CreateOrder", 14],
    ["TxTypeL2CancelOrder", 15],
  ] as const) {
    check(`${name} still ${ours}`, constantIn(name) === ours);
  }

  check(
    "MarginFractionTick is the 10000 scale we assume",
    constantIn("MarginFractionTick") === LIGHTER_MARGIN_FRACTION_SCALE,
  );
  check("CrossMargin is 0", constantIn("CrossMargin") === LIGHTER_MARGIN_MODE_CROSS);
  check(
    "IsolatedMargin is 1",
    constantIn("IsolatedMargin") === LIGHTER_MARGIN_MODE_ISOLATED,
  );

  // --- Fraction arithmetic against real markets ---------------------------
  section("Fraction arithmetic");

  // buildCatalog returns the market array itself, not a { markets } wrapper.
  const catalog = buildCatalog(await lighterOrderBookDetails());
  const tsla = findMarket(catalog, "TSLA");

  if (!tsla) {
    check("TSLA market is listed", false);
  } else {
    const two = wireInitialMarginFraction(HEDGE_LEVERAGE, tsla);
    check(
      `${HEDGE_LEVERAGE}x maps to fraction ${LIGHTER_MARGIN_FRACTION_SCALE / HEDGE_LEVERAGE}`,
      two.fraction === LIGHTER_MARGIN_FRACTION_SCALE / HEDGE_LEVERAGE,
      `got ${two.fraction}`,
    );
    check("requested leverage survives the clamp", two.leverage === HEDGE_LEVERAGE);

    // A hedge asks for 2x, far below any market maximum, so the clamp should
    // never bind in production. Checked anyway because it is the guard that
    // stops an over-leveraged request reaching the exchange as a rejection.
    const greedy = wireInitialMarginFraction(1000, tsla);
    check(
      "leverage above the market maximum clamps",
      greedy.leverage === tsla.maxLeverage,
      `asked 1000x, got ${greedy.leverage}x`,
    );
    check(
      "the clamped fraction is still inside 1..10000",
      greedy.fraction >= 1 && greedy.fraction <= LIGHTER_MARGIN_FRACTION_SCALE,
      `${greedy.fraction}`,
    );

    note("TSLA max leverage", `${tsla.maxLeverage}x`);
    note(
      "TSLA default initial margin",
      `${(tsla.initialMarginFraction * 100).toFixed(2)}% (${(1 / tsla.initialMarginFraction).toFixed(1)}x)`,
    );
    note(
      "what a hedge will now send",
      `fraction ${two.fraction} (${two.leverage}x), mode ${LIGHTER_MARGIN_MODE_ISOLATED} (isolated)`,
    );
  }

  // Every market must be able to express the hedge leverage, or a hedge on that
  // market silently opens at something else.
  // Scoped to TRADEABLE markets rather than the whole catalog. Lighter lists
  // inactive markets with their config zeroed out, and min_initial_margin_fraction
  // 0 makes maxLeverage fall back to 1, which reads as "cannot express 2x" for a
  // market no hedge can reach anyway. MKR is in that state today.
  const hedgeable = tradeableMarkets(catalog);
  const unexpressible = hedgeable.filter((market) => {
    try {
      return wireInitialMarginFraction(HEDGE_LEVERAGE, market).leverage !== HEDGE_LEVERAGE;
    } catch {
      return true;
    }
  });
  check(
    `every tradeable market can express ${HEDGE_LEVERAGE}x`,
    unexpressible.length === 0,
    unexpressible.length
      ? unexpressible.map((m) => m.symbol).join(", ")
      : `${hedgeable.length} of ${catalog.length} markets tradeable`,
  );

  // The clamp is the safety net for the ones that cannot. It has to be silent in
  // the same direction everywhere: the panel reads leverage back from
  // marginForLeverage and the transaction reads it from
  // wireInitialMarginFraction, so if those two ever disagree the display and the
  // exchange diverge again, which is the exact bug this work fixes.
  const inconsistent = catalog.filter((market) => {
    try {
      return (
        wireInitialMarginFraction(HEDGE_LEVERAGE, market).leverage !==
        marginForLeverage(1, HEDGE_LEVERAGE, market).leverage
      );
    } catch {
      return false;
    }
  });
  check(
    "displayed leverage matches transmitted leverage on every market",
    inconsistent.length === 0,
    inconsistent.length ? inconsistent.map((m) => m.symbol).join(", ") : `${catalog.length} markets`,
  );

  // --- The signer ---------------------------------------------------------
  section("Signer");

  const wasmBytes = readFileSync(resolvePath(PUBLIC_DIR, "main.wasm"));
  await import(pathToFileURL(resolvePath(PUBLIC_DIR, "wasm_exec.js")).href);

  const Go = (globalThis as Record<string, unknown>).Go as
    | (new () => {
        importObject: WebAssembly.Imports;
        run(instance: WebAssembly.Instance): Promise<void>;
      })
    | undefined;

  if (!Go) {
    check("wasm_exec.js defines Go", false);
    process.exit(1);
  }

  const go = new Go();
  const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
  void go.run(instance);
  await new Promise((r) => setTimeout(r, 50));

  check(
    "_signUpdateLeverage is exported",
    typeof (globalThis as Record<string, unknown>)._signUpdateLeverage === "function",
  );

  await callGo("_createClient", [
    SEED,
    LIGHTER_CHAIN_ID,
    ACCOUNT_INDEX,
    0,
    LIGHTER_API_KEY_INDEX,
  ]);

  const MARKET_INDEX = 112; // TSLA
  const FRACTION_2X = LIGHTER_MARGIN_FRACTION_SCALE / HEDGE_LEVERAGE;
  const NONCE = 7;

  // Exactly the call lib/lighter/order.ts makes.
  const signed = await callGo<SignedTx | { error: string }>("_signUpdateLeverage", [
    ACCOUNT_INDEX,
    MARKET_INDEX,
    FRACTION_2X,
    LIGHTER_MARGIN_MODE_ISOLATED,
    NONCE,
  ]);

  check("a 2x isolated UpdateLeverage signs", !isError(signed));
  if (isError(signed)) {
    note("message", signed.error);
  }

  // --- Argument order, read back off the signed transaction ---------------
  //
  // The point of the whole script. Three small integers in a row sign cleanly in
  // any order; only the field names prove which one landed where.
  if (!isError(signed)) {
    section("Argument order");
    note("tx hash", signed.txHash);

    const info = JSON.parse(signed.txInfo) as Record<string, unknown>;
    note("txInfo fields", Object.keys(info).join(", "));

    check("AccountIndex is the account", Number(info.AccountIndex) === ACCOUNT_INDEX);
    check(
      "MarketIndex is the market, not the fraction",
      Number(info.MarketIndex) === MARKET_INDEX,
      `${String(info.MarketIndex)}`,
    );
    check(
      "InitialMarginFraction is the 10000-scaled fraction",
      Number(info.InitialMarginFraction) === FRACTION_2X,
      `${String(info.InitialMarginFraction)}`,
    );
    check(
      "MarginMode is isolated",
      Number(info.MarginMode) === LIGHTER_MARGIN_MODE_ISOLATED,
      `${String(info.MarginMode)}`,
    );
    check("Nonce is the nonce", Number(info.Nonce) === NONCE);
    check(
      "ApiKeyIndex is our slot, not Lighter's own",
      Number(info.ApiKeyIndex) === LIGHTER_API_KEY_INDEX,
      `${String(info.ApiKeyIndex)}`,
    );
    // Sig is []byte in Go, which encoding/json marshals to a base64 STRING, not
    // an array and not an object. Asserting the wrong one fails on a perfectly
    // good signature.
    check(
      "carries a signature",
      typeof info.Sig === "string" && info.Sig.length > 0,
      `${typeof info.Sig}, ${String(info.Sig).length} chars`,
    );
  }

  // --- Validation boundaries ----------------------------------------------
  //
  // lighter-go validates before signing, so these are the errors a bad fraction
  // produces here rather than at the sequencer. Confirming they are refused is
  // what justifies wireInitialMarginFraction throwing on the same range.
  section("Validation boundaries");

  const zero = await callGo("_signUpdateLeverage", [
    ACCOUNT_INDEX, MARKET_INDEX, 0, LIGHTER_MARGIN_MODE_ISOLATED, NONCE,
  ]);
  check("fraction 0 is refused", isError(zero));

  const tooHigh = await callGo("_signUpdateLeverage", [
    ACCOUNT_INDEX,
    MARKET_INDEX,
    LIGHTER_MARGIN_FRACTION_SCALE + 1,
    LIGHTER_MARGIN_MODE_ISOLATED,
    NONCE,
  ]);
  check("fraction above 10000 is refused", isError(tooHigh));

  const badMode = await callGo("_signUpdateLeverage", [
    ACCOUNT_INDEX, MARKET_INDEX, FRACTION_2X, 2, NONCE,
  ]);
  check("an unknown margin mode is refused", isError(badMode));

  const cross = await callGo("_signUpdateLeverage", [
    ACCOUNT_INDEX, MARKET_INDEX, FRACTION_2X, LIGHTER_MARGIN_MODE_CROSS, NONCE,
  ]);
  check("cross mode also signs, so mode is a real choice", !isError(cross));

  console.log(
    failures === 0
      ? "\nAll checks passed. The tag, the scale and the argument order are confirmed.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("\nCheck aborted:", error instanceof Error ? error.message : error);
  process.exit(1);
});
