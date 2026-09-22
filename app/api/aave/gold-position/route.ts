import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { AAVE_GOLD_MARKETS, BPS, WAD } from "@/lib/aave/gold-market";
import { priceAaveGoldPosition } from "@/lib/aave/gold-math";
import {
  readAaveGoldMarket,
  readAaveGoldWallet,
  readGasPrice,
  readOtherReserves,
} from "@/lib/aave/gold-server";

export const dynamic = "force-dynamic";

// A borrower's position in the Aave V4 Gold spoke, plus the Ethereum wallet
// state the forms need to size a transaction.
//
// Health comes from the contract itself (`getUserAccountData`), computed
// against the hub's live index, so there is no accrual step. Headroom, the
// withdrawable collateral and the liquidation price are solved in
// lib/aave/gold-math.ts from the same inputs and are tested to agree with the
// contract to within one block of interest.
export interface AaveGoldPosition {
  id: string;
  // XAUt supplied, 6-decimal atomic.
  collateralAtomic: string;
  // Whether that supply is enabled as collateral. Supplying does not enable
  // it; a supply that was never enabled backs nothing.
  usingAsCollateral: boolean;
  // USDC owed on this market, 6-decimal atomic, interest included.
  debtAtomic: string;
  // Debt the user owes on other reserves of the spoke, in USD. Counts against
  // health here but is not repayable through this card.
  otherDebtUsd: number;
  // Collateral's worth at the oracle, USD with 8 decimals as an integer string,
  // and as a number.
  collateralValueUsd: number;
  // Headroom before liquidation, USDC atomic. A ceiling to display, not a
  // default to fill in: borrowing all of it lands exactly on health 1.0.
  availableToBorrowAtomic: string;
  // Collateral removable while leaving the debt covered, XAUt atomic.
  withdrawableCollateralAtomic: string;
  // The collateral factor this position is bound to, as a decimal, and the
  // key. Compare with the market's `dynamicConfigKey`: when they differ the
  // next borrow or withdraw rebinds the position to the latest parameters.
  collateralFactor: number;
  dynamicConfigKey: number;
  ltv: number | null;
  // The contract's own health factor. Null with no debt.
  healthFactor: number | null;
  // Gold price in USD at which this position is liquidated. Null with no debt.
  liquidationPrice: number | null;
  // Risk premium the position pays on top of the base rate, as a decimal.
  // Zero for XAUt-only collateral today.
  riskPremium: number;
}

interface PositionBody {
  positions: AaveGoldPosition[];
  // Ethereum wallet balances, atomic. Field names match the Morpho gold route
  // on purpose: lib/morpho/gold-fund.ts polls whichever route it is given for
  // `collateralBalanceAtomic` to confirm a delivery.
  collateralBalanceAtomic: string;
  loanBalanceAtomic: string;
  ethBalanceAtomic: string;
  gasPriceWei: string;
}

const cache = new Map<string, { fetchedAt: number; body: PositionBody }>();
const CACHE_TTL_MS = 10_000;
const STALE_GRACE_MS = 5 * 60_000;

// Reserve listings change by governance, not by the block.
let otherReservesCache: {
  fetchedAt: number;
  byMarket: Map<string, { reserveId: bigint; decimals: number }[]>;
} | null = null;
const OTHER_RESERVES_TTL_MS = 10 * 60_000;

async function otherReservesFor(marketId: string) {
  if (!otherReservesCache || Date.now() - otherReservesCache.fetchedAt > OTHER_RESERVES_TTL_MS) {
    const byMarket = new Map<string, { reserveId: bigint; decimals: number }[]>();
    for (const market of AAVE_GOLD_MARKETS) {
      byMarket.set(market.id, await readOtherReserves(market));
    }
    otherReservesCache = { fetchedAt: Date.now(), byMarket };
  }
  return otherReservesCache.byMarket.get(marketId) ?? [];
}

const UINT256_MAX = 2n ** 256n - 1n;

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
    return NextResponse.json(cached.body);
  }

  try {
    let collateralBalanceAtomic = "0";
    let loanBalanceAtomic = "0";
    let ethBalanceAtomic = "0";

    const positions = await Promise.all(
      AAVE_GOLD_MARKETS.map(async (market): Promise<AaveGoldPosition> => {
        const others = await otherReservesFor(market.id);
        const [read, wallet] = await Promise.all([
          readAaveGoldMarket(market),
          readAaveGoldWallet(market, address, others),
        ]);
        collateralBalanceAtomic = wallet.collateralBalanceAtomic.toString();
        loanBalanceAtomic = wallet.debtBalanceAtomic.toString();
        ethBalanceAtomic = wallet.ethBalanceAtomic.toString();

        const marketDebt = {
          atomic: wallet.debtAtomic,
          decimals: market.debtToken.decimals,
          price: read.debt.price,
        };
        const debts = [
          ...(wallet.debtAtomic > 0n ? [marketDebt] : []),
          ...wallet.otherDebts,
        ];
        const math = priceAaveGoldPosition({
          collateral: {
            atomic: wallet.suppliedAtomic,
            decimals: market.collateralToken.decimals,
            price: read.collateral.price,
            collateralFactorBps: wallet.userCollateralFactorBps,
            usingAsCollateral: wallet.usingAsCollateral,
          },
          debts,
          marketDebt: wallet.debtAtomic > 0n ? marketDebt : undefined,
          debtDecimals: market.debtToken.decimals,
          debtPrice: read.debt.price,
        });

        const otherDebtUsd = wallet.otherDebts.reduce(
          (sum, d) =>
            sum +
            (Number(d.atomic) / 10 ** d.decimals) *
              (Number(d.price) / 10 ** read.oracleDecimals),
          0,
        );

        return {
          id: market.id,
          collateralAtomic: wallet.suppliedAtomic.toString(),
          usingAsCollateral: wallet.usingAsCollateral,
          debtAtomic: wallet.debtAtomic.toString(),
          otherDebtUsd,
          collateralValueUsd: Number(math.collateralValueUsd) / 1e8,
          availableToBorrowAtomic: math.availableToBorrowAtomic.toString(),
          withdrawableCollateralAtomic:
            math.withdrawableCollateralAtomic.toString(),
          collateralFactor: Number(wallet.userCollateralFactorBps) / Number(BPS),
          dynamicConfigKey: wallet.userDynamicConfigKey,
          ltv: math.ltv,
          // The contract's figure, not the port's, so what is on screen is
          // what the contract would enforce.
          healthFactor:
            wallet.healthFactorWad === UINT256_MAX
              ? null
              : Number(wallet.healthFactorWad) / Number(WAD),
          liquidationPrice: math.liquidationPrice,
          riskPremium: Number(wallet.riskPremiumBps) / Number(BPS),
        };
      }),
    );

    const gasPriceWei = (await readGasPrice()).toString();

    const body: PositionBody = {
      positions,
      collateralBalanceAtomic,
      loanBalanceAtomic,
      ethBalanceAtomic,
      gasPriceWei,
    };
    cache.set(cacheKey, { fetchedAt: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS + STALE_GRACE_MS) {
      console.warn("[aave gold position] RPC failed, serving stale:", err);
      return NextResponse.json(cached.body);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
