// Where a user's Lighter margin can come from.
//
// Lighter margin is USDC only, so the question is never "what do you own", it is
// "where is your USDC and what has to happen before it can be posted". This
// module answers that as a pure function over balances the caller already has,
// so the panel can state the position before anything is signed and the check
// script can exercise every branch without a wallet.
//
// Two routes exist and the difference matters to the user:
//
//   solana-direct        USDC already in the Privy Solana wallet. One SPL
//                        transfer to the intent account. Seconds, no fee.
//   bridge-then-transfer USDC on another chain Lighter settles. Trustware
//                        settles it to the user's own Solana wallet first,
//                        then the same transfer runs.
//
// Only chains Lighter itself settles native USDC on are offered: Ethereum,
// Arbitrum, Base and Avalanche C-Chain, plus Solana. See LIGHTER_USDC_CHAINS.
// Note this is a narrower list than what Trustware could physically bridge
// from, and deliberately so: a balance shown as a funding source should be one
// this venue can hold, not merely one a bridge can move.
//
// The bridge deliberately lands in the user's own wallet rather than sending
// straight to Lighter's intent address. The intent address is a bare SPL token
// account owned by a PDA, and a router that derives an associated token address
// from its destination, which is the normal thing to do, would deliver the funds
// somewhere nobody can sign for. Routing through the user's own wallet keeps
// every intermediate state recoverable.

import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import type { StableHolding } from "@/lib/trustware/stables";

import { LIGHTER_MIN_CCTP_DEPOSIT_USDC } from "./constants";

// The chains Lighter settles native USDC on: Ethereum, Arbitrum, Base and
// Avalanche C-Chain, plus Solana. Keyed by Trustware chain id, which is what
// StableHolding carries.
//
// This is the venue's own list, not ours. LIGHTER_INTENT_CHAIN_IDS holds four
// of them (Solana, Arbitrum, Base, Avalanche); Ethereum is absent there only
// because createIntentAddress rejects it and it uses the direct deposit
// contract instead, so it belongs here all the same.
//
// BNB Chain is the one the stables registry scans that Lighter does not
// settle, and it is why this filter exists at all.
const LIGHTER_USDC_CHAINS: ReadonlySet<string> = new Set([
  // Ethereum mainnet.
  "1",
  // Arbitrum One.
  "42161",
  // Base.
  "8453",
  // Avalanche C-Chain.
  "43114",
]);

export type FundingRoute = "solana-direct" | "bridge-then-transfer";

export interface FundingSource {
  route: FundingRoute;
  // "solana" for the native wallet, otherwise the EVM chain id.
  chain: string;
  chainLabel: string;
  balanceAtomic: string;
  decimals: number;
  // USDC is dollar denominated, so the balance is the USD figure. Carried
  // explicitly anyway, because the panel ranks and sums on it.
  amountUsd: number;
}

export interface MarginFunding {
  // Spendable right now, no bridge.
  readyUsd: number;
  // Reachable, but a bridge has to settle first.
  bridgeableUsd: number;
  totalUsd: number;
  // Ready first, then largest bridgeable. Funding the cheapest route first is
  // both faster and cheaper, and it is what a user would pick by hand.
  sources: FundingSource[];
  // Below Lighter's minimum a deposit does not credit, so an amount that looks
  // spendable is not necessarily depositable.
  minimumUsd: number;
  canFundNow: boolean;
}

function toUsd(atomic: string, decimals: number): number {
  return Number(atomic) / 10 ** decimals;
}

export function resolveMarginFunding(input: {
  // Exact base units from AccountBalances.usdcAtomic, not the float field.
  solanaUsdcAtomic: string;
  stables: StableHolding[];
}): MarginFunding {
  const readyUsd = toUsd(input.solanaUsdcAtomic || "0", USDC_DECIMALS);

  const sources: FundingSource[] = [];
  if (readyUsd > 0) {
    sources.push({
      route: "solana-direct",
      chain: "solana",
      chainLabel: "Solana",
      balanceAtomic: input.solanaUsdcAtomic,
      decimals: USDC_DECIMALS,
      amountUsd: readyUsd,
    });
  }

  const bridgeable = input.stables
    .filter((holding) => LIGHTER_USDC_CHAINS.has(holding.chain))
    .map<FundingSource>((holding) => ({
      route: "bridge-then-transfer",
      chain: holding.chain,
      chainLabel: holding.chainLabel,
      balanceAtomic: holding.balanceAtomic,
      decimals: holding.decimals,
      amountUsd: toUsd(holding.balanceAtomic, holding.decimals),
    }))
    .filter((source) => source.amountUsd > 0)
    .sort((a, b) => b.amountUsd - a.amountUsd);

  sources.push(...bridgeable);

  const bridgeableUsd = bridgeable.reduce((sum, s) => sum + s.amountUsd, 0);

  return {
    readyUsd,
    bridgeableUsd,
    totalUsd: readyUsd + bridgeableUsd,
    sources,
    minimumUsd: LIGHTER_MIN_CCTP_DEPOSIT_USDC,
    // Only the Solana balance can satisfy this without a bridge settling first.
    canFundNow: readyUsd >= LIGHTER_MIN_CCTP_DEPOSIT_USDC,
  };
}

export type FundingBlock =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "bridge-first"; bridgeableUsd: number }
  | { kind: "below-minimum"; minimumUsd: number; readyUsd: number };

// Why the user cannot post margin right now, if they cannot.
//
// Separated from the numbers above so the panel renders one sentence rather than
// reimplementing the precedence between "you have nothing", "your money is on
// another chain" and "you have some but not enough".
export function fundingBlock(funding: MarginFunding): FundingBlock {
  if (funding.canFundNow) return { kind: "ok" };
  if (funding.totalUsd <= 0) return { kind: "empty" };
  if (funding.readyUsd < funding.minimumUsd && funding.bridgeableUsd > 0) {
    return { kind: "bridge-first", bridgeableUsd: funding.bridgeableUsd };
  }
  return {
    kind: "below-minimum",
    minimumUsd: funding.minimumUsd,
    readyUsd: funding.readyUsd,
  };
}
