// Wire shapes returned by the Rysk public read endpoints, transcribed from live
// responses on 2026-08-16. There is no published schema for these, so every
// field here was observed rather than documented.
//
// Note the mixed conventions: /api/assets reports amounts as 18 decimal strings
// while /api/inventory reports strikes, deltas and premiums as plain JSON
// numbers in human units. Keeping the two apart is the point of this file.

// One tradeable underlying token. Several entries can share an `underlying`:
// HYPE is quotable against WHYPE, kHYPE, LHYPE and wstHYPE, which is Rysk's
// alternative collateral feature rather than four separate markets.
export interface RyskAsset {
  underlying: string;
  underlyingAssetAddress: string;
  // The token's own decimals. Not the scale of minTradeSize or price.
  decimals: number;
  // Contract quantities at 18 decimals, independent of `decimals` above.
  minTradeSize: string;
  maxTradeSize: string;
  symbol: string;
  chainId: number;
  address: string;
  // Inactive assets stay listed. Presence says nothing about tradeability.
  active: boolean;
  // 18 decimal USD.
  price: string;
  multipliers: Array<{ value: string; name: string }>;
}

// Keyed by stringified chain id.
export type RyskAssetsResponse = Record<string, RyskAsset[]>;

// One way to collateralise a given strike and expiry. A call can be backed by
// the underlying or by a liquid staking token that redeems for it; a put is
// backed by the stable the strike is denominated in.
export interface RyskProductRef {
  asset: string;
  strikeAsset: string;
  collateralAsset: string;
}

// A single strike and expiry on one side of the market.
export interface RyskCombination {
  // Display form of the expiry, for example "21AUG26".
  expiry: string;
  expiration_timestamp: number;
  timeToExpiryDays: number;
  // Human units, not scaled.
  strike: number;
  isPut: boolean;
  delta: number;
  // USD premium per contract. Zero means no maker has quoted. An ask can also
  // arrive as RYSK_NO_ASK_SENTINEL, which likewise means absent.
  bid: number;
  ask: number;
  // Spot price of the underlying at `timestamp`.
  index: number;
  // Annualised percent, 87.79 meaning 87.79%. Present even when bid and ask are
  // both absent, so it is model-derived and not a quote anyone has committed to.
  apy: number;
  timestamp: number;
  products: RyskProductRef[];
}

export interface RyskInventoryEntry {
  strikes: Record<string, number[]>;
  expiries: number[];
  // Keyed "strike-expiry", for example "75.000000-1787299200". Calls and puts
  // do not currently collide in this map because Rysk only lists out-of-the-money
  // strikes, but nothing guarantees that, so callers must key on isPut too.
  combinations: Record<string, RyskCombination>;
}

// Keyed by underlying symbol. XRP and ZEC are present with empty combinations.
export type RyskInventoryResponse = Record<string, RyskInventoryEntry>;

// Normalized shapes below. These are what the browser and the UI see.

// A collateral choice attached to a specific strike, with the token metadata
// already joined in from /api/assets.
export interface RyskCollateralChoice {
  chainId: number;
  // The token the option is written on.
  asset: string;
  assetSymbol: string;
  // Where the strike is denominated and the premium paid.
  strikeAsset: string;
  // What the seller posts. Equals `asset` for a call and `strikeAsset` for a put.
  collateralAsset: string;
  collateralSymbol: string;
  collateralDecimals: number;
}

export interface RyskOption {
  underlying: string;
  isPut: boolean;
  strike: number;
  expiry: number;
  expiryLabel: string;
  daysToExpiry: number;
  delta: number;
  indexPrice: number;
  // Null when no maker has quoted or the sentinel was returned.
  bid: number | null;
  ask: number | null;
  // Model-derived annualised percent. Never presented as a firm rate.
  indicativeApy: number;
  collaterals: RyskCollateralChoice[];
  quotedAt: number;
}

export interface RyskUnderlying {
  symbol: string;
  indexPrice: number;
  chainIds: number[];
  expiries: number[];
  // Selling a call is the covered call product, selling a put the cash-secured
  // put product.
  calls: RyskOption[];
  puts: RyskOption[];
}

export interface RyskCatalog {
  underlyings: RyskUnderlying[];
  fetchedAt: number;
}
