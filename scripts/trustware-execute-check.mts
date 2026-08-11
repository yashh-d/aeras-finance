// Slice 4c verification: the execution path's inputs and its three new proxies.
//
// This checks everything the conversion engine depends on that can be checked
// without spending money:
//
//   - the /allowance, /receipt and /status proxies reject malformed input before
//     it can reach the key-bearing upstream
//   - a real /route response actually carries the fields execute.ts reads
//   - the EVM transaction translation produces params a node would accept
//   - the allowance the proxy reports matches a direct read of the chain
//
//   pnpm dev
//   npx tsx scripts/trustware-execute-check.mts
//
// Signs nothing and broadcasts nothing. It builds routes for wallets we do not
// control, which is safe because a route is an unsigned transaction: without a
// signature it can never execute.

import { buildEvmTxParams, usableApprovals } from "../lib/trustware/evm-tx";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  toQuantity,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "../lib/trustware/types";

const ORIGIN = process.env.PROXY_ORIGIN ?? "http://localhost:3000";

// Same live holders as the 4b check, so a route can be built against an address
// that genuinely exists on chain.
const EVM_HOLDER = "0x9e229b12cc9081d6a510b29ccbd6311743e277ed";
const SOLANA_HOLDER = "HYyEoLDLMmL2wtKczx6JLNeUc7RqUnXGUUnPudwiAbN4";
const SOLANA_TSLAON = "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo";
const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const SOLANA_CHAIN = "solana-mainnet-beta";

