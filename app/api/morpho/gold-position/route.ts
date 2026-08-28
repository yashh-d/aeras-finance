import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { GOLD_MARKETS } from "@/lib/morpho/gold-market";
import { priceGoldPosition } from "@/lib/morpho/gold-math";
import {
  readGasPrice,
  readGoldMarket,
  readGoldWallet,
} from "@/lib/morpho/gold-server";

export const dynamic = "force-dynamic";

// A borrower's position in each curated gold market, plus the Ethereum wallet
// state the forms need to size a transaction.
//
// Every figure is priced with interest accrued to the latest block and rounded
// the way Morpho rounds it, so the health shown here is the health the contract
// would compute. See lib/morpho/gold-math.ts.
export interface GoldPosition {
  id: string;
  // XAUt posted as collateral, 6-decimal atomic.
  collateralAtomic: string;
  // USDT owed, 6-decimal atomic, interest included.
  debtAtomic: string;
  // Collateral's worth at the market oracle, in USDT atomic.
  collateralValueAtomic: string;
  // Headroom before liquidation, USDT atomic. A ceiling to display, not a
  // default to fill in: borrowing all of it lands exactly on the threshold.
  availableToBorrowAtomic: string;
  // Collateral removable while leaving the debt covered, XAUt atomic.
  withdrawableCollateralAtomic: string;
  // Raw borrow shares. A full repayment is sized in shares, not assets, so the
  // debt closes exactly instead of leaving dust behind.
  borrowSharesAtomic: string;
  ltv: number | null;
  healthFactor: number | null;
  // Gold price (in USDT) at which this position is liquidated. Null with no
  // debt.
  liquidationPrice: number | null;
}

interface PositionBody {
  positions: GoldPosition[];
  // Ethereum wallet balances, atomic.
  collateralBalanceAtomic: string;
  loanBalanceAtomic: string;
  // Native ETH in wei, and what gas costs right now. The funding planner sizes
  // its top-up from both rather than from a constant, because a number written
  // into the source at 5 gwei is useless at 60.
  ethBalanceAtomic: string;
  gasPriceWei: string;
}

const cache = new Map<string, { fetchedAt: number; body: PositionBody }>();
const CACHE_TTL_MS = 10_000;
const STALE_GRACE_MS = 5 * 60_000;

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
    // Wallet balances are identical across markets (same chain, same tokens),
    // so the last read wins rather than being fetched per market.
    let collateralBalanceAtomic = "0";
    let loanBalanceAtomic = "0";
    let ethBalanceAtomic = "0";

    const positions = await Promise.all(
      GOLD_MARKETS.map(async (market): Promise<GoldPosition> => {
        const [read, wallet] = await Promise.all([
          readGoldMarket(market),
          readGoldWallet(market, address),
        ]);
        collateralBalanceAtomic = wallet.collateralBalanceAtomic.toString();
        loanBalanceAtomic = wallet.loanBalanceAtomic.toString();
        ethBalanceAtomic = wallet.ethBalanceAtomic.toString();

        const math = priceGoldPosition({
          market,
          position: wallet.position,
          state: read.state,
          oraclePrice: read.oraclePrice,
        });

        // The liquidation threshold expressed as a gold price a person can
        // read, rather than as a 1e36-scaled integer.
        const liquidationPrice =
          math.liquidationOraclePrice === null
            ? null
            : Number(
                (math.liquidationOraclePrice *
                  10n ** BigInt(market.collateralToken.decimals)) /
                  10n ** 36n,
              ) /
              10 ** market.loanToken.decimals;

        return {
          id: market.id,
          collateralAtomic: math.collateralAtomic.toString(),
          debtAtomic: math.debtAtomic.toString(),
          collateralValueAtomic: math.collateralValueAtomic.toString(),
          availableToBorrowAtomic: math.availableToBorrowAtomic.toString(),
          withdrawableCollateralAtomic:
            math.withdrawableCollateralAtomic.toString(),
          borrowSharesAtomic: wallet.position.borrowShares.toString(),
          ltv: math.ltv,
          healthFactor: math.healthFactor,
          liquidationPrice,
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
      console.warn("[gold position] RPC failed, serving stale:", err);
      return NextResponse.json(cached.body);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
