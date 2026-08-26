import { NextResponse } from "next/server";
import {
  decodeFunctionResult,
  encodeFunctionData,
  isAddress,
  type Hex,
} from "viem";

import { MONAD_RPC_URL, MONAD_USDC } from "@/lib/morpho/constants";
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

// One JSON-RPC request against Monad RPC. Kept to a plain POST rather than a
// viem public client so this stays a read, not an app-owned EVM provider.
async function rpc(method: string, params: unknown[]): Promise<Hex> {
  const res = await fetch(MONAD_RPC_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
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

function ethCall(to: string, data: Hex): Promise<Hex> {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

// Per-address cache with stale-while-error, matching the metrics route. Three
// pollers read this route (the earn card, the wallet panel, and a funding
// flow's arrival loop), and the default public Monad RPC rate-limits under
// that load (observed 502s, 2026-08-26). The TTL is short so an arrival poll
// still sees a fresh balance quickly; the grace keeps the panel alive through
// an RPC blip instead of blanking it.
interface PositionBody {
  positions: MorphoPosition[];
  usdcBalanceAtomic: string;
  monBalanceAtomic: string;
}
const cache = new Map<string, { fetchedAt: number; body: PositionBody }>();
const CACHE_TTL_MS = 5_000;
const STALE_GRACE_MS = 5 * 60_000;

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: "a valid EVM address is required" },
      { status: 400 },
    );
  }
  const cacheKey = address.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.body);
  }

  try {
    // The wallet's spendable USDC on Monad — the deposit ceiling the form needs.
    const usdcBalanceHex = await ethCall(
      MONAD_USDC.address,
      encodeFunctionData({
        abi: ABI,
        functionName: "balanceOf",
        args: [address],
      }),
    );
    const usdcBalanceAtomic = decodeFunctionResult({
      abi: ABI,
      functionName: "balanceOf",
      data: usdcBalanceHex,
    }).toString();

    // Native MON, 18-decimal atomic. Every Monad transaction needs it for gas,
    // and a freshly funded wallet holds none, so the deposit planner reads this
    // to decide whether to add a gas top-up leg (lib/morpho/fund.ts).
    const monBalanceAtomic = BigInt(
      await rpc("eth_getBalance", [address, "latest"]),
    ).toString();

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
    const body: PositionBody = { positions, usdcBalanceAtomic, monBalanceAtomic };
    cache.set(cacheKey, { fetchedAt: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[morpho position] RPC failed, serving stale:", err);
      return NextResponse.json(cached.body);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
