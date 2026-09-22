// Simulate a full Aeras Vault I (Blend) withdrawal for one wallet, as the
// owner would send it, without signing anything.
//
//   set -a; . ./.env.local; set +a; npx tsx scripts/blend-withdraw-sim.mts 0x<embedded EVM address>
//
// Needs BLEND_API_KEY. What it does, in order: looks the account up by EOA
// (a lookup for an address that has signed in; it creates nothing), opens a
// withdrawal session on the server API and quotes everything to Monad, prints
// the per-chain payload Blend built (the steps, where the bridge delivers,
// the fees), assembles each chain's steps the way lib/blend/safe.ts does (a
// MultiSend batch inside an owner-sent `execTransaction`), asks each chain
// to estimate its gas from the owner's address, and cancels the session.
//
// The estimate is the proof: a Safe that refused an owner transaction, a
// guard that blocked a delegatecall, or a step that reverts would all show
// up here as a revert reason rather than a gas figure. Written 2026-09-22
// when withdrawals moved from paymaster-sponsored UserOperations to owner-paid
// transactions; see docs/blend.md.

import { decodeFunctionResult, type Hex } from "viem";

import { BLEND_ACCOUNT_TYPE_ID, BLEND_API_BASE_URL, BLEND_APP_CHAIN_ID, blendChainName } from "../lib/blend/constants";
import { SAFE_ABI, encodeOwnerBatch, type SafeCall } from "../lib/blend/safe";

const eoaArg = process.argv[2];
if (!eoaArg || !/^0x[0-9a-fA-F]{40}$/.test(eoaArg)) {
  console.error("usage: blend-withdraw-sim.mts 0x<embedded EVM address>");
  process.exit(2);
}
const eoa = eoaArg as Hex;
const key = process.env.BLEND_API_KEY;
if (!key) throw new Error("BLEND_API_KEY is not set");
const accountType = process.env.BLEND_ACCOUNT_TYPE_ID ?? BLEND_ACCOUNT_TYPE_ID;

const RPC: Record<number, string> = {
  1: process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
  143: process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz",
  8453: process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com",
};

async function svr<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BLEND_API_BASE_URL}/extern/svr/${accountType}${path}`, {
    method,
    headers: { "x-api-key": key!, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as { status?: string; data?: T; message?: string } | null;
  if (!res.ok || json?.status !== "success" || json.data === undefined) {
    throw new Error(`${method} ${path}: ${res.status} ${json?.message ?? ""}`);
  }
  return json.data;
}

async function rpc(chainId: number, method: string, params: unknown[]): Promise<Hex> {
  const res = await fetch(RPC[chainId], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: Hex; error?: { message: string; data?: string } };
  if (json.error) throw new Error(`${json.error.message}${json.error.data ? ` ${json.error.data.slice(0, 200)}` : ""}`);
  if (json.result === undefined) throw new Error(`${method}: empty result`);
  return json.result;
}

interface Step { kind: string; description?: string; to: string; data: string; value?: string; delegateCall?: boolean }
interface Payload { chainId: number; vaultAddress: string; amount: string; timeEstimate: number; fees: { totalUsd?: string } | null; steps: Step[] }
interface Calldata { safeAddress: string; destinationChainId: number; totalAmount: string; timeEstimate: number; totalFeesUsd: string; payloads: Payload[] }

async function main() {
  const account = await svr<{ accountId: string; safeAddress: string; chainsDeployed: number[] }>("GET", `/account?address=${eoa}`);
  const safe = account.safeAddress as Hex;
  console.log(`eoa      ${eoa}`);
  console.log(`account  ${account.accountId}`);
  console.log(`safe     ${safe} deployed on ${JSON.stringify(account.chainsDeployed)}`);
  console.log();

  const base = `/account/${account.accountId}`;
  const session = await svr<{ intentId: string; status: string }>("POST", `${base}/intent/session`, { forceReset: true });
  console.log(`session  ${session.intentId} (${session.status})`);
  try {
    await svr("POST", `${base}/intent/${session.intentId}/quote/withdraw`, {
      destinationChainId: BLEND_APP_CHAIN_ID,
      amount: "0",
      isMaxWithdraw: true,
    });
    const full = await svr<{ payload: Calldata | null; quoteSummary: unknown }>("GET", `${base}/intent/${session.intentId}`);
    const payload = full.payload;
    if (!payload) throw new Error("session carries no payload");
    console.log(`quote    total ${payload.totalAmount} USDC atomic to ${blendChainName(payload.destinationChainId)}, fees $${payload.totalFeesUsd}, up to ${payload.timeEstimate}s`);
    console.log();

    for (const p of payload.payloads) {
      console.log(`== ${blendChainName(p.chainId)} (${p.chainId}): ${p.amount} atomic from vault ${p.vaultAddress}, fees ${p.fees?.totalUsd ?? "0"}, ${p.timeEstimate}s`);
      const calls: SafeCall[] = [];
      for (const s of p.steps) {
        const mentionsEoa = s.data.toLowerCase().includes(eoa.slice(2).toLowerCase());
        const mentionsSafe = s.data.toLowerCase().includes(safe.slice(2).toLowerCase());
        console.log(`   ${s.kind.padEnd(14)} to=${s.to} sel=${s.data.slice(0, 10)} value=${s.value ?? "0"} delegate=${s.delegateCall ?? false}${mentionsEoa ? "  [names the EOA]" : ""}${mentionsSafe ? "  [names the Safe]" : ""}`);
        if (s.description) console.log(`   ${"".padEnd(14)} ${s.description}`);
        calls.push({ to: s.to as Hex, value: BigInt(s.value ?? "0"), data: s.data as Hex, operation: s.delegateCall ? 1 : 0 });
      }
      const data = encodeOwnerBatch(eoa, calls);
      try {
        const out = await rpc(p.chainId, "eth_call", [{ from: eoa, to: safe, data }, "latest"]);
        const ok = decodeFunctionResult({ abi: SAFE_ABI, functionName: "execTransaction", data: out });
        const gas = await rpc(p.chainId, "eth_estimateGas", [{ from: eoa, to: safe, data }]);
        const price = await rpc(p.chainId, "eth_gasPrice", []);
        const bal = await rpc(p.chainId, "eth_getBalance", [eoa, "latest"]);
        const costWei = BigInt(gas) * BigInt(price);
        console.log(`   simulate: ${ok ? "OK" : "returned false"}; gas ${BigInt(gas)} at ${Number(BigInt(price)) / 1e9} gwei = ${Number(costWei) / 1e18} native; owner holds ${Number(BigInt(bal)) / 1e18}${BigInt(bal) < costWei ? "  !! short of gas" : ""}`);
      } catch (err) {
        console.log(`   simulate: REVERT ${(err as Error).message}`);
        console.log("   (the public Monad node answers debug_traceCall; a callTracer trace of this call shows the failing frame)");
      }
      console.log();
    }
  } finally {
    await svr("POST", `${base}/intent/${session.intentId}/cancel`).then(
      () => console.log("session cancelled"),
      (err) => console.log(`session cancel failed: ${(err as Error).message}`),
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
