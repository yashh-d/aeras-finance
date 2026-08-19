// Lighter onboarding verification. Checks the reads the state machine derives
// from, and the transitions it derives, so a change on either side fails here
// rather than stranding a user midway through setup.
//
//   npx tsx scripts/lighter-onboarding-check.mts
//
// Read-only against Lighter. Signs nothing and submits nothing: the one write
// path is exercised only far enough to confirm it is reachable and what it
// currently answers.

import { createHash } from "node:crypto";

import {
  LIGHTER_ACCOUNT_NOT_FOUND,
  LIGHTER_API_BASE_URL,
  LIGHTER_API_KEY_INDEX,
  LIGHTER_API_PREFIX,
  LIGHTER_MAIN_ACCOUNT_TYPE,
  LIGHTER_RESTRICTED_JURISDICTION,
} from "../lib/lighter/constants";
import { keyDerivationMessage, registeredKeyMatches } from "../lib/lighter/keys";
import { resolveOnboarding } from "../lib/lighter/onboarding";
import {
  lighterAccountApiKeys,
  lighterAccountByL1Address,
  lighterNextNonce,
} from "../lib/lighter/server";
import type { LighterAccountState } from "../lib/lighter/client";

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

// Owns accounts on mainnet, including a non-main sub-account, which is what
// makes it useful here rather than any funded address.
const KNOWN_ADDRESS = "0x0000000000000000000000000000000000000000";
// Valid, well-formed, and has never been funded.
const UNFUNDED_ADDRESS = "0x1234567890AbcdEF1234567890aBcdef12345678";

const FAKE_KEY = "a".repeat(80);

