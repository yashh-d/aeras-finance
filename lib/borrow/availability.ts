// Whether an xStock can be lent against anywhere. Both venues count: an asset
// with no Jupiter Lend vault may still have a Kamino reserve, and the badge in
// the asset lists is a claim about the product as a whole, not about one venue.
//
// Home and Markets both read this so the two surfaces can never disagree about
// which assets are marked.

import { vaultByCollateralMint } from "@/lib/jupiter/borrow";
import { kaminoCollateralByMint } from "@/lib/kamino/reserves";

export function hasLendingMarket(mint: string): boolean {
  return (
    vaultByCollateralMint(mint) != null || kaminoCollateralByMint(mint) != null
  );
}
