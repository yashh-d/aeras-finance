// Gold the user already holds, anywhere Trustware can see it.
//
// This is the same shape as ondo-holdings.ts and exists for the same reason:
// `selectHeldEquivalents` resolves every balance through the equivalence
// registry, and that registry is keyed to the four underlyings with Jupiter Lend
// borrow vaults. Gold has none, so gold holdings can never come back through it.
//
// The two selectors do not overlap on the wallet panel either. GLDon on
// Ethereum appears in `selectOndoHoldings` because it is Ondo margin a Perps
// withdrawal left behind, and it appears here because it is gold that could
// collateralise a Morpho position. Same token, two questions, and the answer to
// "what do I own" is not the answer to "what can I do with it".

import {
  GOLD_COLLATERAL_SOURCES,
  findGoldSource,
  type GoldCollateralSource,
} from "@/lib/morpho/gold-sources";
import { TRUSTWARE_SOLANA_CHAIN } from "./constants";

import type { TrustwareBalancesResponse } from "./types";

// Only chains a curated gold source lives on. Everything else in the response
// is ignored rather than reported as a failure.
const GOLD_CHAINS = new Set(GOLD_COLLATERAL_SOURCES.map((s) => s.chain));

export interface GoldHolding {
  // The registry entry, so the caller has the decimals, the denomination copy
  // and the routing details without a second lookup.
  source: GoldCollateralSource;
  balanceAtomic: string;
}

export function selectGoldHoldings(
  res: TrustwareBalancesResponse,
): GoldHolding[] {
  const out: GoldHolding[] = [];

  for (const result of res.results ?? []) {
    const chain = result.chain_id;
    if (!chain || !GOLD_CHAINS.has(chain)) continue;

    for (const balance of result.balances ?? []) {
      // Native assets carry no contract and are never gold.
      if (!balance.contract) continue;
      if (!balance.balance || balance.balance === "0") continue;

      // Matched on address, never on symbol. A live BSC scan returned TSLAB and
      // NVDAB beside the real Ondo tokens, and Solana mints came back with no
      // symbol field at all (see balances.ts). "GLDx" is not a safe key.
      const source = findGoldSource(chain, balance.contract);
      if (!source) continue;

      // Decimals drive the conversion sizing. If upstream disagrees with the
      // registry, drop the holding rather than size a transfer against the
      // wrong scale: XAUt at 18 decimals instead of 6 reads as 10^12 ounces.
      // Dropping shows nothing; guessing sends the wrong amount.
      if (
        typeof balance.decimals === "number" &&
        balance.decimals !== source.decimals
      ) {
        console.warn(
          `[gold holdings] ${source.symbol} on ${source.chainLabel} reported ${balance.decimals} decimals, registry expects ${source.decimals}; skipped`,
        );
        continue;
      }

      out.push({ source, balanceAtomic: balance.balance });
    }
  }

  // Solana first, then by value. The Solana sources are the ones that can
  // actually be converted today, so they belong at the top of a picker.
  return out.sort((a, b) => {
    const aSol = a.source.chain === TRUSTWARE_SOLANA_CHAIN ? 0 : 1;
    const bSol = b.source.chain === TRUSTWARE_SOLANA_CHAIN ? 0 : 1;
    if (aSol !== bSol) return aSol - bSol;
    return goldHoldingApproxUsd(b) - goldHoldingApproxUsd(a);
  });
}

export function goldHoldingUiAmount(holding: GoldHolding): number {
  return Number(holding.balanceAtomic) / 10 ** holding.source.decimals;
}

// Rough USD value, for ORDERING a picker and nothing else.
//
// This uses `approxUnitUsd`, which lib/morpho/gold-sources.ts is emphatic about
// not trusting: Trustware prices Ethereum GLDx 17x above its real sale price.
// Sorting by a wrong number puts a row in the wrong place. Pricing a conversion
// by one would take someone's money, which is why lib/morpho/gold-fund.ts
// values every leg against the Morpho oracle and an executed quote instead.
export function goldHoldingApproxUsd(holding: GoldHolding): number {
  return goldHoldingUiAmount(holding) * holding.source.approxUnitUsd;
}
