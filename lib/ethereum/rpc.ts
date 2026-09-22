// Server-only batched JSON-RPC reads against Ethereum.
//
// Kept to plain POSTs rather than a viem public client, matching
// app/api/morpho/position/route.ts: these are reads, and standing up an
// app-owned EVM provider is a bigger commitment than the job needs.
//
// The transport is lib/ethereum/json-rpc.ts, which retries a throttled batch
// and falls back to the public node when the paid one will not answer. This
// module only fixes the endpoints and keeps the shape the Ethereum readers
// were written against: one round trip per batch, responses matched back by
// id, and the "Ethereum RPC ..." wording their routes log.

import "server-only";

import type { Hex } from "viem";

import { ETHEREUM_PUBLIC_RPC_URL, ETHEREUM_RPC_URL } from "./constants";
import {
  jsonRpcBatch,
  jsonRpcBatchSettled,
  type RpcCall,
  type RpcEndpoints,
} from "./json-rpc";

export type { RpcCall } from "./json-rpc";

const ETHEREUM: RpcEndpoints = {
  label: "Ethereum",
  url: ETHEREUM_RPC_URL,
  // No second node when the primary already is the public one.
  fallbackUrl:
    ETHEREUM_RPC_URL === ETHEREUM_PUBLIC_RPC_URL ? undefined : ETHEREUM_PUBLIC_RPC_URL,
};

// One batched round trip. Public endpoints rate-limit per request rather than
// per payload, and a full position read is many calls, so batching is the
// difference between one request and a dozen. Every call must answer.
export async function rpcBatch(calls: RpcCall[]): Promise<Hex[]> {
  return (await jsonRpcBatch(ETHEREUM, calls)) as Hex[];
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
  const outcomes = await jsonRpcBatchSettled(ETHEREUM, calls);
  return outcomes.map((o) => {
    if (o.error || o.result == null || o.result === "0x") return null;
    return o.result as Hex;
  });
}
