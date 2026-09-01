// Every wallet balance that can become Lighter margin, ranked by what it
// actually costs the user to move.
//
// This replaces the old model in lib/lighter/funding.ts, which recognised
// exactly one spendable source (Solana USDC) and told the user to move
// everything else by hand. That instruction was never as cheap as it sounded:
// "move it to your Solana wallet" is itself a bridge, so it pays a spread AND
// leaves the user to start the deposit again afterwards. Routing straight to
// Lighter costs one leg instead of two.
//
// Two destinations, and the difference is the whole ranking:
//
//   solana-cctp   An SPL transfer to the intent account Lighter derives on
//                 Solana. No bridge, no spread, no gas beyond a Solana fee.
//                 Free, and slow: Solana finality plus Circle attestation is 15
//                 to 20 minutes.
//   arbitrum      Trustware routes any USDC to the intent address Lighter
//                 derives on Arbitrum. Costs a spread, settles in minutes.
//                 Solana sources sign once on Solana and never touch gas; EVM
//                 sources sign an approve and a bridge on their own chain and
//                 must pay that chain's gas.
//
// COST IS NOT THE SPREAD ALONE. Measured 2026-08-31, all to Lighter's real
// Arbitrum intent address at a $20 size:
//
//   Solana     25 bps   lifi    no source gas
//   Base       36 bps   squid   Base gas, cents
//   BNB Chain  39 bps   squid   BNB gas, cents
//   Ethereum   40 bps   squid   mainnet gas, dollars
//
// The spread is not flat in size. At $5 the Solana road costs 63 bps, because
// the fixed component dominates; it settles to 25 by $20. The minimum deposit
// is $5, so the worst case a user can actually hit is that first row.
//
// On a $20 deposit, 40 bps is 8 cents and the Ethereum approve-plus-bridge is
// worth more than that several times over. So an EVM source is ranked by its
// gas class first and its spread second, which is why Ethereum sorts last
// despite quoting close to Base. Ranking on bps alone would recommend the most
// expensive road in the list.
//
// The bps figures here are PLANNING estimates used for ordering and for the
// copy on the card. They are never used to size a deposit: the real number
// comes from the route response at pay time, and lib/lighter/margin-fund.ts
// refuses anything past MAX_MARGIN_LOSS_BPS.

import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import type { StableHolding } from "@/lib/trustware/stables";
import { stableUiAmount } from "@/lib/trustware/stables";

import { LIGHTER_MIN_CCTP_DEPOSIT_USDC } from "./constants";

// Lighter's own floor for a bridged deposit, in USDC. Higher than the CCTP
// figure because the bridge path distinguishes a new account from an existing
// one ($5 against $3) and a plan cannot tell which the user is. Under-sizing
// does not fail loudly, it simply never credits.
export const LIGHTER_MIN_BRIDGE_DEPOSIT_USDC = 5;

// Where the USDC is delivered.
export type MarginDestination = "solana-cctp" | "arbitrum";

// What the user has to do with their own keys, which is the part they feel.
export type SigningCost =
  // One Solana signature. No gas token to hold, nothing to top up.
  | "solana-only"
  // An ERC-20 approve plus a bridge on the source chain, paid in that chain's
  // native token. `gasChain` names what they need to hold.
  | "evm-approve-and-send";

export interface MarginSource {
  // Stable identity for React keys and for the selected-source state.
  id: string;
  // Trustware chain id: "solana-mainnet-beta" or a numeric EVM chain string.
  chain: string;
  chainLabel: string;
  // Token contract, or the Solana mint.
  token: string;
  decimals: number;
  balanceAtomic: string;
  // USDC is dollar denominated, so the balance IS the USD figure. Carried
  // explicitly because the card ranks, sums and formats on it.
  amountUsd: number;
  destination: MarginDestination;
  signing: SigningCost;
  // Native token the user must hold to sign, for EVM sources only.
  gasToken?: string;
  // Planning spread in basis points. 0 for the CCTP transfer, which is not a
  // bridge. See the measurement table above.
  plannedLossBps: number;
  // Upper end of the credit window, in minutes. Upper rather than typical: a
  // user deciding between roads should compare the bad cases.
  etaMinutes: number;
  // Lighter's floor for this road.
  minimumUsd: number;
  // False when the balance cannot clear this road's minimum on its own.
  usable: boolean;
}

