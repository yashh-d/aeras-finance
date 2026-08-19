import { RYSK_API_BASE_URL } from "./constants";
import type { RyskAssetsResponse, RyskInventoryResponse } from "./types";

// Server-side reads of the Rysk public endpoints.
//
// These must not be called from the browser. Rysk returns no
// Access-Control-Allow-Origin header on any GET, so a direct fetch from the page
// is blocked before it reaches them. Proxying is not a preference here, it is
// the only thing that works.
//
// Neither endpoint needs a key, which is why the whole option chain can be built
// and verified with no wallet connected and nothing provisioned on their side.

async function ryskGet<T>(path: string, baseUrl = RYSK_API_BASE_URL): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Rysk ${path} failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

// Tradeable tokens per chain, with decimals, trade size bounds and a spot price.
// Needed to resolve the bare addresses that inventory reports into symbols and
// decimals.
export async function ryskAssets(baseUrl?: string): Promise<RyskAssetsResponse> {
  const body = await ryskGet<RyskAssetsResponse>("/api/assets", baseUrl);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Rysk /api/assets returned no chain map");
  }
  return body;
}

// The strike ladder: every listed strike and expiry per underlying, with delta,
// an indicative APY and the collateral tuples each strike can be written
// against.
export async function ryskInventory(
  baseUrl?: string,
): Promise<RyskInventoryResponse> {
  const body = await ryskGet<RyskInventoryResponse>("/api/inventory", baseUrl);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Rysk /api/inventory returned no underlying map");
  }
  return body;
}
