// Turn a Trustware /balances payload into the convertible holdings the planner
// understands.
//
// Trustware scans every chain an address format can exist on and returns
// everything it finds, so this module's whole job is to narrow that down to the
// tokens our equivalence registry recognises, keyed on contract address.
//
// Matching on address rather than symbol is deliberate and load-bearing. A live
// BSC response contained TSLAB, NVDAB, QQQB and SPCXB alongside the real TSLAon
// and NVDAon, and separately returned Ondo's Solana mints with no symbol field
// at all. Symbol matching would both admit tokens we do not accept and miss the
// ones we do.

import { allEquivalentSources, findEquivalentSource } from "./equivalents";
import type { HeldEquivalent } from "./planner";
import {
  isAddressIncompatible,
  type TrustwareBalancesResponse,
} from "./types";

// Only these chains matter. Everything else in the response is ignored rather
// than reported as a failure.
const REGISTRY_CHAINS = new Set(allEquivalentSources().map((s) => s.chain));

export interface EquivalentBalances {
  held: HeldEquivalent[];
  // Registry chains whose balance read genuinely failed. Distinct from "the user
  // holds nothing there", because telling someone they have no assets when we
  // could not read the chain is the one wrong answer here.
  unreadableChains: { chain: string; error: string }[];
}

// Extract the convertible holdings from one address's scan. Zero balances are
// dropped so the planner's candidate list stays short.
export function selectHeldEquivalents(
  res: TrustwareBalancesResponse,
): EquivalentBalances {
  const held: HeldEquivalent[] = [];
  const unreadableChains: { chain: string; error: string }[] = [];

  for (const result of res.results ?? []) {
    const chain = result.chain_id;
    if (!chain || !REGISTRY_CHAINS.has(chain)) continue;

    if (result.error) {
      // The address simply does not apply to this chain (an EVM address on
      // Solana, say). Expected, not a failure.
      if (!isAddressIncompatible(result.error)) {
        unreadableChains.push({ chain, error: result.error });
      }
      continue;
    }

    for (const balance of result.balances ?? []) {
      // Native assets carry no contract and are never convertible equivalents.
      if (!balance.contract) continue;
      if (!balance.balance || balance.balance === "0") continue;

      const match = findEquivalentSource(chain, balance.contract);
      if (!match) continue;

      // Decimals drive the conversion sizing. If upstream disagrees with the
      // registry, the safe move is to drop the holding rather than size a
      // transfer against the wrong scale, which would be off by orders of
      // magnitude. Report it as unreadable so the UI stays honest.
      if (
        typeof balance.decimals === "number" &&
        balance.decimals !== match.source.decimals
      ) {
        unreadableChains.push({
          chain,
          error:
            `${match.source.symbol} reported ${balance.decimals} decimals, ` +
            `registry expects ${match.source.decimals}`,
        });
        continue;
      }

      held.push({ source: match.source, balanceAtomic: balance.balance });
    }
  }

  return { held, unreadableChains };
}

// Merge the scans for a user's Solana and EVM addresses into one view. The two
// calls are independent, so a failure on one side must not erase the other's
// holdings.
export function mergeEquivalentBalances(
  ...parts: EquivalentBalances[]
): EquivalentBalances {
  return {
    held: parts.flatMap((p) => p.held),
    unreadableChains: parts.flatMap((p) => p.unreadableChains),
  };
}