// Ranking weight per source, lowest first. Gas class dominates the spread
// because it dominates the actual bill at the sizes this card sees; see the
// note at the top of the file.
//
// The free-but-slow CCTP road is deliberately NOT rank 0. It costs nothing and
// takes 15 to 20 minutes, and a user opening a hedge is choosing between being
// unhedged for 20 minutes and paying 5 cents. The Arbitrum road off the same
// Solana balance wins that trade, so it leads and CCTP sits just behind it as
// the free alternative.
// Ethereum sorts last despite quoting within a few bps of Base and BNB: its
// mainnet gas is the dominant cost at these sizes, and the other two are cents.
const RANK: Record<string, number> = {
  "solana-mainnet-beta:arbitrum": 0,
  "solana-mainnet-beta:solana-cctp": 1,
  "8453:arbitrum": 2,
  "56:arbitrum": 3,
  "1:arbitrum": 4,
};

function rankOf(source: MarginSource): number {
  return RANK[`${source.chain}:${source.destination}`] ?? 99;
}

// Chains Trustware can route USDC to Arbitrum from, with the spread each was
// measured at by scripts/lighter-margin-sources-check.mts on 2026-08-31.
//
// BNB Chain is here on the second measurement, not the first. The first run
// reported it unroutable at every size, which was wrong: BNB's USDC is 18
// decimals and the run was sizing it with 6, so it asked for dust and got no
// route. With the size built correctly it quotes 39 bps and returns a signable
// transaction at every size tested. The lesson is in stables.ts already
// ("assuming 6 everywhere would misread a BNB balance by a factor of a
// trillion") and it caught this file too.
const EVM_SOURCES: Record<
  string,
  { gasToken: string; plannedLossBps: number }
> = {
  "1": { gasToken: "ETH", plannedLossBps: 40 },
  "8453": { gasToken: "ETH", plannedLossBps: 36 },
  "56": { gasToken: "BNB", plannedLossBps: 39 },
};

// Solana USDC routed to Arbitrum. Measured flat at 25 bps from $5 to $100.
const SOLANA_BRIDGE_LOSS_BPS = 25;

export interface MarginSourcesInput {
  // Exact base units from AccountBalances.usdcAtomic, never the rounded float:
  // a rounded-up balance sizes a transfer the wallet cannot cover and the whole
  // deposit fails on chain.
  solanaUsdcAtomic: string;
  solanaUsdcMint: string;
  stables: StableHolding[];
}

