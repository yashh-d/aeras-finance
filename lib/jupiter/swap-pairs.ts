// Which mint pairs the swap proxies will relay.
//
// The proxies are deliberately not an open swap relay. Two shapes are allowed:
//
//   USDC <-> a borrowable xStock   the looping and multiply surfaces
//   an Ondo mint -> its xStock     converting held collateral into the form a
//                                  lending market accepts
//
// The Ondo direction is one-way on purpose. Converting TSLAon into TSLAx serves
// a deposit; the reverse would just be a trade, and nothing in the app needs it.

import { USDC_MINT } from "./constants";
import { xstockByMint } from "./xstocks";
import { equivalentTokenByMint } from "@/lib/solana/equivalent-tokens";

export function isAllowedSwapPair(
  inputMint: string,
  outputMint: string,
): boolean {
  if (inputMint === USDC_MINT && xstockByMint(outputMint)) return true;
  if (xstockByMint(inputMint) && outputMint === USDC_MINT) return true;
  const ondo = equivalentTokenByMint(inputMint);
  return Boolean(ondo && ondo.xstockMint === outputMint);
}
