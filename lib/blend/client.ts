"use client";

import type {
  BlendChainPosition,
  BlendPositionPayload,
} from "@/app/api/blend/position/route";
import type {
  BlendVaultYield,
  BlendYieldPayload,
} from "@/app/api/blend/yield/route";

// Browser-side readers for the Blend proxies. The API key never leaves the
// server; the browser only ever sees our own routes.

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Not JSON; the status is the message.
    }
    throw new Error(`Blend ${what} failed: ${detail}`);
  }
  return (await res.json()) as T;
}

export async function fetchBlendYield(): Promise<BlendYieldPayload> {
  const res = await fetch("/api/blend/yield", { cache: "no-store" });
  return readJson<BlendYieldPayload>(res, "yield");
}

// Only for an address known to have a Blend account (lib/blend/session.ts,
// hasBlendAccount): the route's lookup creates one otherwise.
export async function fetchBlendPosition(
  evmAddress: string,
): Promise<BlendPositionPayload> {
  const url = new URL("/api/blend/position", window.location.origin);
  url.searchParams.set("address", evmAddress);
  const res = await fetch(url.toString(), { cache: "no-store" });
  return readJson<BlendPositionPayload>(res, "position");
}

// USD per native unit for the chains a withdrawal signs on, from the app's
// native price route (Coingecko ids). Best effort: an empty map leaves the
// review's gas figures in native units only.
export async function fetchNativeUsd(): Promise<{ ethereum?: number; monad?: number }> {
  try {
    const res = await fetch("/api/prices/native", { cache: "no-store" });
    if (!res.ok) return {};
    const body = (await res.json()) as Record<string, unknown>;
    const map = (typeof body.prices === "object" && body.prices ? body.prices : body) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    return { ethereum: num(map.ethereum), monad: num(map.monad) };
  } catch {
    return {};
  }
}

export type {
  BlendChainPosition,
  BlendPositionPayload,
  BlendVaultYield,
  BlendYieldPayload,
};