// Every road the user could take right now, cheapest first.
//
// Pure over balances the caller already holds, so the card can state the
// position before anything is signed and the check script can exercise every
// branch without a wallet.
export function resolveMarginSources(
  input: MarginSourcesInput,
): MarginSource[] {
  const out: MarginSource[] = [];

  const solanaUsd = Number(input.solanaUsdcAtomic || "0") / 10 ** USDC_DECIMALS;
  if (solanaUsd > 0) {
    const common = {
      chain: "solana-mainnet-beta",
      chainLabel: "Solana",
      token: input.solanaUsdcMint,
      decimals: USDC_DECIMALS,
      balanceAtomic: input.solanaUsdcAtomic,
      amountUsd: solanaUsd,
      signing: "solana-only" as const,
    };
    out.push({
      ...common,
      id: "solana:arbitrum",
      destination: "arbitrum",
      plannedLossBps: SOLANA_BRIDGE_LOSS_BPS,
      etaMinutes: 5,
      minimumUsd: LIGHTER_MIN_BRIDGE_DEPOSIT_USDC,
      usable: solanaUsd >= LIGHTER_MIN_BRIDGE_DEPOSIT_USDC,
    });
    out.push({
      ...common,
      id: "solana:cctp",
      destination: "solana-cctp",
      plannedLossBps: 0,
      etaMinutes: 20,
      minimumUsd: LIGHTER_MIN_CCTP_DEPOSIT_USDC,
      usable: solanaUsd >= LIGHTER_MIN_CCTP_DEPOSIT_USDC,
    });
  }

  for (const holding of input.stables) {
    const entry = EVM_SOURCES[holding.chain];
    if (!entry) continue;
    const amountUsd = stableUiAmount(holding);
    if (amountUsd <= 0) continue;
    out.push({
      id: `${holding.chain}:arbitrum`,
      chain: holding.chain,
      chainLabel: holding.chainLabel,
      token: holding.contract,
      decimals: holding.decimals,
      balanceAtomic: holding.balanceAtomic,
      amountUsd,
      destination: "arbitrum",
      signing: "evm-approve-and-send",
      gasToken: entry.gasToken,
      plannedLossBps: entry.plannedLossBps,
      etaMinutes: 5,
      minimumUsd: LIGHTER_MIN_BRIDGE_DEPOSIT_USDC,
      usable: amountUsd >= LIGHTER_MIN_BRIDGE_DEPOSIT_USDC,
    });
  }

  return out.sort((a, b) => {
    const byRank = rankOf(a) - rankOf(b);
    if (byRank !== 0) return byRank;
    return b.amountUsd - a.amountUsd;
  });
}

// The road a deposit should take by default: the cheapest one that can actually
// carry this amount. Undefined when nothing can.
export function bestMarginSource(
  sources: MarginSource[],
  amountUsd: number,
): MarginSource | undefined {
  return sources.find(
    (s) => s.usable && amountUsd >= s.minimumUsd && amountUsd <= s.amountUsd,
  );
}

// Total USDC the user could post, counting every road. Each wallet balance is
// counted ONCE even though the Solana balance appears as two roads, or the
// figure would double-count Solana and overstate what the user has.
export function totalMarginableUsd(sources: MarginSource[]): number {
  const byChain = new Map<string, number>();
  for (const source of sources) {
    byChain.set(source.chain, Math.max(byChain.get(source.chain) ?? 0, source.amountUsd));
  }
  return [...byChain.values()].reduce((sum, v) => sum + v, 0);
}

// Why the user cannot post margin right now, if they cannot.
//
// Kept apart from the numbers so the card renders one sentence rather than
// reimplementing the precedence between "you have nothing", "you have some but
// not enough anywhere", and "you have enough but only on a chain you cannot pay
// gas on".
export type MarginBlock =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "below-minimum"; minimumUsd: number; bestUsd: number }
  | { kind: "needs-gas"; chainLabel: string; gasToken: string };

export function marginBlock(
  sources: MarginSource[],
  // Chains the wallet holds enough native token to sign on. EVM sources are
  // blocked without it: the embedded wallet is born with no gas, and an approve
  // the user cannot pay for is a dead end, not a deposit.
  gasReadyChains: ReadonlySet<string>,
): MarginBlock {
  if (sources.length === 0) return { kind: "empty" };

  const signable = sources.filter(
    (s) => s.usable && (s.signing === "solana-only" || gasReadyChains.has(s.chain)),
  );
  if (signable.length > 0) return { kind: "ok" };

  const usable = sources.filter((s) => s.usable);
  if (usable.length > 0) {
    // Everything big enough needs gas the wallet does not have.
    const blocked = usable[0];
    return {
      kind: "needs-gas",
      chainLabel: blocked.chainLabel,
      gasToken: blocked.gasToken ?? "ETH",
    };
  }

  const best = sources.reduce((a, b) => (b.amountUsd > a.amountUsd ? b : a));
  return {
    kind: "below-minimum",
    minimumUsd: best.minimumUsd,
    bestUsd: best.amountUsd,
  };
}
