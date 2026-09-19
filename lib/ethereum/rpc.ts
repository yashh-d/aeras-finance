// Server-only batched JSON-RPC reads against Ethereum.
//
// Kept to plain POSTs rather than a viem public client, matching
// app/api/morpho/position/route.ts: these are reads, and standing up an
// app-owned EVM provider is a bigger commitment than the job needs.
//
// Extracted from lib/morpho/gold-server.ts when the Aave venue needed the same
// thing. Behaviour is unchanged: one round trip per batch, responses matched
// back by id because a batch is not required to come back in request order.

import "server-only";

import type { Hex } from "viem";

import { ETHEREUM_RPC_URL } from "./constants";

export interface RpcCall {
  method: string;
  params: unknown[];
}

// One batched JSON-RPC round trip. Public endpoints rate-limit per request
// rather than per payload, and a full position read is many calls, so batching
// is the difference between one request and a dozen.
export async function rpcBatch(calls: RpcCall[]): Promise<Hex[]> {
  const res = await fetch(ETHEREUM_RPC_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      calls.map((c, i) => ({ jsonrpc: "2.0", id: i, ...c })),
    ),
  });
  if (!res.ok) throw new Error(`Ethereum RPC ${res.status}`);
  const json = (await res.json()) as
    | { id: number; result?: Hex; error?: { message: string } }[]
    | { error?: { message: string } };
  if (!Array.isArray(json)) {
    throw new Error(json.error?.message ?? "Ethereum RPC: unexpected response");
  }
  const byId = new Map(json.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const entry = byId.get(i);
    if (!entry) throw new Error(`Ethereum RPC: no response for call ${i}`);
    if (entry.error) throw new Error(entry.error.message);
    if (!entry.result) throw new Error(`Ethereum RPC: empty result for call ${i}`);
    return entry.result;
  });
}

export function ethCall(to: string, data: Hex): RpcCall {
  return { method: "eth_call", params: [{ to, data }, "latest"] };
}

// Current gas price, wei. The Ethereum funding planners size their ETH top-up
// from this rather than from a constant, because Ethereum gas moves by an order
// of magnitude within a week and a hardcoded top-up would be either wasteful or
// useless depending on when it was written.
export async function readGasPrice(): Promise<bigint> {
  const [hex] = await rpcBatch([{ method: "eth_gasPrice", params: [] }]);
  return BigInt(hex);
}

// Same round trip, but a call that reverts comes back as null instead of
// failing the batch. For probes whose revert IS the answer: asking a reward
// token for UNDERLYING_ASSET_ADDRESS() tells you whether it is an aToken, and
// a non-aToken says so by reverting.
export async function rpcBatchSettled(
  calls: RpcCall[],
): Promise<(Hex | null)[]> {
  const res = await fetch(ETHEREUM_RPC_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      calls.map((c, i) => ({ jsonrpc: "2.0", id: i, ...c })),
    ),
  });
  if (!res.ok) throw new Error(`Ethereum RPC ${res.status}`);
  const json = (await res.json()) as
    | { id: number; result?: Hex; error?: { message: string } }[]
    | { error?: { message: string } };
  if (!Array.isArray(json)) {
    throw new Error(json.error?.message ?? "Ethereum RPC: unexpected response");
  }
  const byId = new Map(json.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const entry = byId.get(i);
    if (!entry || entry.error || !entry.result || entry.result === "0x") {
      return null;
    }
    return entry.result;
  });
}
