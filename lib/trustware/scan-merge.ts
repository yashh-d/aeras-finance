// Keep a chain's rows from the last scan when the new scan could not read it.
//
// A Trustware scan answers per chain, and a chain can fail while the others
// succeed: on 2026-09-22 two of eight scans came back with Ethereum reading
// "alchemy failed: indexer unavailable" and every other chain fine. The route
// reports that as an unreadable chain rather than an empty one, but the wallet
// hook replaced its rows wholesale on every poll, so every Ethereum holding
// left the panel for ninety seconds and came back on the next poll. Nothing
// said why. This is the merge that keeps the previous rows for exactly the
// chains the new scan lost, and only those: a chain that was read is always
// taken from the new scan, including when it now holds nothing.
//
// Pure, so lib/trustware/scan-merge.test.ts pins it.

import type { EquivalentBalances } from "./balances";
import type { GoldHolding } from "./gold-holdings";
import type { NativeHolding } from "./native";
import type { OndoWalletHolding } from "./ondo-holdings";
import type { StableHolding } from "./stables";

export interface ScanRows extends EquivalentBalances {
  native: NativeHolding[];
  stables: StableHolding[];
  ondo: OndoWalletHolding[];
  gold: GoldHolding[];
}

// Ondo collateral is selected from Ethereum only (lib/trustware/ondo-holdings).
const ETHEREUM = "1";

const CHAIN_LABELS: Record<string, string> = {
  "1": "Ethereum",
  "56": "BNB Chain",
  "8453": "Base",
  "solana-mainnet-beta": "Solana",
  // The route's label when the whole EVM-side request failed rather than
  // one chain inside it.
  evm: "your Ethereum-side chains",
};

// Whether an unreadable entry's chain covers a holding's chain. The route
// names a single chain when Trustware answered but that chain failed, and
// "evm" when the request for the EVM address failed outright, which covers
// every numeric chain id.
function covers(unreadable: string, chain: string): boolean {
  if (unreadable === chain) return true;
  return unreadable === "evm" && /^\d+$/.test(chain);
}

export function carryUnreadableChains(
  previous: ScanRows | null,
  next: ScanRows,
): ScanRows {
  if (!previous || next.unreadableChains.length === 0) return next;
  const lost = (chain: string) =>
    next.unreadableChains.some((u) => covers(u.chain, chain));
  const merge = <T>(prev: T[], cur: T[], chainOf: (row: T) => string): T[] => [
    ...cur.filter((row) => !lost(chainOf(row))),
    ...prev.filter((row) => lost(chainOf(row))),
  ];
  return {
    ...next,
    held: merge(previous.held, next.held, (r) => r.source.chain),
    native: merge(previous.native, next.native, (r) => r.chain),
    stables: merge(previous.stables, next.stables, (r) => r.chain),
    ondo: merge(previous.ondo, next.ondo, () => ETHEREUM),
    gold: merge(previous.gold, next.gold, (r) => r.source.chain),
  };
}

// One sentence naming the chains a scan could not read, for the wallet panel.
export function describeUnreadableChains(
  unreadable: { chain: string }[],
): string | null {
  if (unreadable.length === 0) return null;
  const names = [...new Set(unreadable.map((u) => CHAIN_LABELS[u.chain] ?? u.chain))];
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Could not read your balances on ${list} just now. The figures shown for it are from the last read that worked.`;
}