// Ethereum is the EVM leg under test. BNB Chain would be the natural choice
// (that is where the holder's balance sits) but its Solana routes were under
// provider maintenance on 2026-08-05, so it is probed separately below as a
// report rather than as an assertion about our code.
const ETH_CHAIN = "1";
const ETH_TSLAON = "0xf6b1117ec07684d3958cad8beb1b302bfd21103f";
const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const BSC_CHAIN = "56";
const BSC_TSLAON = "0x2494b603319d4d9f9715c9f4496d9e0364b59d93";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function get(path: string) {
  const res = await fetch(`${ORIGIN}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function post(path: string, body: unknown, raw?: string) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ERC-20 allowance(owner,spender) via a public node. No key, and entirely
// independent of Trustware, so agreement means both are reading the same chain.
async function chainAllowance(token: string, owner: string, spender: string) {
  const arg = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
  const res = await fetch(ETH_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: token, data: `0xdd62ed3e${arg(owner)}${arg(spender)}` }, "latest"],
    }),
  });
  const body = (await res.json()) as { result?: string; error?: unknown };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return BigInt(body.result ?? "0x0").toString();
}

async function route(req: TrustwareQuoteRequest) {
  const res = await fetch(`${ORIGIN}/api/trustware/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  const body = (await res.json()) as TrustwareQuoteResponse;
  if (!res.ok) throw new Error(body.error ?? `route proxy ${res.status}`);
  return body;
}

async function main() {
  console.log("\nA. /allowance rejects malformed input before reaching upstream");
  const goodAllowance = {
    chainId: ETH_CHAIN,
    tokenAddress: ETH_TSLAON,
    ownerAddress: EVM_HOLDER,
    spenderAddress: EVM_HOLDER,
  };
  for (const [label, override] of [
    ["non-numeric chainId", { chainId: "ethereum" }],
    ["chainId with a path segment", { chainId: "1/../../admin" }],
    ["malformed token address", { tokenAddress: "0xnope" }],
    ["path traversal in owner", { ownerAddress: "../../../route-intent" }],
    ["empty spender", { spenderAddress: "" }],
  ] as const) {
    const qs = new URLSearchParams({ ...goodAllowance, ...override });
    const res = await get(`/api/trustware/allowance?${qs}`);
    check(`400 on ${label}`, res.status === 400, `got ${res.status}`);
  }
  const noParams = await get("/api/trustware/allowance");
  check("400 with no parameters at all", noParams.status === 400, `got ${noParams.status}`);

  console.log("\nB. /status rejects malformed intent ids and reports 404 cleanly");
  check(
    "400 when intentId is missing",
    (await get("/api/trustware/status")).status === 400,
  );
  for (const bad of ["../../admin", "short", "has spaces", "a".repeat(65)]) {
    const res = await get(`/api/trustware/status?intentId=${encodeURIComponent(bad)}`);
    check(`400 on malformed intentId "${bad.slice(0, 20)}"`, res.status === 400, `got ${res.status}`);
  }
  // Well-formed but nonexistent. Trustware answers 404, which the poller must
  // read as "not tracked yet" rather than as a failure.
  const unknown = await get(
    "/api/trustware/status?intentId=aaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee",
  );
  check("404 for a well-formed unknown intent", unknown.status === 404, `got ${unknown.status}`);

  console.log("\nC. /receipt rejects malformed input");
  const okReceipt = { intentId: "abcdefgh12345678", txHash: `0x${"a".repeat(64)}` };
  check(
    "400 on non-JSON body",
    (await post("/api/trustware/receipt", null, "not json")).status === 400,
  );
  check(
    "400 on missing intentId",
    (await post("/api/trustware/receipt", { txHash: okReceipt.txHash })).status === 400,
  );
  check(
    "400 on path traversal in intentId",
    (await post("/api/trustware/receipt", { ...okReceipt, intentId: "../../x" })).status === 400,
  );
  for (const bad of ["0xshort", "deadbeef", `0x${"a".repeat(63)}`, ""]) {
    const res = await post("/api/trustware/receipt", { ...okReceipt, txHash: bad });
    check(`400 on malformed txHash "${bad || "(empty)"}"`, res.status === 400, `got ${res.status}`);
  }
  // A well-formed pair reaches upstream. Trustware rejects an unknown intent,
  // which is the point: our validation is not what stopped it.
  const reached = await post("/api/trustware/receipt", okReceipt);
  check(
    "well-formed receipt passes validation and reaches upstream",
    reached.status !== 400,
    `got ${reached.status}: ${String(reached.body.error ?? "").slice(0, 80)}`,
  );
  // A Solana signature is base58, not hex. The regex has to accept both.
  const solHash = await post("/api/trustware/receipt", {
    ...okReceipt,
    txHash: "5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7",
  });
  check("base58 Solana signature passes validation", solHash.status !== 400, `got ${solHash.status}`);

  console.log("\nD. Live EVM route carries everything execute.ts reads");
  const evmRoute = await route({
    fromChain: ETH_CHAIN,
    toChain: SOLANA_CHAIN,
    fromToken: ETH_TSLAON,
    toToken: TSLAX_MINT,
    fromAmount: (10n ** 18n).toString(), // 1 TSLAon, 18 decimals on EVM
    fromAddress: EVM_HOLDER,
    toAddress: SOLANA_HOLDER,
    slippage: 1,
  });
  const evmIntent = extractIntentId(evmRoute);
  const evmExec = extractExecution(evmRoute);
  const evmTx = evmExec?.transaction;
  check("returned an intentId to track", Boolean(evmIntent), evmIntent ?? "absent");
  check("returned a signable transaction", Boolean(evmTx?.to && evmTx?.data));
  const estimate = extractEstimate(evmRoute);
  check(
    "estimate exposes a guaranteed minimum",
    Boolean(estimate?.toAmountMin ?? estimate?.toAmount),
    `toAmountMin=${estimate?.toAmountMin ?? "absent"} toAmount=${estimate?.toAmount ?? "absent"}`,
  );

  const approvals = usableApprovals(evmExec?.approvals);
  check("returned a usable ERC-20 approval", approvals.length > 0, `${approvals.length}`);
  if (approvals[0] && evmTx) {
    console.log(`        spender  ${approvals[0].spender}`);
    console.log(`        tx.to    ${evmTx.to}`);
    // Not an assertion about which is which, only that the code reads spender
    // from the approval. If these ever coincide, approving tx.to would still be
    // wrong for the next provider.
    check(
      "approval targets the route token, not the router",
      approvals[0].tokenAddress.toLowerCase() === ETH_TSLAON.toLowerCase(),
      approvals[0].tokenAddress,
    );
  }

  if (evmTx) {
    const params = buildEvmTxParams(evmTx, EVM_HOLDER);
    console.log(`        params   ${Object.keys(params).join(", ")}`);
    check(
      "every quantity is 0x-prefixed hex",
      Object.entries(params)
        .filter(([k]) => k !== "data" && k !== "to" && k !== "from")
        .every(([, v]) => /^0x[0-9a-f]+$/.test(v)),
      JSON.stringify(
        Object.fromEntries(Object.entries(params).filter(([k]) => k !== "data")),
      ),
    );
    check(
      "never sends both EIP-1559 and legacy gas pricing",
      !(params.maxFeePerGas && params.gasPrice),
    );
    check("from is the signer, not whatever upstream suggested", params.from === EVM_HOLDER);
    check("calldata is hex", /^0x[0-9a-fA-F]*$/.test(params.data));
  }

  console.log("\nE. Proxy allowance agrees with a direct chain read");
  if (approvals[0]) {
    const qs = new URLSearchParams({
      chainId: String(approvals[0].chainId ?? ETH_CHAIN),
      tokenAddress: approvals[0].tokenAddress,
      ownerAddress: EVM_HOLDER,
      spenderAddress: approvals[0].spender,
    });
    const res = await get(`/api/trustware/allowance?${qs}`);
    check("allowance read responds 200", res.status === 200, `got ${res.status}`);
    const reported = (res.body.data as { allowance?: string } | undefined)?.allowance;
    const onChain = await chainAllowance(approvals[0].tokenAddress, EVM_HOLDER, approvals[0].spender);
    check(
      "reported allowance matches eth_call",
      reported !== undefined && BigInt(reported) === BigInt(onChain),
      `proxy=${reported ?? "absent"} chain=${onChain}`,
    );
    // The engine's skip condition. Whichever way this lands, it must not throw.
    const needed = BigInt(approvals[0].amount);
    console.log(
      `        ${BigInt(onChain) >= needed ? "already approved" : "approval needed"}` +
        ` (have ${onChain}, need ${needed})`,
    );
  } else {
    check("allowance cross-check ran", false, "no approval to check");
  }

  console.log("\nF. Live Solana route is signable and needs no approval");
  const solRoute = await route({
    fromChain: SOLANA_CHAIN,
    toChain: SOLANA_CHAIN,
    fromToken: SOLANA_TSLAON,
    toToken: TSLAX_MINT,
    fromAmount: (10n ** 9n).toString(), // 1 TSLAon, 9 decimals on Solana
    fromAddress: SOLANA_HOLDER,
    toAddress: SOLANA_HOLDER,
    slippage: 1,
  });
  const solExec = extractExecution(solRoute);
  check("returned an intentId to track", Boolean(extractIntentId(solRoute)));
  const solData = solExec?.transaction?.data;
  check("returned transaction data", Boolean(solData));
  if (solData) {
    // The Solana branch hands transaction.data straight to the wallet as base64.
    let decoded: Buffer | null = null;
    try {
      decoded = Buffer.from(solData, "base64");
    } catch {
      decoded = null;
    }
    check(
      "transaction.data is base64, not 0x calldata",
      !solData.startsWith("0x") && Boolean(decoded && decoded.length > 32),
      `${solData.slice(0, 24)}... (${decoded?.length ?? 0} bytes)`,
    );
    check("base64 round-trips exactly", decoded?.toString("base64") === solData);
  }
  const solApprovals = solExec?.approvals ?? [];
  console.log(
    `        upstream returned ${solApprovals.length} approval(s); the Solana` +
      ` branch ignores them`,
  );

  console.log("\nG. Quantity normalization absorbs both encodings");
  check("hex passes through", toQuantity("0x1a") === "0x1a");
  check("decimal converts", toQuantity("26") === "0x1a");
  check("number converts", toQuantity(26) === "0x1a");
  check("zero is preserved, not dropped", toQuantity("0") === "0x0");
  check("undefined stays undefined", toQuantity(undefined) === undefined);
  check("empty string stays undefined", toQuantity("") === undefined);
  check(
    "no precision loss on a 256-bit value",
    toQuantity("115792089237316195423570985008687907853269984665640564039457584007913129639935") ===
      `0x${"f".repeat(64)}`,
  );
  check(
    "drops gasPrice when EIP-1559 fields are present",
    !buildEvmTxParams(
      { to: "0x1", data: "0x", gasPrice: "1000", maxFeePerGas: "2000", maxPriorityFeePerGas: "1" },
      EVM_HOLDER,
    ).gasPrice,
  );
  check(
    "keeps gasPrice when EIP-1559 fields are absent",
    buildEvmTxParams({ to: "0x1", data: "0x", gasPrice: "1000" }, EVM_HOLDER).gasPrice === "0x3e8",
  );
  check(
    "drops zero-amount approvals",
    usableApprovals([
      { chainId: 56, tokenAddress: "0xa", spender: "0xb", amount: "0" },
    ]).length === 0,
  );

  // Reported, not asserted. Upstream availability is not something our code
  // controls, but the planner has to survive it, so it is worth seeing.
  console.log("\nH. Upstream chain availability (report only)");
  for (const [label, chain, token, amount] of [
    ["Ethereum", ETH_CHAIN, ETH_TSLAON, (10n ** 18n).toString()],
    ["BNB Chain", BSC_CHAIN, BSC_TSLAON, (10n ** 18n).toString()],
    ["Solana", SOLANA_CHAIN, SOLANA_TSLAON, (10n ** 9n).toString()],
  ] as const) {
    try {
      const r = await route({
        fromChain: chain,
        toChain: SOLANA_CHAIN,
        fromToken: token,
        toToken: TSLAX_MINT,
        fromAmount: amount,
        fromAddress: chain === SOLANA_CHAIN ? SOLANA_HOLDER : EVM_HOLDER,
        toAddress: SOLANA_HOLDER,
        slippage: 1,
      });
      const provider = r.data?.route?.provider ?? r.route?.provider ?? "unknown";
      console.log(`        ${label.padEnd(10)} routable via ${provider}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reason = /maintenance/i.test(msg) ? "under maintenance" : msg.slice(0, 90);
      console.log(`        ${label.padEnd(10)} NOT routable: ${reason}`);
    }
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
