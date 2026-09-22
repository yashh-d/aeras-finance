// Server-only reads against Base: the embedded EVM wallet's USDC and ETH.
//
// The exit from Mag7X lands USDC in the embedded wallet on Base, and the leg
// home through Trustware needs ETH there for gas (lib/trustware/base.ts).
// Both balances are read here, on the server, so the browser needs no Base
// RPC of its own and the CSP stays as it is. Same shape as lib/ethereum/rpc.ts
// and app/api/morpho/position: plain batched JSON-RPC, no viem client.
//
// BASE_RPC_URL is server-only and optional. Unset, it falls back to Base's
// public node, which is enough for two balance reads per exit.

import "server-only";

import { encodeFunctionData, erc20Abi, type Hex } from "viem";

import { BASE_USDC } from "@/lib/base/constants";

export const BASE_RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

async function rpcBatch(calls: { method: string; params: unknown[] }[]): Promise<Hex[]> {
  const res = await fetch(BASE_RPC_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i, ...c }))),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Base RPC ${res.status}`);
  const json = (await res.json()) as
    | { id: number; result?: Hex; error?: { message: string } }[]
    | { error?: { message: string } };
  if (!Array.isArray(json)) {
    throw new Error(json.error?.message ?? "Base RPC: unexpected response");
  }
  const byId = new Map(json.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const entry = byId.get(i);
    if (!entry) throw new Error(`Base RPC: no response for call ${i}`);
    if (entry.error) throw new Error(entry.error.message);
    if (!entry.result) throw new Error(`Base RPC: empty result for call ${i}`);
    return entry.result;
  });
}

export async function readBaseBalances(
  address: string,
): Promise<{ usdcAtomic: string; ethWei: string }> {
  const [eth, usdc] = await rpcBatch([
    { method: "eth_getBalance", params: [address, "latest"] },
    {
      method: "eth_call",
      params: [
        {
          to: BASE_USDC.address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address as `0x${string}`],
          }),
        },
        "latest",
      ],
    },
  ]);
  return { ethWei: BigInt(eth).toString(), usdcAtomic: BigInt(usdc).toString() };
}
