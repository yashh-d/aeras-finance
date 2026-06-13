import { NextResponse } from "next/server";

import { XSTOCK_BORROW_VAULTS } from "@/lib/jupiter/borrow";

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
// Upstream Jupiter goes through transient blips (network, rate-limit, CF). When
// we already have a cached payload, keep serving it for up to STALE_GRACE_MS
// past the TTL while we keep trying to refresh.
const STALE_GRACE_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 6000;
const UPSTREAM_RETRIES = 2;

async function fetchUpstream(): Promise<RawVault[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= UPSTREAM_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      UPSTREAM_TIMEOUT_MS,
    );
    try {
      const res = await fetch("https://api.jup.ag/lend/v1/borrow/vaults", {
        cache: "no-store",
        signal: controller.signal,
        headers: { "user-agent": "aeras-finance/0.1" },
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`upstream ${res.status}`);
      }
      return (await res.json()) as RawVault[];
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      // 100, 250 ms backoff before retrying.
      if (attempt < UPSTREAM_RETRIES) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1) ** 2));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Jupiter borrow vaults: ${String(lastErr)}`);
}

async function loadVaults(): Promise<RawVault[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.vaults;
  }
  try {
    const vaults = await fetchUpstream();
    cache = { fetchedAt: Date.now(), vaults };
    return vaults;
  } catch (err) {
    // Stale-while-error: serve previously-cached vaults rather than 502ing
    // the UI for transient upstream blips.
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[borrow vaults proxy] upstream failed, serving stale:", err);
      return cache.vaults;
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
    const vaults = await loadVaults();
    const match = vaults.find((v) => v.id === vaultId);
    if (!match) {
      return NextResponse.json(
        { error: `Vault ${vaultId} not found upstream` },
        { status: 404 },
      );
    }
    return NextResponse.json(match);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
