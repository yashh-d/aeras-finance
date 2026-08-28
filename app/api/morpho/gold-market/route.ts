import { NextResponse } from "next/server";

import { GOLD_MARKETS, WAD } from "@/lib/morpho/gold-market";
import { borrowApyFromRate, oraclePriceToUnitPrice } from "@/lib/morpho/gold-math";
import { readGoldMarket } from "@/lib/morpho/gold-server";

export const dynamic = "force-dynamic";

// Live state for the curated Morpho Blue gold markets, read from Ethereum
// rather than from Morpho's indexer.
//
// The indexer would be less code, and the Monad earn route uses it. This one
// does not, for a specific reason: the position route has to read the market
// totals on-chain anyway to convert borrow shares into debt, and serving rates
// from one source while pricing debt from another invites the two to disagree
// on screen. One source, read once, priced the same way the contract prices it.
export interface GoldMarketMetric {
  id: string;
  // Compounded annual borrow rate, decimal (0.0463 = 4.63%). This is the cost
  // of the loan, and the only rate a borrower pays.
  borrowApy: number;
  // What USDT suppliers earn. Surfaced only so the market's economics are
  // legible; supplying gold as collateral earns nothing at all.
  supplyApy: number;
  // Fraction of supplied USDT currently lent out.
  utilization: number;
  // USDT still available to borrow, 6-decimal atomic. A borrow above this
  // reverts, however healthy the position would be.
  liquidityAtomic: string;
  totalSupplyAtomic: string;
  totalBorrowAtomic: string;
  // Oracle price of one collateral token in loan tokens (one XAUt in USDT).
  // This is the market's own oracle, which is what liquidations use, not a
  // market data feed.
  oracleUnitPrice: number;
  // Raw oracle output, ORACLE_PRICE_SCALE-scaled, for exact client-side math.
  oraclePriceRaw: string;
  // Liquidation LTV as a decimal (0.77 = 77%).
  lltv: number;
}

interface MetricsBody {
  metrics: GoldMarketMetric[];
}

let cache: { fetchedAt: number; body: MetricsBody } | null = null;
const CACHE_TTL_MS = 30_000;
const STALE_GRACE_MS = 5 * 60_000;

async function fetchUpstream(): Promise<MetricsBody> {
  const metrics = await Promise.all(
    GOLD_MARKETS.map(async (market): Promise<GoldMarketMetric> => {
      const read = await readGoldMarket(market);
      const { state } = read;

      const utilization =
        state.totalSupplyAssets > 0n
          ? Number(state.totalBorrowAssets) / Number(state.totalSupplyAssets)
          : 0;
      const borrowApy = borrowApyFromRate(read.borrowRatePerSecond);
      // Morpho pays suppliers the borrow interest scaled by utilization, less
      // the protocol fee. There is no separate supply rate to read.
      const feeFraction = Number(state.fee) / Number(WAD);
      const supplyApy = borrowApy * utilization * (1 - feeFraction);

      const liquidity =
        state.totalSupplyAssets > state.totalBorrowAssets
          ? state.totalSupplyAssets - state.totalBorrowAssets
          : 0n;

      return {
        id: market.id,
        borrowApy,
        supplyApy,
        utilization,
        liquidityAtomic: liquidity.toString(),
        totalSupplyAtomic: state.totalSupplyAssets.toString(),
        totalBorrowAtomic: state.totalBorrowAssets.toString(),
        oracleUnitPrice: oraclePriceToUnitPrice(
          read.oraclePrice,
          market.collateralToken.decimals,
          market.loanToken.decimals,
        ),
        oraclePriceRaw: read.oraclePrice.toString(),
        lltv: Number(market.lltv) / Number(WAD),
      };
    }),
  );
  return { metrics };
}

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.body);
  }
  try {
    const body = await fetchUpstream();
    cache = { fetchedAt: Date.now(), body };
    return NextResponse.json(body);
  } catch (err) {
    // Stale-while-error, matching the Monad metrics route: an RPC blip should
    // not blank a card showing someone's collateralised position.
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[gold market] RPC failed, serving stale:", err);
      return NextResponse.json(cache.body);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
