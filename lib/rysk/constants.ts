// Rysk V12 option protocol. Fixed values transcribed from the live API on
// 2026-08-16, plus the two chains that actually carry inventory.
//
// Rysk publishes a maker integration guide but no taker documentation. The
// endpoints below are the public, unauthenticated read surface their own app
// uses; they were confirmed by request, not inferred. Anything to do with
// placing a trade is deliberately absent from this file. See docs/rysk.md.

export const RYSK_API_BASE_URL = "https://v12.rysk.finance";

// Rysk lists products on Ethereum and HyperEVM. Base appears in /api/assets but
// every Base asset is flagged inactive and no product references one, so it is
// not modelled here.
export const RYSK_CHAIN_ETHEREUM = 1;
export const RYSK_CHAIN_HYPEREVM = 999;

export const RYSK_CHAIN_NAMES: Record<number, string> = {
  [RYSK_CHAIN_ETHEREUM]: "Ethereum",
  [RYSK_CHAIN_HYPEREVM]: "HyperEVM",
};

// Option quantities cross the wire at 18 decimals no matter what the underlying
// token uses. WBTC is an 8 decimal token but its minTradeSize is 5e16, meaning
// 0.05 contracts. Scaling a size by the token's own decimals would size a trade
// twenty orders of magnitude wrong, so the contract scale is named separately
// from any token scale.
export const RYSK_CONTRACT_DECIMALS = 18;

// Underlying prices in /api/assets are 18 decimal USD, unrelated to the token's
// own decimals.
export const RYSK_PRICE_DECIMALS = 18;

// An absent ask is reported as int64 max divided by 1e9 rather than as null or
// zero. Rendering it prints an ask of 9.2 billion next to a $40 bid. Compared
// with a tolerance because it arrives as a float that has already lost
// precision.
export const RYSK_NO_ASK_SENTINEL = 9223372036.854776;

export function isMissingQuote(value: number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (!Number.isFinite(value)) return true;
  // Zero means no maker has quoted, which is the common case.
  if (value <= 0) return true;
  return value >= RYSK_NO_ASK_SENTINEL * 0.999;
}

// Their own client polls inventory every 2 seconds. We are a third party reading
// an endpoint we were not given a rate limit for, so this backs off hard. The
// data is a strike ladder with model-derived APYs, not a live book, and it does
// not move meaningfully inside a minute.
export const RYSK_CATALOG_REFRESH_MS = 30_000;

// Options are European, so a position cannot be closed before expiry. Two
// schedules are in play: crypto expires Friday 08:00 UTC, while XAUT follows the
// COMEX gold option calendar and expires 17:30 UTC on a weekday that moves month
// to month (26 Aug 2026 is a Wednesday, 24 Sep 2026 a Thursday).
//
// Nothing derives an expiry from these. The API timestamp is always
// authoritative and the UI renders it directly. They exist so
// scripts/rysk-check.mts fails if a schedule changes rather than letting the
// lockup copy quietly go wrong.
export const RYSK_CRYPTO_EXPIRY = { weekdayUtc: 5, hourUtc: 8, minuteUtc: 0 };
export const RYSK_COMEX_EXPIRY = { hourUtc: 17, minuteUtc: 30 };
export const RYSK_COMEX_UNDERLYINGS = new Set(["XAUT"]);

// The stables a strike can be denominated in. These are the only token addresses
// referenced by /api/inventory that /api/assets does not describe, so without
// this table a cash-secured put resolves to an unknown collateral token. Symbols
// and decimals for the HyperEVM pair were read from the contracts rather than
// assumed: 0xb8ce is USD₮0 and 0xb883 is USDC, which is the reverse of what the
// address prefixes suggest.
export const RYSK_STABLES: Record<
  string,
  { chainId: number; symbol: string; decimals: number }
> = {
  "0xdac17f958d2ee523a2206206994597c13d831ec7": {
    chainId: RYSK_CHAIN_ETHEREUM,
    symbol: "USDT",
    decimals: 6,
  },
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    chainId: RYSK_CHAIN_ETHEREUM,
    symbol: "USDC",
    decimals: 6,
  },
  "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb": {
    chainId: RYSK_CHAIN_HYPEREVM,
    symbol: "USDT0",
    decimals: 6,
  },
  "0xb88339cb7199b77e23db6e890353e22632ba630f": {
    chainId: RYSK_CHAIN_HYPEREVM,
    symbol: "USDC",
    decimals: 6,
  },
};
