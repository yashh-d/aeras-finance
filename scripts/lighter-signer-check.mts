// Lighter signer verification. Loads the WASM module we vendored into
// public/lighter and proves it derives keys and produces signatures, so a bad
// rebuild or a mismatched wasm_exec.js fails here rather than at the moment a
// user tries to place a hedge.
//
//   npx tsx scripts/lighter-signer-check.mts
//
// Signs, but submits nothing. Every signature made here is thrown away. The
// account index is fake and the seeds are constants, so nothing this touches
// corresponds to a real Lighter account.
//
// It reads the live market catalog for one section, to check that a size
// produced by sizing.ts is actually accepted by the signer for a real market.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { LIGHTER_CHAIN_ID, LIGHTER_API_KEY_INDEX } from "../lib/lighter/constants";
import { buildCatalog, findMarket } from "../lib/lighter/markets";
import { lighterOrderBookDetails } from "../lib/lighter/server";
import { slippageBoundPrice, toWireInteger } from "../lib/lighter/sizing";

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

// The shape of an Ethereum personal_sign result: 65 bytes of hex. Using that
// shape here rather than an arbitrary blob is the point, since it is what the
// onboarding flow will actually feed in.
const SEED_A = "a".repeat(130);
const SEED_B = "b".repeat(130);
const ACCOUNT_INDEX = 12345;

// Mirrors lib/lighter/signer.ts. Kept separate because that module loads over
// HTTP and touches document, neither of which exists here, and because a check
// that shared its code could not catch a mistake in it.
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

const EXPECTED_EXPORTS = [
  "_createClient",
  "_signChangePubKey",
  "_signCreateOrder",
  "_signCancelOrder",
  "_signWithdraw",
  "_signUpdateLeverage",
  "_createAuthToken",
];

