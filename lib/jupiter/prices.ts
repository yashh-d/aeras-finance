export interface JupiterPriceEntry {
  usdPrice: number;
  priceChange24h: number;
  liquidity: number;
  decimals: number;
  blockId?: number;
  stockData?: {
    id: string;
    price: number;
    mcap: number;
    updatedAt: string;
  };
}

export type JupiterPriceMap = Record<string, JupiterPriceEntry>;

// This module stays free of any server-only import: twenty-odd client
// components type-import JupiterPriceMap from here. The upstream call lives in
// ./price-server.ts, which reads JUPITER_API_KEY and is imported only by the
// route handler.

export interface JupiterPricesResult {
  prices: JupiterPriceMap;
  // True when the server served a cached payload because Jupiter was failing.
  // Surfaced so a panel can mark a figure as stale instead of showing it as
  // live, which matters most for the ticket: a price that stopped updating
  // three minutes ago should not look like one that updated a second ago.
  stale: boolean;
}

export async function fetchJupiterPricesViaProxy(): Promise<JupiterPricesResult> {
  const res = await fetch("/api/jupiter/prices", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Price proxy failed: ${res.status}`);
  }
  return {
    prices: (await res.json()) as JupiterPriceMap,
    stale: res.headers.get("x-aeras-stale") === "1",
  };
}