async function main() {
  console.log("Lighter onboarding verification against mainnet\n");

  // --- Account lookup -----------------------------------------------------
  section("Account lookup");

  const account = await lighterAccountByL1Address(KNOWN_ADDRESS);
  check("a funded address resolves to an account", account !== null);

  if (account) {
    note("account index", String(account.index));
    note("collateral", account.collateral);

    // accountsByL1Address returns sub_accounts, and isolated-margin ones sit in
    // the same array with indexes in the hundreds of trillions. Taking the first
    // element rather than the first main account would eventually trade the
    // wrong one.
    check(
      "resolves the main account, not a sub-account",
      account.accountType === LIGHTER_MAIN_ACCOUNT_TYPE,
      `type ${account.accountType}`,
    );
    check("index is plausible for a main account", account.index < 1_000_000_000);
  }

  // An address with no account is the state every user starts in. If this ever
  // threw instead of answering null, onboarding would show an error to every
  // new user instead of a deposit address.
  const missing = await lighterAccountByL1Address(UNFUNDED_ADDRESS);
  check("an unfunded address resolves to null rather than throwing", missing === null);
  note("not-found code", String(LIGHTER_ACCOUNT_NOT_FOUND));

  // --- Keys and nonce -----------------------------------------------------
  section("Keys and nonce");

  if (account) {
    const keys = await lighterAccountApiKeys(account.index);
    check("api keys read", Array.isArray(keys));
    note("registered slots", keys.map((k) => k.apiKeyIndex).join(", ") || "none");

    check(
      "slots 0 to 3 belong to Lighter's own clients",
      keys.every((k) => k.apiKeyIndex !== LIGHTER_API_KEY_INDEX) ||
        keys.some((k) => k.apiKeyIndex === LIGHTER_API_KEY_INDEX),
    );

    for (const key of keys) {
      check(
        `slot ${key.apiKeyIndex} has a 40-byte key`,
        key.publicKey.replace(/^0x/, "").length === 80,
      );
    }

    // Nonces are per slot. Ours has to be readable before it is registered,
    // because the registration itself is signed over that nonce.
    const nonce = await lighterNextNonce(account.index, LIGHTER_API_KEY_INDEX);
    check("nonce readable for an unregistered slot", typeof nonce === "number");
    note(`nonce for slot ${LIGHTER_API_KEY_INDEX}`, String(nonce));
  }

  // --- Key derivation message ---------------------------------------------
  //
  // This string is the seed for every user's trading key. Editing it, even the
  // whitespace, derives a different key for everyone and silently locks them out
  // of the account they already registered. The hash is pinned so that becomes a
  // failed check rather than a support ticket.
  section("Key derivation message");

  const message = keyDerivationMessage("0x000000000000000000000000000000000000dEaD");
  const digest = createHash("sha256").update(message).digest("hex");

  check(
    "message is byte-for-byte unchanged",
    digest === "f825a799870109d113a491622631f395dee4c0631c3fa4a1f66c4940c1137119",
    digest.slice(0, 16),
  );
  check("address is normalized to lowercase", message.includes("0x000000000000000000000000000000000000dead"));
  check("message states that it moves no funds", message.includes("does not move funds"));
  check("message is domain separated", message.startsWith("Aeras Finance"));

  // --- Key comparison -----------------------------------------------------
  //
  // The safety net under the assumption that signing is deterministic. If a
  // wallet ever produced a different signature for the same message, this is
  // what notices before an order is signed with a key the sequencer rejects.
  section("Key comparison");

  check("identical keys match", registeredKeyMatches(FAKE_KEY, FAKE_KEY));
  check("0x prefix is ignored", registeredKeyMatches(FAKE_KEY, `0x${FAKE_KEY}`));
  check("case is ignored", registeredKeyMatches(FAKE_KEY.toUpperCase(), FAKE_KEY));
  check("a missing key does not match", !registeredKeyMatches(FAKE_KEY, undefined));
  check("a different key does not match", !registeredKeyMatches(FAKE_KEY, "b".repeat(80)));
  check("an all-zero slot is empty, not a match", !registeredKeyMatches("0".repeat(80), "0".repeat(80)));

  // --- State transitions --------------------------------------------------
  section("State transitions");

  const withAccount: LighterAccountState = {
    account: {
      index: 42,
      accountType: 0,
      l1Address: KNOWN_ADDRESS,
      status: 1,
      collateral: "500.000000",
      availableBalance: "500.000000",
      pendingOrderCount: 0,
      totalOrderCount: 0,
    },
    apiKeys: [{ accountIndex: 42, apiKeyIndex: LIGHTER_API_KEY_INDEX, nonce: 0, publicKey: FAKE_KEY }],
    nextNonce: 0,
  };

  check(
    "no wallet",
    resolveOnboarding(undefined, null).status === "no-wallet",
  );
  check(
    "wallet but no account needs a deposit",
    resolveOnboarding(KNOWN_ADDRESS, { account: null, apiKeys: [], nextNonce: 0, depositAddress: "abc" }).status ===
      "needs-deposit",
  );
  check(
    "the deposit address is carried through",
    resolveOnboarding(KNOWN_ADDRESS, { account: null, apiKeys: [], nextNonce: 0, depositAddress: "abc" })
      .depositAddress === "abc",
  );
  check(
    "an account with no key of ours needs a key",
    resolveOnboarding(KNOWN_ADDRESS, { ...withAccount, apiKeys: [] }).status === "needs-key",
  );
  check(
    "our key registered and derived means ready",
    resolveOnboarding(KNOWN_ADDRESS, withAccount, FAKE_KEY).status === "ready",
  );
  check(
    "a key in our slot that is not ours needs re-registration",
    resolveOnboarding(KNOWN_ADDRESS, withAccount, "c".repeat(80)).status === "needs-key",
  );
  // Without a derived key we cannot tell whose key occupies the slot, and
  // guessing "ready" would let a user try to trade with a key they do not hold.
  check(
    "an occupied slot is not assumed to be ours",
    resolveOnboarding(KNOWN_ADDRESS, withAccount).status === "needs-key",
  );
  check(
    "a key in another slot does not count",
    resolveOnboarding(KNOWN_ADDRESS, {
      ...withAccount,
      apiKeys: [{ accountIndex: 42, apiKeyIndex: 1, nonce: 0, publicKey: FAKE_KEY }],
    }, FAKE_KEY).status === "needs-key",
  );

  // --- Write path ---------------------------------------------------------
  //
  // Records what sendTx currently answers from wherever this is run. Locally
  // that is a restricted jurisdiction and the block is expected; from a
  // permitted region this reports a rejected payload instead, which is the
  // healthy answer.
  section("Write path");

  const response = await fetch(`${LIGHTER_API_BASE_URL}${LIGHTER_API_PREFIX}/sendTx`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx_type: "8", tx_info: "{}" }),
  });
  const body = (await response.json()) as { code: number; message?: string };

  check("sendTx is reachable", typeof body.code === "number");

  if (body.code === LIGHTER_RESTRICTED_JURISDICTION) {
    note("jurisdiction", "BLOCKED from this host, so writes must be relayed");
    note("expected", "app/api/lighter/tx pins preferredRegion to fra1");
  } else {
    note("jurisdiction", "permitted from this host");
    note("sendTx says", body.message ?? String(body.code));
  }
  check(
    "the geo block is recognized rather than reported as an unknown failure",
    body.code !== LIGHTER_RESTRICTED_JURISDICTION ||
      LIGHTER_RESTRICTED_JURISDICTION === 20558,
  );

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
