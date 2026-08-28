// Gold a user might already hold, and which can be converted into XAUt to
// collateralise the Morpho Blue gold market.
//
// Scope is deliberately gold-only. The funding path sells the source for USDC
// and buys XAUt with it, so mechanically *any* holding could fund a deposit,
// and that is exactly why the list is pinned rather than open: selling someone's
// Tesla position to collateralise a gold loan silently changes what they are
// exposed to. Widening this is a registry edit and a product decision, in that
// order.
//
// These are NOT equivalents in the sense of lib/trustware/equivalents.ts. That
// registry maps 1:1 representations of the same underlying (TSLAon and TSLAx
// are both one Tesla share). Nothing here is 1:1 with anything else:
//
//   XAUt        one troy ounce                  ~$4,610
//   GLDx        one GLD share, ~0.092 oz        ~$425
//   GLDon (sol) reads as ~0.086 oz              ~$395
//   GLDon (eth) reads as ~0.45 oz               ~$2,070
//   XAUt0       one troy ounce, LayerZero OFT   ~$4,618
//
// Converting between them is a SALE at market, not a re-wrapping, with slippage
// and a taxable event attached. The two GLDon rows are the sharp edge: the same
// symbol from the same issuer prices 5.2x apart across two chains. Ondo's own
// mark agrees with the Ethereum figure (docs/ondo-perps.md records ~$2,090 and
// flags that it is not a GLD share), so this is a real denomination difference
// or a long-standing mispricing, and either way it is not something to average
// over.
//
// The rule that falls out of it, and it is the same rule lib/ondo/fund.ts
// arrived at independently: **never price a conversion from a registry, price
// it from an executed quote.** Trustware's own token registry lists GLDx on
// Ethereum at $7,160, which is 17x its actual sale price. `approxUnitUsd` below
// exists only to satisfy Trustware's `fromAmountUSD` requirement on Solana
// routes and to size a probe. It is never used to decide what a user receives;
// lib/morpho/gold-fund.ts bounds value loss against the quote it is about to
// execute.

import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";

export type GoldSourceKind = "evm" | "solana";

export interface GoldCollateralSource {
  // Stable key for the picker. "<chain>:<symbol>".
  id: string;
  symbol: string;
  name: string;
  // What the token actually represents, in the user's terms. Shown in the
  // picker because "GLDx" and "XAUt" look interchangeable and are not.
  denomination: string;
  // Trustware chainId. Numeric string for EVM, "solana-mainnet-beta" for Solana.
  chain: string;
  chainLabel: string;
  kind: GoldSourceKind;
  // Contract address (lowercased) or SPL mint (verbatim: base58 is
  // case-sensitive, and lowercasing can collide two distinct mints).
  token: string;
  decimals: number;
  // Rough unit price, for probe sizing and Trustware's fromAmountUSD only.
  // Never shown to a user and never used to decide value. See the header.
  approxUnitUsd: number;
  logo?: string;
}

const CHAIN_LABELS: Record<string, string> = {
  "1": "Ethereum",
  "56": "BNB Chain",
  [TRUSTWARE_SOLANA_CHAIN]: "Solana",
};

function evm(
  chain: string,
  symbol: string,
  name: string,
  denomination: string,
  token: string,
  approxUnitUsd: number,
  logo?: string,
): GoldCollateralSource {
  return {
    id: `${chain}:${symbol}`,
    symbol,
    name,
    denomination,
    chain,
    chainLabel: CHAIN_LABELS[chain] ?? chain,
    kind: "evm",
    token: token.toLowerCase(),
    // Every EVM Ondo and xStock token observed is 18 decimals. Solana differs
    // per issuer, which is why this is not a global constant.
    decimals: 18,
    approxUnitUsd,
    logo,
  };
}

function sol(
  symbol: string,
  name: string,
  denomination: string,
  token: string,
  decimals: number,
  approxUnitUsd: number,
  logo?: string,
): GoldCollateralSource {
  return {
    id: `${TRUSTWARE_SOLANA_CHAIN}:${symbol}`,
    symbol,
    name,
    denomination,
    chain: TRUSTWARE_SOLANA_CHAIN,
    chainLabel: CHAIN_LABELS[TRUSTWARE_SOLANA_CHAIN],
    kind: "solana",
    token,
    decimals,
    approxUnitUsd,
    logo,
  };
}

// Addresses pulled from Trustware's live token registry and cross-checked
// against the addresses this repo already carries: the Solana GLDx mint matches
// lib/jupiter/xstocks.ts, and the Ethereum GLDon address matches
// ONDO_MARGIN_TOKENS in lib/ondo/collateral.ts. Listing in a registry proves the
// token exists, never that a route to XAUt is live; routability is confirmed
// lazily at quote time, and scripts/morpho-gold-check.mts prints it per source.
export const GOLD_COLLATERAL_SOURCES: readonly GoldCollateralSource[] = [
  // Solana first: it is where the app's users actually hold things, and both
  // Solana legs are confirmed routable.
  sol(
    "GLDx",
    "Gold xStock",
    "One GLD share, about 0.09 oz",
    "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    8,
    425,
    "/logos/gld.png",
  ),
  sol(
    "GLDon",
    "SPDR Gold Shares (Ondo)",
    "About 0.09 oz",
    "hWfiw4mcxT8rnNFkk6fsCQSxoxgZ9yVhB6tyeVcondo",
    9,
    395,
  ),
  sol(
    "XAUt0",
    "Tether Gold (LayerZero)",
    "One troy ounce",
    "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P",
    6,
    4_618,
  ),

  // Ethereum. GLDon here is Ondo's margin token, the same contract
  // lib/ondo/collateral.ts posts to Ondo Perps, so a user who withdrew margin
  // can put it to work rather than leaving it idle on Ethereum.
  evm("1", "GLDon", "SPDR Gold Shares (Ondo)", "About 0.45 oz", "0x423d42e505e64f99b6e277eb7ed324cc5606f139", 2_070),
  evm("1", "GLDx", "Gold xStock", "One GLD share, about 0.09 oz", "0x2380f2673c640fb67e2d6b55b44c62f0e0e69da9", 425, "/logos/gld.png"),

  // BNB Chain, the other source chain Privy is configured to sign on.
  evm("56", "GLDon", "SPDR Gold Shares (Ondo)", "About 0.09 oz", "0xfa9a1e901085e269f6d428f79cd5252d8b919344", 425),
  evm("56", "GLDx", "Gold xStock", "One GLD share, about 0.09 oz", "0x2380f2673c640fb67e2d6b55b44c62f0e0e69da9", 425, "/logos/gld.png"),
] as const;

function keyOf(chain: string, token: string): string {
  return `${chain}:${chain === TRUSTWARE_SOLANA_CHAIN ? token : token.toLowerCase()}`;
}

const BY_KEY = new Map(
  GOLD_COLLATERAL_SOURCES.map((s) => [keyOf(s.chain, s.token), s]),
);
const BY_ID = new Map(GOLD_COLLATERAL_SOURCES.map((s) => [s.id, s]));

export function goldSourceById(id: string): GoldCollateralSource | undefined {
  return BY_ID.get(id);
}

export function findGoldSource(
  chain: string,
  token: string,
): GoldCollateralSource | undefined {
  return BY_KEY.get(keyOf(chain, token));
}

export function goldSourcesForKind(kind: GoldSourceKind): GoldCollateralSource[] {
  return GOLD_COLLATERAL_SOURCES.filter((s) => s.kind === kind);
}
