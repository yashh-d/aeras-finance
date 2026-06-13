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

const PRICE_V3_BASE = "https://lite-api.jup.ag/price/v3";

export async function fetchJupiterPricesDirect(
  mints: readonly string[],
): Promise<JupiterPriceMap> {
  if (mints.length === 0) return {};
  const url = `${PRICE_V3_BASE}?ids=${mints.join(",")}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Jupiter prices failed: ${res.status}`);
  }
  return (await res.json()) as JupiterPriceMap;
}

export async function fetchJupiterPricesViaProxy(): Promise<JupiterPriceMap> {
  const res = await fetch("/api/jupiter/prices", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Price proxy failed: ${res.status}`);
  }
  return (await res.json()) as JupiterPriceMap;
}
