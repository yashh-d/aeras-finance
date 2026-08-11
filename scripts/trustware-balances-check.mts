// Slice 4b verification: does the /balances proxy find the convertible holdings
// a wallet actually has, and does the planner accept them?
//
// Runs against real mainnet addresses through a running dev server, so the API
// key stays server-side exactly as it does in the browser.
//
//   pnpm dev
//   npx tsx scripts/trustware-balances-check.mts
//   PROXY_ORIGIN=http://localhost:3000 npx tsx scripts/trustware-balances-check.mts
//
// Read-only. Signs nothing, submits nothing, moves nothing.

import { readFileSync } from "node:fs";

import { vaultById } from "../lib/jupiter/borrow";
import { atomicToUi } from "../lib/trustware/amounts";
import type { EquivalentBalances } from "../lib/trustware/balances";
import { describePlan, planCollateralDeposit } from "../lib/trustware/planner";
import type {
  TrustwareQuoteRequest,
  TrustwareQuoteResponse,
} from "../lib/trustware/types";

const ORIGIN = process.env.PROXY_ORIGIN ?? "http://localhost:3000";

// Real mainnet holders, found by reading Transfer logs and getTokenLargestAccounts
// directly rather than trusting the balance API to confirm itself.
const BSC_HOLDER = "0x9e229b12cc9081d6a510b29ccbd6311743e277ed";
const BSC_TSLAON = "0x2494b603319d4d9f9715c9f4496d9e0364b59d93";
const SOLANA_HOLDER = "HYyEoLDLMmL2wtKczx6JLNeUc7RqUnXGUUnPudwiAbN4";
const SOLANA_TSLAON = "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo";
// Vitalik. Active on Ethereum, holds none of our RWA equivalents.
const NO_EQUIVALENTS = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

// These are live trading wallets and their balances move between runs, so the
// amounts are checked against an independent read taken at the same time rather
// than against a snapshot committed here. That also makes the check stronger: it
// asserts Trustware agrees with mainnet now, not that it agreed once.

async function jsonRpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

// ERC-20 balanceOf via a public BSC node. No key, independent of Trustware.
async function bscBalanceOf(token: string, holder: string): Promise<string> {
  const data = `0x70a08231${holder.slice(2).toLowerCase().padStart(64, "0")}`;
  const hex = (await jsonRpc("https://bsc-rpc.publicnode.com", "eth_call", [
    { to: token, data },
    "latest",
  ])) as string;
  return BigInt(hex).toString();
}

// SPL balance via the RPC the app itself uses, read straight from .env.local so
// this script needs no separate configuration.
async function solanaBalanceOf(mint: string, owner: string): Promise<string> {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const url =
    env.match(/^NEXT_PUBLIC_SOLANA_RPC_URL=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ??
    "https://api.mainnet-beta.solana.com";
  const result = (await jsonRpc(url, "getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed" },
  ])) as {
    value?: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[];
  };
  return result.value?.[0]?.account.data.parsed.info.tokenAmount.amount ?? "0";
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function balances(params: {
  solana?: string;
  evm?: string;
}): Promise<{ status: number; body: EquivalentBalances & { error?: string } }> {
  const qs = new URLSearchParams();
  if (params.solana) qs.set("solana", params.solana);
  if (params.evm) qs.set("evm", params.evm);
  const res = await fetch(`${ORIGIN}/api/trustware/balances?${qs}`);
  return { status: res.status, body: await res.json() };
}

function show(held: EquivalentBalances["held"]) {
  for (const h of held) {
    console.log(
      `        ${h.source.symbol.padEnd(8)} ${h.source.chainLabel.padEnd(10)} ` +
        `${atomicToUi(h.balanceAtomic, h.source.decimals).padEnd(22)} ` +
        `(${h.source.decimals}d, ${h.source.kind})`,
    );
  }
}