async function main() {
  console.log("Lighter signer verification\n");

  section("Vendored artifacts");

  const wasmPath = resolvePath(PUBLIC_DIR, "main.wasm");
  const execPath = resolvePath(PUBLIC_DIR, "wasm_exec.js");
  const wasmBytes = readFileSync(wasmPath);

  check("main.wasm is present", wasmBytes.length > 0, `${(wasmBytes.length / 1_000_000).toFixed(1)}MB`);
  check(
    "main.wasm is a WebAssembly module",
    wasmBytes.subarray(0, 4).toString("hex") === "0061736d",
  );

  // These two are a matched pair from one Go toolchain. If they ever drift,
  // instantiation below is where it surfaces.
  await import(pathToFileURL(execPath).href);
  const Go = (globalThis as Record<string, unknown>).Go as (new () => {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  }) | undefined;

  check("wasm_exec.js defines Go", typeof Go === "function");
  if (!Go) {
    console.log("\nCannot continue without the Go runtime shim.");
    process.exit(1);
  }

  const go = new Go();
  const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
  void go.run(instance);
  await new Promise((r) => setTimeout(r, 50));

  section("Exports");
  for (const name of EXPECTED_EXPORTS) {
    check(name, typeof (globalThis as Record<string, unknown>)[name] === "function");
  }

  // --- Key derivation -----------------------------------------------------
  //
  // The onboarding design derives the trading key from a fixed personal_sign
  // rather than storing it, which only works if derivation is a pure function of
  // the seed. If this ever stopped holding, a returning user would silently get
  // a different key than the one their account is registered with and every
  // order would be rejected.
  section("Key derivation");

  interface CreateClientResponse {
    success: boolean;
    pubKeySuccess: boolean;
    pk: string;
    prv: string;
    body: string;
  }

  const first = await callGo<CreateClientResponse>("_createClient", [
    SEED_A,
    LIGHTER_CHAIN_ID,
    ACCOUNT_INDEX,
    0,
    LIGHTER_API_KEY_INDEX,
  ]);

  check("client created", first.success === true);
  check("public key derived", first.pubKeySuccess === true);
  check("public key is 40 bytes", first.pk.length === 80, `${first.pk.length / 2} bytes`);
  note("public key", first.pk);

  const again = await callGo<CreateClientResponse>("_createClient", [
    SEED_A,
    LIGHTER_CHAIN_ID,
    ACCOUNT_INDEX,
    0,
    LIGHTER_API_KEY_INDEX,
  ]);
  check("same seed derives the same key", again.pk === first.pk);

  const other = await callGo<CreateClientResponse>("_createClient", [
    SEED_B,
    LIGHTER_CHAIN_ID,
    ACCOUNT_INDEX + 1,
    0,
    LIGHTER_API_KEY_INDEX,
  ]);
  check("a different seed derives a different key", other.pk !== first.pk);

  // The user sees this in their wallet before signing, so it must stay readable
  // and must actually name the key being authorized.
  section("Registration message");
  check("is plain text", !first.body.startsWith("0x"));
  check("names the key being authorized", first.body.includes(first.pk));
  check("states what is being signed", first.body.includes("Register Lighter Account"));
  note("first line", first.body.split("\n")[0]);

  // --- Order signing ------------------------------------------------------
  //
  // Lighter validates market orders strictly, and a rejected order still spends
  // the nonce. signMarketOrder in signer.ts hardcodes the one accepted
  // combination; these checks are what justify that hardcoding.
  section("Market order rules");

  interface SignedTx {
    txHash: string;
    txInfo: string;
  }

  const MARKET_ORDER = 1;
  const IMMEDIATE_OR_CANCEL = 0;
  const GOOD_TILL_TIME = 1;

  const marketOrder = await callGo<SignedTx | { error: string }>("_signCreateOrder", [
    ACCOUNT_INDEX, 1, 1, "100000", "77600", 1, MARKET_ORDER, IMMEDIATE_OR_CANCEL, 0, "0", 0, 0,
  ]);
  check("a market order signs", !isError(marketOrder));
  if (!isError(marketOrder)) {
    note("tx hash", marketOrder.txHash);
  }

  const wrongTif = await callGo("_signCreateOrder", [
    ACCOUNT_INDEX, 1, 1, "100000", "77600", 1, MARKET_ORDER, GOOD_TILL_TIME, 0, "0", 0, 0,
  ]);
  check("a market order with the wrong time in force is refused", isError(wrongTif));

  const wrongExpiry = await callGo("_signCreateOrder", [
    ACCOUNT_INDEX, 1, 1, "100000", "77600", 1, MARKET_ORDER, IMMEDIATE_OR_CANCEL, 0, "0", 1800000000000, 0,
  ]);
  check("a market order carrying an expiry is refused", isError(wrongExpiry));

  const wrongTrigger = await callGo("_signCreateOrder", [
    ACCOUNT_INDEX, 1, 1, "100000", "77600", 1, MARKET_ORDER, IMMEDIATE_OR_CANCEL, 0, "5000", 0, 0,
  ]);
  check("a market order carrying a trigger price is refused", isError(wrongTrigger));

  // Errors arrive as a resolved value, not a rejection. Every wrapper in
  // signer.ts depends on this, and a caller that only handles rejections would
  // read a failure as a successful signature with undefined fields.
  section("Error convention");
  const unknownAccount = await callGo("_signCreateOrder", [
    999999, 1, 1, "1", "1", 1, MARKET_ORDER, IMMEDIATE_OR_CANCEL, 0, "0", 0, 0,
  ]);
  check("an unknown account resolves rather than rejecting", isError(unknownAccount));
  if (isError(unknownAccount)) {
    note("message", unknownAccount.error);
  }

  section("Auth token");
  interface AuthToken {
    token: string;
    deadline: number;
    accountIndex: number;
    apiKeyIndex: number;
  }
  const auth = await callGo<AuthToken>("_createAuthToken", [ACCOUNT_INDEX, LIGHTER_API_KEY_INDEX]);
  check("token issued", typeof auth.token === "string" && auth.token.length > 0);
  check(
    "token encodes deadline, account and key index",
    auth.token.startsWith(`${auth.deadline}:${auth.accountIndex}:${auth.apiKeyIndex}:`),
  );
  check("deadline is in the future", auth.deadline * 1000 > Date.now());
  check("uses our api key slot, not Lighter's own", auth.apiKeyIndex === LIGHTER_API_KEY_INDEX);
  note("expires in", `${Math.round((auth.deadline * 1000 - Date.now()) / 60000)} minutes`);

  // --- Live market round trip ---------------------------------------------
  //
  // The failure this catches is scaling a size by the wrong market's decimals,
  // which is a 10x order rather than an error. Here a real market's decimals go
  // through sizing.ts and out to a real signature.
  section("Live market round trip");

  const catalog = buildCatalog(await lighterOrderBookDetails());
  const spy = findMarket(catalog, "SPY");

  if (!spy) {
    check("SPY market found", false);
  } else {
    const baseAmount = toWireInteger("10", spy.sizeDecimals);
    const bound = slippageBoundPrice(spy.markPrice, 50, true, spy.priceDecimals);

    note("SPY mark", `$${spy.markPrice}`);
    note("size decimals", String(spy.sizeDecimals));
    note("10 shares as wire integer", baseAmount);
    note("slippage bound", `$${bound.price} -> ${bound.wirePrice}`);

    check(
      "slippage bound sits below the mark for a sell",
      Number(bound.price) < Number(spy.markPrice),
    );

    const signed = await callGo<SignedTx | { error: string }>("_signCreateOrder", [
      ACCOUNT_INDEX,
      spy.marketId,
      Date.now() % 1_000_000,
      baseAmount,
      bound.wirePrice,
      1,
      MARKET_ORDER,
      IMMEDIATE_OR_CANCEL,
      0,
      "0",
      0,
      0,
    ]);

    check("a real SPY short signs", !isError(signed));
    if (!isError(signed)) {
      const info = JSON.parse(signed.txInfo) as {
        BaseAmount: number;
        MarketIndex: number;
        IsAsk: number;
        ApiKeyIndex: number;
      };
      check("base amount survives the round trip", String(info.BaseAmount) === baseAmount);
      check("market index is SPY's", info.MarketIndex === spy.marketId);
      check("side is sell", info.IsAsk === 1);
      check("signed with our api key slot", info.ApiKeyIndex === LIGHTER_API_KEY_INDEX);
    }
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
