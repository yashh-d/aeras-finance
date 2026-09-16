import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { readAaveWallet, type AaveWalletRead } from "@/lib/aave/server";

export const dynamic = "force-dynamic";

// A wallet's Aave positions, cooldown state, pending rewards and the Ethereum
// balances the forms need. Short per-address cache with stale-while-error: a
// funding flow's arrival loop polls this and must see a fresh balance quickly,
// while an RPC blip should not blank the panel.
const cache = new Map<string, { fetchedAt: number; body: AaveWalletRead }>();
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
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.body);
  }
  try {
    const body = await readAaveWallet(address);
    cache.set(key, { fetchedAt: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[aave position] read failed, serving stale:", err);
      return NextResponse.json(cached.body);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export type { AavePosition, AavePendingReward, AaveWalletRead } from "@/lib/aave/server";
