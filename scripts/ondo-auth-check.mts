// Ondo Perps auth reachability check. Answers one question: how much of the
// integration is actually blocked on the builder onboarding email, and how much
// only looked blocked because the sandbox *frontend* is behind Ondo's Okta.
//
//   npx tsx scripts/ondo-auth-check.mts
//
// Runs the full SIWE handshake against sandbox using a burner keypair generated
// here and thrown away at exit. No real wallet is touched, no funds exist on the
// address, and nothing is deposited or traded.
//
// It deliberately stops short of POST /v1/agreement. That call accepts Ondo's
// terms of service on behalf of whoever holds the address, and consent is not
// something a check script gets to give. If the reads below come back demanding
// an agreement, that is the answer: the remaining step is a user action in the
// product, not a blocker on us.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  ONDO_API_BASE_URL,
  ONDO_AUTH_CHAIN_ID,
  ONDO_ENV,
} from "../lib/ondo/constants";

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

// The live API 403s a bare fetch. Same workaround the doc records for curl.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface Envelope<T> {
  success: boolean;
  result?: T;
  error?: string;
  error_code?: string;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  const res = await fetch(`${ONDO_API_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: Envelope<T>;
  try {
    body = JSON.parse(text) as Envelope<T>;
  } catch {
    body = { success: false, error: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`Ondo Perps auth check  (${ONDO_ENV} -> ${ONDO_API_BASE_URL})`);

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  note("burner address", account.address);

  section("1. Challenge, with no builder code and no invite code");

  const challenge = await call<{ id: string; message: string }>(
    "/v1/auth/erc-4361/login/get_challenge",
    {
      method: "POST",
      body: { walletAddress: account.address, chainId: ONDO_AUTH_CHAIN_ID },
    },
  );
  check(
    "get_challenge is reachable unauthenticated",
    challenge.status === 200 && challenge.body.success,
    `http ${challenge.status}`,
  );
  const issued = challenge.body.result;
  if (!issued) {
    console.log(`\nno challenge issued: ${challenge.body.error ?? "unknown"}`);
    process.exit(1);
  }

  // The SIWE message states the domain it is scoped to. Worth asserting, because
  // a challenge minted for the wrong host would be a silent cross-env mix-up.
  const host = new URL(ONDO_API_BASE_URL).host.replace(/^api\./, "app.");
  check(
    "challenge is scoped to the matching frontend",
    issued.message.includes(host),
    host,
  );
  check(
    `challenge asserts chain ${ONDO_AUTH_CHAIN_ID}`,
    issued.message.includes(`Chain ID: ${ONDO_AUTH_CHAIN_ID}`),
  );

  section("2. An unknown builder code at challenge time");

  const bogus = await call<{ id: string; message: string }>(
    "/v1/auth/erc-4361/login/get_challenge",
    {
      method: "POST",
      body: {
        walletAddress: account.address,
        chainId: ONDO_AUTH_CHAIN_ID,
        builderCode: "AERAS_NOT_A_REAL_CODE",
      },
    },
  );
  // Not a pass/fail on Ondo, a fact about them we have to code around: a wrong
  // builder code is accepted here and baked into the JWT. It cannot be validated
  // at login, so ONDO_BUILDER_CODE being empty or stale will not surface until
  // fills stop being attributed. Guard it on our side.
  note(
    "unknown builderCode accepted at get_challenge",
    bogus.status === 200 && bogus.body.success ? "yes, silently" : "no",
  );

  section("3. Complete the handshake with a real signature");

  const signature = await account.signMessage({ message: issued.message });
  const completed = await call<{ token: string }>(
    "/v1/auth/erc-4361/login/complete_challenge",
    { method: "POST", body: { id: issued.id, signature } },
  );
  check(
    "complete_challenge accepts a fresh keypair",
    completed.status === 200 && Boolean(completed.body.result?.token),
    completed.body.error ?? `http ${completed.status}`,
  );
  const token = completed.body.result?.token;
  if (!token) {
    console.log(
      "\nSandbox is gated behind something beyond the signature. That is the " +
        "thing to put in the email to builders@ondoperps.xyz.",
    );
    process.exit(1);
  }
  note("jwt length", String(token.length));

  section("4. What state a brand new account lands in");

  interface AccountResult {
    accountID?: string;
    accountState?: string;
    termsVersion?: number;
    cooldownPeriodSecs?: number;
    disabledFunctionality?: Record<string, boolean>;
  }

  const acct = await call<AccountResult>("/v1/account", { token });
  const accountId = acct.body.result?.accountID;
  check(
    "GET /v1/account answers with a session",
    acct.status === 200 && acct.body.success,
    acct.body.error_code ?? acct.body.error ?? `http ${acct.status}`,
  );

  // This is the load-bearing assertion. Ondo's onboarding prose implies the
  // account ID comes from a frontend login and that API keys are switched on by
  // hand. Neither is true of the API.
  check("accountID is issued without any human step", Boolean(accountId));
  if (accountId) note("accountID", accountId);

  const flags = acct.body.result?.disabledFunctionality ?? {};
  check("account opens immediately", acct.body.result?.accountState === "open");
  check("perps are enabled on a fresh account", flags.disablePerps === false);
  check("API key creation is enabled", flags.disableAPIKeyCreation === false);
  check("transfers are enabled", flags.disableTransfers === false);
  note("termsVersion on a fresh account", String(acct.body.result?.termsVersion));
  note(
    "cooldownPeriodSecs",
    `${acct.body.result?.cooldownPeriodSecs} (undocumented, applies to withdrawals)`,
  );

  section("5. Reads that should work before any terms acceptance");

  // /v1/deposits is what the integration guide lists. It 404s in both
  // environments. The real path is under /v1/wallet.
  const paths = [
    "/v1/perps/balance",
    "/v1/perps/positions",
    "/v1/perps/orders?status=open",
    "/v1/perps/max_order_size?market=US500-USD.P",
    "/v1/wallet/deposits",
  ];
  for (const path of paths) {
    const res = await call<unknown>(path, { token });
    check(
      `GET ${path}`,
      res.status === 200 && res.body.success,
      res.body.error_code ?? res.body.error ?? `http ${res.status}`,
    );
  }

  const legacyDeposits = await call<unknown>("/v1/deposits", { token });
  check(
    "GET /v1/deposits is still gone (guide lists it, it 404s)",
    legacyDeposits.status === 404,
    `http ${legacyDeposits.status}`,
  );

  section("Verdict");

  if (accountId) {
    console.log(
      "  The account ID is self-serve, in both environments. Ondo's step 1 only\n" +
        "  looked blocking because it routes through a frontend we cannot reach.\n" +
        "  The API never needed it, and API key creation is already enabled.\n" +
        "  The onboarding email now buys exactly one thing: the builder code, which\n" +
        "  affects fee attribution and nothing else. It does not gate the build.",
    );
  } else {
    console.log(
      "  A session exists but the account read did not return an ID. Read the\n" +
        "  error_code above: if it asks for an agreement, that is POST /v1/agreement,\n" +
        "  a terms acceptance that belongs to the user in the product UI, not here.",
    );
  }

  console.log(
    `\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