async function main() {
  console.log(`\nA. EVM address holding real Ondo/xStock tokens on BNB Chain`);
  const evm = await balances({ evm: BSC_HOLDER });
  check("responds 200", evm.status === 200, `got ${evm.status}`);
  show(evm.body.held);
  check("found convertible holdings", evm.body.held.length > 0,
    `${evm.body.held.length} sources`);
  check(
    "no unreadable registry chains",
    evm.body.unreadableChains.length === 0,
    JSON.stringify(evm.body.unreadableChains),
  );
  const tslaOnBsc = evm.body.held.find(
    (h) => h.source.symbol === "TSLAon" && h.source.chain === "56",
  );
  check("found TSLAon on BNB Chain", Boolean(tslaOnBsc));
  check(
    "TSLAon sized in 18-decimal EVM units",
    tslaOnBsc?.source.decimals === 18,
  );
  const bscOnChain = await bscBalanceOf(BSC_TSLAON, BSC_HOLDER);
  check(
    "TSLAon balance agrees with a live eth_call balanceOf",
    tslaOnBsc?.balanceAtomic === bscOnChain,
    `trustware=${tslaOnBsc?.balanceAtomic ?? "absent"} chain=${bscOnChain}`,
  );
  // The same wallet holds TSLAB, NVDAB, QQQB and SPCXB, which are different
  // tokens with confusingly similar tickers. Address matching must exclude them.
  const lookalikes = evm.body.held.filter((h) =>
    /^(TSLAB|NVDAB|QQQB|SPCXB)$/.test(h.source.symbol),
  );
  check("lookalike B-tokens excluded", lookalikes.length === 0,
    lookalikes.map((l) => l.source.symbol).join(",") || "none");
  check(
    "every holding is a registry source",
    evm.body.held.every((h) => ["1", "56"].includes(h.source.chain)),
  );

  console.log(`\nB. Solana address holding Ondo TSLAon natively`);
  const sol = await balances({ solana: SOLANA_HOLDER });
  check("responds 200", sol.status === 200, `got ${sol.status}`);
  show(sol.body.held);
  const tslaOnSol = sol.body.held.find(
    (h) => h.source.symbol === "TSLAon" && h.source.kind === "solana",
  );
  check("found TSLAon on Solana", Boolean(tslaOnSol));
  check(
    "sized in 9-decimal Solana units, not 18",
    tslaOnSol?.source.decimals === 9,
  );
  const solOnChain = await solanaBalanceOf(SOLANA_TSLAON, SOLANA_HOLDER);
  check(
    "balance agrees with a live getTokenAccountsByOwner read",
    tslaOnSol?.balanceAtomic === solOnChain,
    `trustware=${tslaOnSol?.balanceAtomic ?? "absent"} chain=${solOnChain}`,
  );
  check(
    "no unreadable registry chains",
    sol.body.unreadableChains.length === 0,
    JSON.stringify(sol.body.unreadableChains),
  );
  // This mint comes back from Trustware with no symbol at all, so finding it
  // proves matching is on contract address rather than symbol.
  check(
    "matched a holding Trustware returned with no symbol",
    Boolean(tslaOnSol),
  );

  console.log(`\nC. Active wallet that holds none of our equivalents`);
  const none = await balances({ evm: NO_EQUIVALENTS });
  check("responds 200", none.status === 200, `got ${none.status}`);
  check("returns no holdings", none.body.held.length === 0,
    `${none.body.held.length}`);
  check(
    "reports no false failure",
    none.body.unreadableChains.length === 0,
    JSON.stringify(none.body.unreadableChains),
  );

  console.log(`\nD. Input validation`);
  const bad = await balances({ evm: "0xnot-an-address" });
  check("malformed address is rejected", bad.status === 400, `got ${bad.status}`);
  const empty = await fetch(`${ORIGIN}/api/trustware/balances`);
  check("missing both addresses is rejected", empty.status === 400,
    `got ${empty.status}`);
  const traversal = await balances({ evm: "../../routes/quote" });
  check("path traversal is rejected", traversal.status === 400,
    `got ${traversal.status}`);

  console.log(`\nE. Real balances feed the planner end to end`);
  const vault = vaultById(77)!; // TSLAx
  const quoteViaProxy = async (req: TrustwareQuoteRequest) => {
    const res = await fetch(`${ORIGIN}/api/trustware/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    const body = (await res.json()) as TrustwareQuoteResponse;
    if (!res.ok) throw new Error(body.error ?? `proxy ${res.status}`);
    return body;
  };
  const plan = await planCollateralDeposit({
    vault,
    requestedUi: "1",
    solanaAddress: SOLANA_HOLDER,
    evmAddress: BSC_HOLDER,
    // Deliberately zero: force the conversion path rather than direct deposit.
    solanaCollateralAtomic: "0",
    heldEquivalents: [...sol.body.held, ...evm.body.held],
    fetchQuote: quoteViaProxy,
  });
  console.log(`        kind=${plan.kind}`);
  console.log(`        ${describePlan(plan)}`);
  check("planner produced a conversion", plan.kind === "convert-then-deposit");
  if (plan.kind === "convert-then-deposit") {
    check(
      "preferred the Solana source (no bridge)",
      plan.source.kind === "solana",
      `picked ${plan.source.symbol} on ${plan.source.chainLabel}`,
    );
    check(
      "guaranteed minimum clears the shortfall",
      BigInt(plan.quote.toAmountMinAtomic) >= BigInt(plan.shortfallAtomic),
    );
    check(
      "sized within the real balance",
      BigInt(plan.sourceAmountAtomic) <=
        BigInt(
          [...sol.body.held, ...evm.body.held].find(
            (h) =>
              h.source.chain === plan.source.chain &&
              h.source.token === plan.source.token,
          )!.balanceAtomic,
        ),
    );
  }

  console.log(
    `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(
    `\nFAILED: ${err instanceof Error ? err.message : String(err)}` +
      `\nIs the dev server running at ${ORIGIN}?`,
  );
  process.exit(1);
});
