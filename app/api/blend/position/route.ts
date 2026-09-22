import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { blendAccountByAddress, blendServerGet } from "@/lib/blend/server";

export const dynamic = "force-dynamic";

// A wallet's Aeras Vault I position: the account's balance across every chain
// the strategy holds on, from Blend's server API. Two reads: the account by
// EOA address (which is what the balance endpoint is keyed on), then its
// balance.
//
// The account lookup is the reason this route is gated on the client. Blend's
// `GET /account?address=` creates the account record when there is none, and
// there is no lookup-only variant, so calling it for every wallet that opens
// the Earn tab would give every Aeras user a Blend account whether or not
// they ever deposit. lib/blend/session.ts marks an address once it has signed
// in from this browser, and the table asks here only for marked addresses.
// Nothing here can enforce that, so do not point anything new at this route
// without the same gate.
export interface BlendChainPosition {
  chainId: number;
  vaultAddress: string;
  // The vault's underlying token, raw integer, with its decimals.
  underlyingAtomic: string;
  underlyingDecimals: number;
  usd: number | null;
}

export interface BlendPositionPayload {
  accountId: string;
  safeAddress: string;
  chainsDeployed: number[];
  perChain: BlendChainPosition[];
  // Every chain's underlying summed, rescaled to 6-decimal USDC atomic. The
  // strategy holds USDC vaults only, so the rescale is a no-op today and a
  // guard against a vault whose token is not.
  totalUsdcAtomic: string;
  totalUsd: number | null;
}

const CACHE_TTL_MS = 15_000;
const STALE_GRACE_MS = 5 * 60_000;

const cache = new Map<
  string,
  { fetchedAt: number; payload: BlendPositionPayload }
>();

// Blend reports fiat two ways: as a number, or as a fixed-point
// `{ value, decimals }`. Read either as a USD number.
function usd(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object" && "value" in value) {
    const fixed = value as { value?: string; decimals?: number };
    const n = Number(fixed.value);
    const d = typeof fixed.decimals === "number" ? fixed.decimals : 0;
    return Number.isFinite(n) ? n / 10 ** d : null;
  }
  return null;
}

function toUsdcAtomic(atomic: string, decimals: number): bigint {
  const raw = BigInt(atomic || "0");
  if (decimals === 6) return raw;
  return decimals > 6
    ? raw / 10n ** BigInt(decimals - 6)
    : raw * 10n ** BigInt(6 - decimals);
}

interface RawBalance {
  accountId: string;
  safeAddress: string;
  perChain?: {
    chainId: number;
    vaultAddress: string;
    total?: Record<string, unknown>;
    totalUnderlying?: string;
    totalUnderlyingDecimals?: number;
  }[];
  total?: Record<string, unknown>;
}

async function fetchUpstream(address: string): Promise<BlendPositionPayload> {
  const account = await blendAccountByAddress(address);
  const balance = await blendServerGet<RawBalance>(
    `/account/${encodeURIComponent(account.accountId)}/balance`,
  );

  const perChain: BlendChainPosition[] = (balance.perChain ?? []).map((c) => ({
    chainId: c.chainId,
    vaultAddress: c.vaultAddress,
    underlyingAtomic: c.totalUnderlying ?? "0",
    underlyingDecimals: c.totalUnderlyingDecimals ?? 6,
    usd: usd(c.total?.USD),
  }));
  const totalUsdcAtomic = perChain
    .reduce(
      (sum, c) => sum + toUsdcAtomic(c.underlyingAtomic, c.underlyingDecimals),
      0n,
    )
    .toString();

  return {
    accountId: account.accountId,
    safeAddress: account.safeAddress,
    chainsDeployed: account.chainsDeployed ?? [],
    perChain,
    totalUsdcAtomic,
    totalUsd: usd(balance.total?.USD),
  };
}

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
    return NextResponse.json(cached.payload);
  }
  try {
    const payload = await fetchUpstream(address);
    cache.set(cacheKey, { fetchedAt: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (err) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[blend position] upstream failed, serving stale:", err);
      return NextResponse.json(cached.payload, {
        headers: { "x-aeras-stale": "1" },
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
