import { NextResponse } from "next/server";

import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";
import {
  LendUpstreamError,
  fetchLendJson,
  lendCooldownMs,
} from "@/lib/jupiter/lend-server";

export const dynamic = "force-dynamic";

const ALLOWED_VAULT_IDS = new Set(XSTOCK_BORROW_VAULTS.map((v) => v.vaultId));

interface RawVault {
  id: number;
  oraclePrice?: string;
  borrowRate?: string;
  borrowable?: string;
}

let cache: { fetchedAt: number; vaults: RawVault[] } | null = null;
const CACHE_TTL_MS = 15_000;
// Stale-while-error: a cached payload keeps being served for this long past
// the TTL while upstream is failing. Thirty minutes, because Jupiter's Lend
// backend has been unreachable for longer than five (2026-09-09), and a rate
// that was right half an hour ago beats a blank card. The response says when
// it is stale (see GET) so a client can tell.
const STALE_GRACE_MS = 30 * 60 * 1000;

async function loadVaults(): Promise<{ vaults: RawVault[]; stale: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { vaults: cache.vaults, stale: false };
  }
  try {
    // One attempt with the API key, a circuit while the origin is down, and
    // no retry on a timeout. See lib/jupiter/lend-server.ts.
    const vaults = await fetchLendJson<RawVault[]>("/borrow/vaults");
    cache = { fetchedAt: Date.now(), vaults };
    return { vaults, stale: false };
  } catch (err) {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      if (!(err instanceof LendUpstreamError && err.circuitOpen)) {
        console.warn("[borrow vaults proxy] upstream failed, serving stale:", err);
      }
      return { vaults: cache.vaults, stale: true };
    }
    throw err;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get("vaultId");
  if (!idParam) {
    return NextResponse.json(
      { error: "vaultId is required" },
      { status: 400 },
    );
  }
  const vaultId = Number(idParam);
  if (!ALLOWED_VAULT_IDS.has(vaultId)) {
    return NextResponse.json(
      { error: "Unsupported vault for v1" },
      { status: 400 },
    );
  }

  try {
    const { vaults, stale } = await loadVaults();
    const match = vaults.find((v) => v.id === vaultId);
    if (!match) {
      return NextResponse.json(
        { error: `Vault ${vaultId} not found upstream` },
        { status: 404 },
      );
    }
    return NextResponse.json(match, {
      headers: stale ? { "x-aeras-stale": "1" } : undefined,
    });
  } catch (err) {
    // Nothing cached and upstream is down. 503 with a Retry-After matching
    // the circuit, so a client that reads it can wait rather than hammer.
    const msg = err instanceof Error ? err.message : String(err);
    const retry = Math.max(1, Math.ceil(lendCooldownMs("/borrow/vaults") / 1000));
    return NextResponse.json(
      { error: msg },
      { status: 503, headers: { "retry-after": String(retry) } },
    );
  }
}
