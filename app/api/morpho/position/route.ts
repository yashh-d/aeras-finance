import { NextResponse } from "next/server";
import {
  decodeFunctionResult,
  encodeFunctionData,
  isAddress,
  type Hex,
} from "viem";

import { MONAD_RPC_URL } from "@/lib/morpho/constants";
import { MONAD_USDC_VAULTS } from "@/lib/morpho/vaults";

export const dynamic = "force-dynamic";

// A user's position in each curated Monad vault: how many shares they hold and
// what those shares are currently worth in USDC. Shares are 18-decimal, the
// USDC value is 6-decimal atomic. Both are strings, since they are BigInts.
export interface MorphoPosition {
  address: string;
  sharesAtomic: string;
  // convertToAssets(shares): the USDC the shares redeem for right now, ignoring
  // vault liquidity. 6-decimal atomic.
  assetsAtomic: string;
}

// Minimal ERC-4626 ABI: just the two views we read.
const ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// One eth_call against Monad RPC. Kept to a plain JSON-RPC POST rather than a
// viem public client so this stays a read, not an app-owned EVM provider.
async function ethCall(to: string, data: Hex): Promise<Hex> {
  const res = await fetch(MONAD_RPC_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  if (!res.ok) throw new Error(`Monad RPC ${res.status}`);
  const json = (await res.json()) as {
    result?: Hex;
    error?: { message: string };
  };
  if (json.error) throw new Error(json.error.message);
  if (!json.result) throw new Error("Monad RPC: empty result");
  return json.result;
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: "a valid EVM address is required" },
      { status: 400 },
    );
  }

  try {
    const positions = await Promise.all(
      MONAD_USDC_VAULTS.map(async (v): Promise<MorphoPosition> => {
        const sharesHex = await ethCall(
          v.address,
          encodeFunctionData({
            abi: ABI,
            functionName: "balanceOf",
            args: [address],
          }),
        );
        const shares = decodeFunctionResult({
          abi: ABI,
          functionName: "balanceOf",
          data: sharesHex,
        });
        // No shares means no position; skip the second call.
        if (shares === 0n) {
          return { address: v.address, sharesAtomic: "0", assetsAtomic: "0" };
        }
        const assetsHex = await ethCall(
          v.address,
          encodeFunctionData({
            abi: ABI,
            functionName: "convertToAssets",
            args: [shares],
          }),
        );
        const assets = decodeFunctionResult({
          abi: ABI,
          functionName: "convertToAssets",
          data: assetsHex,
        });
        return {
          address: v.address,
          sharesAtomic: shares.toString(),
          assetsAtomic: assets.toString(),
        };
      }),
    );
    return NextResponse.json({ positions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
