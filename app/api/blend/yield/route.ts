import { NextResponse } from "next/server";

import { BLEND_ACCOUNT_TYPE_ID, BLEND_API_BASE_URL } from "@/lib/blend/constants";

export const dynamic = "force-dynamic";

// Live yield for the `aeras-earn` account type, one row per vault it
// allocates to, from Blend's server API. This is the only Blend read the app
// makes without a signed-in user, and it is why the route exists: the
// frontend API answers 401 to every call, discovery and yield included, until
// the wallet has signed a SIWE message (verified 2026-09-14), and the Earn
// table has to draw a rate on the Blend column before anyone has signed
// anything. The server API needs only the API key, which stays here.
//
// The figures are Blend's, net of its performance fee (docs: "the APY shown
// already has it taken out"). Which of them the column shows is decided in
// the client against live numbers, so this route passes every rate through
// rather than picking one.
export interface BlendVaultYield {
  chainId: number;
  vaultAddress: string;
  // The vault's own rate as a decimal (0.05 = 5%).
  base: number | null;
  // Per-position rates inside the vault.
  positions: number[];
  // Blend's blended figure for the row, and the same with boosts counted.
  overall: number | null;
  boosted: number | null;
  // Fractions 0-1: how much of the row's capital sits in the vault, and how
  // much of that the vault has deployed.
  pctInVault: number | null;
  pctDeployed: number | null;
  heldAssets: { address: string; symbol: string; chainId: number }[];
}

export interface BlendYieldPayload {
  accountTypeId: string;
  vaults: BlendVaultYield[];
}

// The wire shape, per the server API reference and the SDK's YieldResponse.
interface RawYieldRow {
  chainId: number;
  vaultAddress: string;
  breakdown?: { base?: number | null; positions?: number[] | null };
  summary?: {
    theoreticalOverall?: number | null;
    theoreticalBoosted?: number | null;
    pctInVault?: number | null;
    pctDeployed?: number | null;
  };
  heldAssets?: { address: string; symbol: string; chainId: number }[];
}

const UPSTREAM_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 60_000;
// Long, as for the Lend proxies: a rate an hour old beats a blank column.
const STALE_GRACE_MS = 30 * 60 * 1000;

let cache: { fetchedAt: number; payload: BlendYieldPayload } | null = null;

function num(x: number | null | undefined): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

async function fetchUpstream(): Promise<BlendYieldPayload> {
  const key = process.env.BLEND_API_KEY;
  if (!key) throw new Error("BLEND_API_KEY is not set");
  const accountTypeId = process.env.BLEND_ACCOUNT_TYPE_ID ?? BLEND_ACCOUNT_TYPE_ID;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(
      `${BLEND_API_BASE_URL}/extern/svr/${encodeURIComponent(accountTypeId)}/yield`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: { "x-api-key": key, accept: "application/json" },
      },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // Blend's error envelope carries the reason, and one of them is an
    // operator action rather than an outage: a 404 "No vault config deployed
    // for this account type" means the strategy is still pending Provision
    // in the portal. Keep the sentence so the console says which.
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = `: ${body.message}`;
    } catch {
      // Not JSON; the status is the message.
    }
    throw new Error(`Blend yield: upstream ${res.status}${detail}`);
  }
  const json = (await res.json()) as {
    status?: string;
    data?: { accountTypeId?: string; yieldBreakdown?: RawYieldRow[] };
    message?: string;
  };
  if (json.status !== "success" || !json.data) {
    throw new Error(`Blend yield: ${json.message ?? "unexpected response"}`);
  }
  const rows = json.data.yieldBreakdown ?? [];
  return {
    accountTypeId: json.data.accountTypeId ?? accountTypeId,
    vaults: rows.map((r) => ({
      chainId: r.chainId,
      vaultAddress: r.vaultAddress,
      base: num(r.breakdown?.base),
      positions: (r.breakdown?.positions ?? []).filter(
        (p): p is number => typeof p === "number" && Number.isFinite(p),
      ),
      overall: num(r.summary?.theoreticalOverall),
      boosted: num(r.summary?.theoreticalBoosted),
      pctInVault: num(r.summary?.pctInVault),
      pctDeployed: num(r.summary?.pctDeployed),
      heldAssets: r.heldAssets ?? [],
    })),
  };
}

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }
  try {
    const payload = await fetchUpstream();
    cache = { fetchedAt: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (err) {
    // Stale-while-error, as the Lend proxies do: the last good payload is
    // served through an outage and marked so, rather than blanking the column.
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[blend yield] upstream failed, serving stale:", err);
      return NextResponse.json(cache.payload, {
        headers: { "x-aeras-stale": "1" },
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    // 503, not 502: nothing is cached, so there is nothing to serve. A
    // missing key lands here too, with its own sentence.
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
