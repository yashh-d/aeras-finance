// Where one catalog asset can be posted as collateral, in the Borrow tab's
// own terms: the table key that opens the row, the venue, and the two
// parameters a reader wants before opening it. Read from the two venue
// registries; nothing here is live, which is why the Terminal's borrow mode
// draws rates and liquidity from useBorrowMarketStats beside it.

import { vaultByCollateralMint } from "@/lib/jupiter/borrow";
import { jupiterMarketKey, kaminoMarketKey } from "@/lib/borrow/use-market-stats";
import { kaminoCollateralByMint } from "@/lib/kamino/reserves";

export type BorrowVenue = "Jupiter Lend" | "Kamino";

export interface AssetBorrowMarket {
  // The Borrow tab's expansion key for this row. See BorrowTableRow.key.
  key: string;
  venue: BorrowVenue;
  // Whole percents. Jupiter carries tenths of a percent (800 is 80%); Kamino
  // carries a decimal fraction. Both are display figures: the forms read the
  // live values.
  maxLtvPct: number;
  liquidationThresholdPct: number;
}

export function borrowMarketsFor(mint: string): AssetBorrowMarket[] {
  const out: AssetBorrowMarket[] = [];
  const vault = vaultByCollateralMint(mint);
  if (vault) {
    out.push({
      key: jupiterMarketKey(vault.vaultId),
      venue: "Jupiter Lend",
      maxLtvPct: vault.collateralFactor / 10,
      liquidationThresholdPct: vault.liquidationThreshold / 10,
    });
  }
  const reserve = kaminoCollateralByMint(mint);
  if (reserve) {
    out.push({
      key: kaminoMarketKey(reserve.reserve),
      venue: "Kamino",
      maxLtvPct: Math.round(reserve.maxLtvSnapshot * 100),
      liquidationThresholdPct: reserve.liquidationThreshold,
    });
  }
  return out;
}
