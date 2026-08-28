// Logos and display names for the non-xStock assets the app shows.
//
// `assetIdentity` in lib/jupiter/xstocks.ts resolves a mint against the curated
// xStock catalog. Everything the Earn tab lists is a stablecoin or SOL, none of
// which is an xStock, so every one of those rows fell through to a symbol
// monogram. This registry is the fallback.
//
// Mints are re-exported from the modules that already own them rather than
// re-typed here. A logo pointing at the wrong mint is a cosmetic bug; a mint
// typo in a second place is a deposit routed to an unverified token.

import { SOL_MINT, USDC_MINT } from "@/lib/jupiter/constants";
import { EARN_ASSETS } from "@/lib/jupiter/earn";

export interface TokenIdentity {
  symbol: string;
  name: string;
  logo?: string;
}

// Public paths under /public/logos. Files are self-hosted rather than hotlinked:
// every other logo in this repo is local, and the upstream sources are a mix of
// vendor CDNs and an IPFS gateway that already returned 403 once during setup.
const LOGO_BY_SYMBOL: Readonly<Record<string, string>> = {
  USDC: "/logos/usdc.png",
  // Jupiter's own mark for jupUSD, which is not the Jupiter logo. Kept distinct
  // so the JupUSD row and the Jupiter Lend venue column do not render the same
  // image side by side.
  JupUSD: "/logos/jupusd.png",
  USDT: "/logos/usdt.svg",
  SOL: "/logos/solana.png",
  USDS: "/logos/usds.svg",
  EURC: "/logos/eurc.png",
  USDG: "/logos/usdg.png",
  // Monad's native token, held only for gas on the Morpho venue.
  MON: "/logos/monad.png",
};

// Built from EARN_ASSETS so the mint set cannot drift from the vault registry.
const BY_MINT: Readonly<Record<string, TokenIdentity>> = Object.fromEntries(
  EARN_ASSETS.map((a) => [
    a.assetMint,
    { symbol: a.symbol, name: a.name, logo: LOGO_BY_SYMBOL[a.symbol] },
  ]),
);

// Native SOL and wrapped SOL are the same asset to a user. EARN_ASSETS carries
// the wrapped mint; a balance row may carry either.
const EXTRA_BY_MINT: Readonly<Record<string, TokenIdentity>> = {
  [SOL_MINT]: { symbol: "SOL", name: "Solana", logo: LOGO_BY_SYMBOL.SOL },
  [USDC_MINT]: { symbol: "USDC", name: "USD Coin", logo: LOGO_BY_SYMBOL.USDC },
};

export function tokenIdentityByMint(mint: string): TokenIdentity | undefined {
  return BY_MINT[mint] ?? EXTRA_BY_MINT[mint];
}

export function tokenLogoBySymbol(symbol: string): string | undefined {
  return LOGO_BY_SYMBOL[symbol];
}

// ── Venues and curators ────────────────────────────────────────────────────

// Lending venues shown in the Earn tab.
export const VENUE_LOGOS: Readonly<Record<string, string>> = {
  jupiter: "/logos/jupiter.svg",
  kamino: "/logos/kamino.svg",
  morpho: "/logos/morpho.png",
  // Chain marks, shown beside the section for each EVM venue: Monad for the
  // Morpho earn vaults, Ethereum for the Morpho gold borrow market.
  monad: "/logos/monad.png",
  ethereum: "/logos/eth.png",
};

// Morpho vault curators. Sourced from Morpho's own CDN, which serves these for
// curators it marks `verified: true` in the indexer - the authoritative mark
// rather than one scraped off a curator's marketing site.
export const CURATOR_LOGOS: Readonly<Record<string, string>> = {
  Hyperithm: "/logos/hyperithm.svg",
  "August Digital": "/logos/august.svg",
  "Steakhouse Financial": "/logos/steakhouse.svg",
};

export function curatorLogo(curator: string): string | undefined {
  return CURATOR_LOGOS[curator];
}
