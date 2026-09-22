// Server-only batched JSON-RPC reads for the four chains the pools live on.
//
// lib/ethereum/rpc.ts is the same shape for Ethereum alone; this maps a chain
// id to its endpoints (paid where the env names one, the public node as the
// fallback) and hands the batch to lib/ethereum/json-rpc.ts, which retries a
// throttle and falls back to the second node. Nothing here signs.

import "server-only";

import type { Hex } from "viem";

import { BASE_CHAIN_ID, BASE_PUBLIC_RPC_URL, BASE_RPC_URL } from "@/lib/base/constants";
import {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_PUBLIC_RPC_URL,
  ETHEREUM_RPC_URL,
} from "@/lib/ethereum/constants";
import {
  jsonRpcBatchSettled,
  type RpcCall,
  type RpcEndpoints,
  type RpcOutcome,
} from "@/lib/ethereum/json-rpc";
import { MONAD_CHAIN_ID, MONAD_PUBLIC_RPC_URL, MONAD_RPC_URL } from "@/lib/morpho/constants";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_PUBLIC_RPC_URL,
  ROBINHOOD_RPC_URL,
} from "@/lib/robinhood/constants";

import type { UniswapChainId } from "./constants";

export type { RpcCall, RpcOutcome } from "@/lib/ethereum/json-rpc";

function endpoints(label: string, url: string, publicUrl: string): RpcEndpoints {
  return { label, url, fallbackUrl: url === publicUrl ? undefined : publicUrl };
}

const ENDPOINTS: Readonly<Record<UniswapChainId, RpcEndpoints>> = {
  [ETHEREUM_CHAIN_ID]: endpoints("Ethereum", ETHEREUM_RPC_URL, ETHEREUM_PUBLIC_RPC_URL),
  [MONAD_CHAIN_ID]: endpoints("Monad", MONAD_RPC_URL, MONAD_PUBLIC_RPC_URL),
  [ROBINHOOD_CHAIN_ID]: endpoints("Robinhood Chain", ROBINHOOD_RPC_URL, ROBINHOOD_PUBLIC_RPC_URL),
  [BASE_CHAIN_ID]: endpoints("Base", BASE_RPC_URL, BASE_PUBLIC_RPC_URL),
};

export function chainRpcLabel(chainId: UniswapChainId): string {
  return ENDPOINTS[chainId].label;
}

// One batched round trip; each call settles on its own, so a revert (which
// is an answer for a probe) does not fail the batch.
export function uniswapRpcBatchSettled(
  chainId: UniswapChainId,
  calls: RpcCall[],
): Promise<RpcOutcome[]> {
  return jsonRpcBatchSettled(ENDPOINTS[chainId], calls);
}

// Strict variant: every call must answer with a hex result.
export async function uniswapRpcBatch(chainId: UniswapChainId, calls: RpcCall[]): Promise<Hex[]> {
  const outcomes = await uniswapRpcBatchSettled(chainId, calls);
  const label = ENDPOINTS[chainId].label;
  return outcomes.map((o, i) => {
    if (o.error) throw new Error(`${label} RPC call ${i} (${calls[i].method}): ${o.error}`);
    if (typeof o.result !== "string" || o.result === "0x") {
      throw new Error(`${label} RPC call ${i} (${calls[i].method}): empty result`);
    }
    return o.result as Hex;
  });
}

export function ethCall(to: string, data: Hex, from?: string): RpcCall {
  return { method: "eth_call", params: [from ? { from, to, data } : { to, data }, "latest"] };
}
