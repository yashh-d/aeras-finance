// Which mint pairs the swap proxies will relay.
//
// The proxies are deliberately not an open swap relay. Three shapes are allowed:
//
//   USDC <-> a borrowable xStock   the looping and multiply surfaces
//   an Ondo mint -> its xStock     converting held collateral into the form a
//                                  lending market accepts
//   curated <-> curated on Solana  the swap surface, both directions
//
// The Ondo direction is one-way on purpose. Converting TSLAon into TSLAx serves
// a deposit; the reverse would just be a trade, and nothing in the app needs it.
//
// The third shape is two-way because a swap has no preferred direction, but it
// is still a closed set: both mints must be in the curated swap registry. That
// registry is hardcoded server-side and never taken from the caller.

import { USDC_MINT } from "./constants";
import { xstockByMint } from "./xstocks";
import { equivalentTokenByMint } from "@/lib/solana/equivalent-tokens";
import {
  solanaMintFor,
  swapTokensForChain,
} from "@/lib/trustware/swap-tokens";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";

// Solana members of the curated swap registry, as the SPL mints Jupiter speaks.
// Native SOL is carried in that registry as Trustware's sentinel address, which
// is not a mint, so solanaMintFor maps it to WSOL here.
const CURATED_SOLANA_TOKENS = swapTokensForChain(TRUSTWARE_SOLANA_CHAIN);
const CURATED_SOLANA_MINTS = new Set(CURATED_SOLANA_TOKENS.map(solanaMintFor));

export function isAllowedSwapPair(
  inputMint: string,
  outputMint: string,
): boolean {
  if (inputMint === USDC_MINT && xstockByMint(outputMint)) return true;
  if (xstockByMint(inputMint) && outputMint === USDC_MINT) return true;
  const ondo = equivalentTokenByMint(inputMint);
  if (ondo && ondo.xstockMint === outputMint) return true;
  return (
    inputMint !== outputMint &&
    CURATED_SOLANA_MINTS.has(inputMint) &&
    CURATED_SOLANA_MINTS.has(outputMint)
  );
}

// Exported for the check script, so a failure names the mint rather than just
// reporting a rejected pair.
export function curatedSolanaMints(): string[] {
  return [...CURATED_SOLANA_MINTS];
}

// Guard against the registry drifting into a state where two entries collapse
// onto the same mint (adding WSOL alongside native SOL would do it), which would
// silently make a "swap" a no-op.
if (CURATED_SOLANA_MINTS.size !== CURATED_SOLANA_TOKENS.length) {
  throw new Error(
    "Two curated Solana swap tokens resolve to the same mint. Check swap-tokens.ts.",
  );
}
