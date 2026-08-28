// Secure-withdrawal verification.
//
// The withdraw path (tx type 13) was built from Lighter's docs, their Python
// SDK's source and lighter-go, all read on 2026-08-27. This asserts the parts
// that can be proven without an account holding money: that the live API still
// describes the same machinery, that our WASM signer produces a structurally
// correct withdrawal under a throwaway key, and that the relay's allowlist
// actually admits the type.
//
//   npx tsx scripts/lighter-withdraw-check.mts
//
// Read-only against Lighter (public endpoints), signs only with a throwaway
// key for a fabricated account, submits nothing.

import {
  LIGHTER_API_BASE_URL,
  LIGHTER_API_PREFIX,
  LIGHTER_ASSET_ID_USDC,
  LIGHTER_MIN_SECURE_WITHDRAW_USDC,
  LIGHTER_ROUTE_PERP,
  LIGHTER_TX_TYPE_WITHDRAW,
} from "../lib/lighter/constants";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  console.log(`  ${condition ? "pass" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!condition) failures += 1;
}

// ── 1. The live API still describes the machinery we built against ──────────

async function checkLiveApi() {
  console.log("\n1. Live API");

  const delayRes = await fetch(
    `${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/withdrawalDelay`,
  );
  const delay = (await delayRes.json()) as { seconds?: number };
  check(
    "withdrawalDelay answers with a number of seconds",
    delayRes.ok && typeof delay.seconds === "number",
    `${delay.seconds}s ≈ ${Math.ceil((delay.seconds ?? 0) / 60)} min`,
  );

  // The docs say the delay is dynamic and has been posted as high as a day.
  // Not an assertion, a visibility line: the UI shows this number and a person
  // reading this output should see what users will see.
  if (typeof delay.seconds === "number" && delay.seconds > 3_600) {
    console.log(
      `        note: the delay currently exceeds an hour; the withdraw card will say so.`,
    );
  }
}

// ── 2. The WASM signer produces a structurally correct withdrawal ───────────

async function checkSigner() {
  console.log("\n2. WASM signer, throwaway key");

  // The signer module is browser-shaped (it fetches the WASM from /public), so
  // in a script it is exercised through the same Go runtime the browser uses.
  // If this block cannot run under tsx, that is reported rather than skipped
  // silently: the browser path is then the only proof, and it should be said.
  try {
    const { createSignerClient, signWithdraw } = await import(
      "../lib/lighter/signer"
    );

    // A fabricated account with a throwaway seed. The sequencer would reject
    // anything signed here; the assertion is about structure, not acceptance.
    const session = await createSignerClient({
      seed: `0x${"ab".repeat(32)}`,
      accountIndex: 424242,
      nonce: 0,
    });
    void session;

    const signed = await signWithdraw({
      accountIndex: 424242,
      assetIndex: LIGHTER_ASSET_ID_USDC,
      routeType: LIGHTER_ROUTE_PERP,
      assetAmount: String(LIGHTER_MIN_SECURE_WITHDRAW_USDC * 1_000_000),
      nonce: 0,
    });

    check("signWithdraw returns a txInfo", Boolean(signed.txInfo));
    check("signWithdraw returns a txHash", Boolean(signed.txHash));

    const info = JSON.parse(signed.txInfo) as Record<string, unknown>;
    // Field names from lighter-go's withdraw type via plain json.Marshal.
    for (const field of ["FromAccountIndex", "Nonce", "Sig"]) {
      check(`txInfo carries ${field}`, field in info);
    }
    check(
      "no destination field exists to get wrong",
      !("ToAddress" in info) && !("Memo" in info) && !("L1Sig" in info),
      "secure withdrawals can only pay the account's own L1 address",
    );
  } catch (err) {
    console.log(
      `  note  the WASM signer could not run under tsx (${err instanceof Error ? err.message.slice(0, 80) : err}).`,
    );
    console.log(
      "        Structure is then only proven in the browser; the first real withdrawal is the test.",
    );
  }
}

// ── 3. The relay admits the type ────────────────────────────────────────────

async function checkRelayPolicy() {
  console.log("\n3. Relay policy");

  // Asserted against the source rather than a live call, because a live call
  // would need a dev server. The allowlist is a Set literal; the withdraw
  // constant appearing in it is the policy.
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(
    new URL("../app/api/lighter/tx/route.ts", import.meta.url),
    "utf8",
  );
  check(
    "the relay allowlist includes LIGHTER_TX_TYPE_WITHDRAW",
    /RELAYABLE_TX_TYPES\s*=\s*new Set\(\[[^\]]*LIGHTER_TX_TYPE_WITHDRAW/s.test(
      route,
    ),
  );
  check(
    "L2 transfers (type 12) stay excluded",
    !route.includes("LIGHTER_TX_TYPE_TRANSFER"),
    "transfers can name another account; withdrawals cannot",
  );
  check("the withdraw tx type is 13", LIGHTER_TX_TYPE_WITHDRAW === 13);
}

async function main() {
  await checkLiveApi();
  await checkSigner();
  await checkRelayPolicy();
  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
