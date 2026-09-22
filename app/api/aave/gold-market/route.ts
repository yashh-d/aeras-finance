import { NextResponse } from "next/server";

import { AAVE_GOLD_MARKETS, BPS, WAD } from "@/lib/aave/gold-market";
import {
  borrowAprFromDrawnRate,
  borrowApyFromDrawnRate,
  liquidationBonusRange,
  oraclePriceToUsd,
} from "@/lib/aave/gold-math";
import { readAaveGoldMarket } from "@/lib/aave/gold-server";

export const dynamic = "force-dynamic";

// Live state for the Aave V4 Gold spoke, read from Ethereum rather than from
// Aave's indexer, for the reason the Morpho route gives: the position route
// prices health from on-chain reads, and serving the market from a different
// source invites the two to disagree on screen.
export interface AaveGoldMarketMetric {
  id: string;
  // The hub's annual drawn rate as a decimal, which is what pro.aave.com
  // prints, and the same rate compounded, which is this app's convention.
  // Both are the cost of the loan; supplying gold earns nothing.
  borrowApr: number;
  borrowApy: number;
  // Collateral factor as a decimal (0.75). In Aave V4 this is both the
  // borrowing limit and the liquidation threshold; there is no separate LTV.
  collateralFactor: number;
  // The reserve's latest dynamic config key. A user bound to an older key is
  // on older parameters until their next borrow or withdraw.
  dynamicConfigKey: number;
  // Debt asset available to borrow right now, atomic: the smaller of the
  // hub's free liquidity and this spoke's remaining draw cap.
  liquidityAtomic: string;
  hubLiquidityAtomic: string;
  // Null when uncapped.
  spokeDrawHeadroomAtomic: string | null;
  // Collateral that may still be supplied under the spoke's cap, atomic, and
  // the cap itself. Null when uncapped.
  supplyHeadroomAtomic: string | null;
  supplyCapAtomic: string | null;
  totalSuppliedAtomic: string;
  // Oracle prices in USD: one collateral token and one debt token. These are
  // what liquidations use, not a market feed.
  oracleUnitPrice: number;
  debtUnitPrice: number;
  oraclePriceRaw: string;
  debtPriceRaw: string;
  oracleDecimals: number;
  // Liquidation terms: the bonus band (bps), the fee taken from the bonus,
  // and the health the position is restored to when liquidated.
  minLiquidationBonusBps: number;
  maxLiquidationBonusBps: number;
  liquidationFeeBps: number;
  targetHealthFactor: number;
  // Reserve flags. A frozen collateral reserve refuses new supply; a paused
  // one refuses everything.
  collateralPaused: boolean;
  collateralFrozen: boolean;
  debtPaused: boolean;
  debtFrozen: boolean;
  debtBorrowable: boolean;
}

interface MetricsBody {
  metrics: AaveGoldMarketMetric[];
}

let cache: { fetchedAt: number; body: MetricsBody } | null = null;
const CACHE_TTL_MS = 30_000;
const STALE_GRACE_MS = 5 * 60_000;

async function fetchUpstream(): Promise<MetricsBody> {
  const metrics = await Promise.all(
    AAVE_GOLD_MARKETS.map(async (market): Promise<AaveGoldMarketMetric> => {
      const read = await readAaveGoldMarket(market);
      const headroom = read.spokeDrawHeadroomAtomic;
      const liquidity =
        headroom === null || headroom > read.hubLiquidityAtomic
          ? read.hubLiquidityAtomic
          : headroom;
      const band = liquidationBonusRange({
        maxLiquidationBonusBps: read.collateral.maxLiquidationBonusBps,
        liquidationBonusFactorBps: read.liquidationBonusFactorBps,
      });
      return {
        id: market.id,
        borrowApr: borrowAprFromDrawnRate(read.debtDrawnRateRay),
        borrowApy: borrowApyFromDrawnRate(read.debtDrawnRateRay),
        collateralFactor:
          Number(read.collateral.collateralFactorBps) / Number(BPS),
        dynamicConfigKey: read.collateral.dynamicConfigKey,
        liquidityAtomic: liquidity.toString(),
        hubLiquidityAtomic: read.hubLiquidityAtomic.toString(),
        spokeDrawHeadroomAtomic: headroom === null ? null : headroom.toString(),
        supplyHeadroomAtomic:
          read.supplyHeadroomAtomic === null
            ? null
            : read.supplyHeadroomAtomic.toString(),
        supplyCapAtomic:
          read.supplyCapAtomic === null ? null : read.supplyCapAtomic.toString(),
        totalSuppliedAtomic: read.totalSuppliedAtomic.toString(),
        oracleUnitPrice: oraclePriceToUsd(read.collateral.price),
        debtUnitPrice: oraclePriceToUsd(read.debt.price),
        oraclePriceRaw: read.collateral.price.toString(),
        debtPriceRaw: read.debt.price.toString(),
        oracleDecimals: read.oracleDecimals,
        minLiquidationBonusBps: band.minBps,
        maxLiquidationBonusBps: band.maxBps,
        liquidationFeeBps: Number(read.collateral.liquidationFeeBps),
        targetHealthFactor: Number(read.targetHealthFactorWad) / Number(WAD),
        collateralPaused: read.collateral.paused,
        collateralFrozen: read.collateral.frozen,
        debtPaused: read.debt.paused,
        debtFrozen: read.debt.frozen,
        debtBorrowable: read.debt.borrowable,
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
    // Stale-while-error, matching the Morpho gold route: an RPC blip should
    // not blank a card showing someone's collateralised position.
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[aave gold market] RPC failed, serving stale:", err);
      return NextResponse.json(cache.body);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
