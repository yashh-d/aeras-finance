// Does Trustware return an executable transaction for a Solana-to-Solana
// conversion?
//
// Background: converting TSLAon into TSLAx never signed anything. Execution
// failed with "Trustware returned no transaction to sign", which comes from
// lib/trustware/execute.ts when the route response carries no
// `data.route.execution.transaction`.
//
// This calls Trustware's /route directly and reports, per request, which
// provider it selected and whether an executable transaction came back. Run it
// whenever the Solana conversion path misbehaves, or to re-test whether the
// upstream behaviour has changed.
//
//   TRUSTWARE_API_KEY=... npx tsx scripts/trustware-solana-route-check.mts
//   (or: set -a; . ./.env.local; set +a; npx tsx scripts/...)
//
// Read-only. It creates route intents, which cost nothing and move no funds,
// and it signs and submits nothing.

import { vaultById } from "../lib/jupiter/borrow";
import { uiToAtomic } from "../lib/trustware/amounts";
import {
  TRUSTWARE_API_BASE_URL,
  TRUSTWARE_SOLANA_CHAIN,
} from "../lib/trustware/constants";
import { equivalenceByVaultId } from "../lib/trustware/equivalents";

const vault = vaultById(77)!;
const sources = equivalenceByVaultId(77)!.sources;
const sol = sources.find((s) => s.kind === "solana")!;
const eth = sources.find((s) => s.chain === "1" && s.symbol === "TSLAon")!;

// Any valid pubkey. Funding does not change the outcome, which the FUNDED row
// below demonstrates.
const UNFUNDED_SOL = "3Gk1L9tHxYVSHqCS1w5aBpKZ7fJvcWjZ4kQ9EanKPUFY";
// Held 117 TSLAon when this script was written. Re-derive with
// getTokenLargestAccounts on the TSLAon mint if it has since moved.
const FUNDED_SOL = "HYyEoLDLMmL2wtKczx6JLNeUc7RqUnXGUUnPudwiAbN4";
const EVM = "0x1111111111111111111111111111111111111111";

function apiKey(): string {
  const key = process.env.TRUSTWARE_API_KEY;
  if (!key) throw new Error("TRUSTWARE_API_KEY is not set");
  return key;
}

interface Outcome {
  status: number;
  provider: string;
  executable: boolean;
  routeKeys: string[];
  txBytes: number | null;
}

async function call(
  endpoint: "route" | "quote",
  body: Record<string, unknown>,
): Promise<Outcome> {
  const res = await fetch(`${TRUSTWARE_API_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, never> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const json = parsed as Record<string, unknown> | null;
  const data = (json?.["data"] ?? json) as Record<string, unknown> | undefined;
  const route = (data?.["route"] ?? data) as Record<string, unknown> | undefined;
  const execution = route?.["execution"] as
    | { transaction?: { data?: string } }
    | undefined;
  const txData = execution?.transaction?.data;
  return {
    status: res.status,
    provider: (route?.["provider"] as string) ?? "-",
    executable: Boolean(txData),
    routeKeys: route ? Object.keys(route) : [],
    txBytes: txData ? Buffer.from(txData, "base64").length : null,
  };
}

function solanaRoute(fromAddress: string, ui: string) {
  return {
    fromChain: sol.chain,
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: sol.token,
    toToken: vault.collateralMint,
    fromAmount: uiToAtomic(ui, sol.decimals),
    fromAddress,
    toAddress: fromAddress,
    slippage: 0.3,
  };
}

function report(label: string, o: Outcome) {
  console.log(
    `  ${label.padEnd(34)} ${o.status}  provider=${o.provider.padEnd(6)}` +
      `  executable=${o.executable ? "YES" : "NO "}` +
      (o.txBytes ? `  tx=${o.txBytes}B` : ""),
  );
}

async function main() {
  console.log(
    "\n1. Solana -> Solana, across sizes, from a wallet holding no TSLAon",
  );
  for (const ui of ["0.0311", "0.1", "0.3", "1"]) {
    report(`${ui} TSLAon`, await call("route", solanaRoute(UNFUNDED_SOL, ui)));
  }

  console.log(
    `\n2. Same, from a wallet that genuinely holds TSLAon (${FUNDED_SOL.slice(0, 8)}...)`,
  );
  for (const ui of ["0.0311", "0.1", "0.3", "1"]) {
    report(`${ui} TSLAon`, await call("route", solanaRoute(FUNDED_SOL, ui)));
  }

  console.log("\n3. The same request repeated, to test determinism");
  for (let i = 0; i < 4; i++) {
    report(`attempt ${i + 1}`, await call("route", solanaRoute(FUNDED_SOL, "0.3")));
  }

  console.log("\n4. /quote's provider, for comparison with /route's");
  for (const ui of ["0.0311", "0.3"]) {
    const q = await call("quote", solanaRoute(FUNDED_SOL, ui));
    console.log(
      `  quote ${ui.padEnd(8)} provider=${q.provider}  (route picks its own, see above)`,
    );
  }

  console.log("\n5. Control: an EVM source into Solana, same destination token");
  const evmOut = await call("route", {
    fromChain: "1",
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: eth.token,
    toToken: vault.collateralMint,
    fromAmount: uiToAtomic("1", eth.decimals),
    fromAddress: EVM,
    toAddress: UNFUNDED_SOL,
    slippage: 1,
  });
  report("1 TSLAon on Ethereum", evmOut);
  console.log(`  route keys: ${JSON.stringify(evmOut.routeKeys)}`);

  console.log(
    "\nA route with executable=NO carries no execution.transaction, which is the\n" +
      "exact condition lib/trustware/execute.ts reports as \"no transaction to sign\".",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
