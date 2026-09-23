import { NextResponse } from "next/server";

import { KAMINO_XSTOCKS_MARKET } from "@/lib/kamino/reserves";

export const dynamic = "force-dynamic";

// Per-reserve rate and size metrics for the xStocks Market. Proxied to keep the
// browser off Kamino directly (stable User-Agent, no CORS) and to trim the
// payload to the fields the markets catalog needs.
const DATA_BASE = "https://api.kamino.finance/kamino-market";
const UPSTREAM_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30_000;

export interface KaminoReserveMetric {
  reserve: string;
  liquidityTokenMint: string;
  // Max borrow LTV, kept as the decimal STRING Kamino publishes ("0.6") rather
  // than a number. It sizes borrows, so it goes into lib/borrow/limit.ts as an
  // exact scaled integer, and parsing it through a float on the way there is
  // the round trip that module exists to avoid.
  //
  // This is the live value. lib/kamino/reserves.ts carries a snapshot of the
  // same figure taken on 2026-07-29, whose own comment says not to trust it for
  // math; it was being trusted for math anyway until this was plumbed through.
  maxLtv: string;
  // Annualised rates, decimal (0.05 = 5%).
  borrowApy: number;
  supplyApy: number;
  // USD figures for the reserve's total supply and borrow.
  totalSupplyUsd: number;
  totalBorrowUsd: number;
}

interface RawMetric {
  reserve?: string;
  liquidityTokenMint?: string;
  maxLtv?: string;
  borrowApy?: string;
  supplyApy?: string;
  totalSupplyUsd?: string;
  totalBorrowUsd?: string;
}

let cache: { at: number; data: KaminoReserveMetric[] } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ reserves: cache.data });
  }

  const url = `${DATA_BASE}/${KAMINO_XSTOCKS_MARKET}/reserves/metrics`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "aeras-finance/0.1" },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      // Serve stale on a transient upstream blip rather than blanking the UI.
      if (cache) return NextResponse.json({ reserves: cache.data });
      return NextResponse.json(
        { error: `Kamino metrics failed: ${res.status}` },
        { status: 502 },
      );
    }
    const raw = (await res.json()) as RawMetric[];
    const data: KaminoReserveMetric[] = (Array.isArray(raw) ? raw : [])
      .filter((r) => r.reserve && r.liquidityTokenMint)
      .map((r) => ({
        reserve: r.reserve as string,
        liquidityTokenMint: r.liquidityTokenMint as string,
        // "0" is Kamino's own value for a reserve that cannot be used as
        // collateral (USDG is one), and is the right answer, not a fallback.
        maxLtv: r.maxLtv ?? "0",
        borrowApy: Number(r.borrowApy ?? 0),
        supplyApy: Number(r.supplyApy ?? 0),
        totalSupplyUsd: Number(r.totalSupplyUsd ?? 0),
        totalBorrowUsd: Number(r.totalBorrowUsd ?? 0),
      }));
    cache = { at: Date.now(), data };
    return NextResponse.json({ reserves: data });
  } catch (err) {
    clearTimeout(timeout);
    if (cache) return NextResponse.json({ reserves: cache.data });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
