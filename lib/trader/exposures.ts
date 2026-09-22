// What a Trader card puts a logo on: the asset bought and what the borrowed
// USDC becomes. A card shows exposures as marks rather than as a sentence,
// so "Nasdaq collateral, the loan into the Mag 7" is the QQQx mark, an
// arrow, and the eight holdings' marks. Pure; the marks are the catalog's
// own logos and the venue marks in lib/tokens/logos.ts.

import { MAG7X_HOLDINGS } from "@/lib/glider/constants";
import { xstockBySymbol, type XStock } from "@/lib/jupiter/xstocks";
import type { EarnVenue } from "@/lib/strategies/rates";
import { curatorLogo, tokenLogoBySymbol, VENUE_LOGOS } from "@/lib/tokens/logos";

import type { TierVenue } from "./tiers";

// The shape AssetLogo draws: a symbol for the monogram fallback, a name for
// the alt text, a logo when there is one.
export interface Mark {
  key: string;
  symbol: string;
  name: string;
  logo?: string;
}

export function assetMark(x: XStock, key = x.mint): Mark {
  return { key, symbol: x.symbol, name: x.name, logo: x.logo };
}

export const USDC_MARK: Mark = { key: "usdc", symbol: "USDC", name: "USDC", logo: tokenLogoBySymbol("USDC") };
export const SHMON_MARK: Mark = { key: "shmon", symbol: "shMON", name: "shMON", logo: tokenLogoBySymbol("shMON") };
export const ETH_MARK: Mark = { key: "eth", symbol: "ETH", name: "Ether", logo: VENUE_LOGOS.ethereum };
// The USDC vaults as their venue's mark, not as USDC: the loan is USDC
// already, so the mark says where it went. Morpho carries its curator's
// mark beside it, because the vault is the Hyperithm one (BASE_CASE_VAULT
// in lib/strategies/rates.ts picks it by that name).
export const MORPHO_MARK: Mark = { key: "morpho", symbol: "MORPHO", name: "Morpho", logo: VENUE_LOGOS.morpho };
export const HYPERITHM_MARK: Mark = { key: "hyperithm", symbol: "HYP", name: "Hyperithm", logo: curatorLogo("Hyperithm") };
export const JUPITER_MARK: Mark = { key: "jupiter", symbol: "JUP", name: "Jupiter Lend", logo: VENUE_LOGOS.jupiter };
export const KAMINO_MARK: Mark = { key: "kamino", symbol: "KMNO", name: "Kamino", logo: VENUE_LOGOS.kamino };
// No marks on disk for these two yet; AssetLogo draws the monogram.
export const BTC_MARK: Mark = { key: "btc", symbol: "BTC", name: "Bitcoin" };
export const UNISWAP_MARK: Mark = { key: "uniswap", symbol: "UNI", name: "Uniswap pool" };

// The eight Mag7X holdings, as the xStocks that track the same shares, so
// they wear the catalog's logos.
export function mag7xMarks(): Mark[] {
  return MAG7X_HOLDINGS.map((h) => {
    const x = xstockBySymbol(h.xstockSymbol);
    return x
      ? assetMark(x, `mag7x-${h.ticker}`)
      : { key: `mag7x-${h.ticker}`, symbol: h.ticker, name: h.name };
  });
}

// What the loan becomes at a venue.
export function destinationMarks(venue: EarnVenue | TierVenue["venue"]): Mark[] {
  switch (venue) {
    case "glider":
      return mag7xMarks();
    case "shmonad":
      return [SHMON_MARK];
    case "eth-staking":
      return [ETH_MARK];
    case "btc-staking":
      return [BTC_MARK];
    case "uniswap-lp":
      return [UNISWAP_MARK];
    case "morpho":
      return [MORPHO_MARK, HYPERITHM_MARK];
    case "jupiter":
      return [JUPITER_MARK];
    case "kamino":
      return [KAMINO_MARK];
  }
}
