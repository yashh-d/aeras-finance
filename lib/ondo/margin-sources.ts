import { XSTOCKS } from "@/lib/jupiter/xstocks";
import type { HeldEquivalent } from "@/lib/trustware/planner";
import type { StableHolding } from "@/lib/trustware/stables";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";

import { collateralBySymbol, type OndoCollateral } from "./collateral";
import { hedgeRouteFor } from "./hedge";

// Everything the user holds that can become Ondo margin, wherever it is.
//
// Ondo credits exactly two kinds of thing: USDC, and its own tokenized
// equities, both on Ethereum. The user holds neither of those, generally. They
// hold USDC on Solana, or SPYx on Solana, or USDC on BNB Chain. This module is
// the map between the two, and it exists so the perps surface can offer "add
// margin" against a wallet rather than asking someone to work out that their
// SPYx has to become SPYon on a chain they have never used.
//
// Two mappings, and they are not symmetrical:
//
//   USDC anywhere -> USDC on Ethereum. No haircut, no cap, no basis risk. It is
//   the best margin on the venue and the default this ranks first.
//
//   A tokenized equity -> the Ondo token for the same underlying, when Ondo
//   credits one. SPYx becomes SPYon; AAPLx becomes nothing, because Ondo does
//   not accept AAPLon as margin even though AAPL-USD.P is a live market. The
//   route table already knows which underlyings have a collateral token, so
//   that answer is read from it rather than restated here.
//
// Pure. What can actually be signed today is a separate question, answered by
// `executable` below rather than by dropping the source from the list: telling
// someone they have nothing when their money is one chain away is the wrong
// answer, and it is the one lib/lighter/use-margin-funding.ts was rewritten to
// stop giving.

export type MarginSourceKind = "usdc" | "equity";

export interface OndoMarginSource {
  // Stable across refreshes so a selection survives the scan reloading.
  id: string;
  kind: MarginSourceKind;
  chain: string;
  chainLabel: string;
  token: string;
  symbol: string;
  decimals: number;
  balanceAtomic: string;
  // Null when nothing prices this holding. The source is still offered; the
  // amount is just entered rather than defaulted.
  balanceUsd: number | null;
  // The Ondo collateral asset this becomes.
  target: OndoCollateral;
  // Whether the source leg can be signed today. Solana sources can: one
  // signature, no gas, no chain switch. An EVM source needs an allowance and a
  // chain switch, which lib/trustware/execute.ts owns and lib/ondo/fund.ts does
  // not yet call.
  executable: boolean;
}

export interface MarginSourceInput {
  // Solana USDC, atomic. Not the float field: a rounded-up balance sizes a
  // transfer the wallet cannot cover.
  solanaUsdcAtomic: string;
  // Solana xStock balances keyed by mint, atomic.
  xstocksAtomic: Record<string, string | undefined>;
  // USD price per xStock mint, for ranking and for a Max button.
  priceUsdByMint: Record<string, number | undefined>;
  // USDC held off Solana, per chain.
  stables: StableHolding[];
  // Tokenized equities held off Solana, from the equivalence registry.
  held: HeldEquivalent[];
  // What Ondo credits right now, from the live token config.
  collateral: OndoCollateral[];
}

const USDC_DECIMALS = 6;
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function marginSources(input: MarginSourceInput): OndoMarginSource[] {
  const usdc = collateralBySymbol(input.collateral, "USDC");
  const sources: OndoMarginSource[] = [];

  // 1. Solana USDC. The common case and the cheapest route: no haircut on the
  // destination and the shortest bridge.
  if (usdc && BigInt(input.solanaUsdcAtomic || "0") > 0n) {
    sources.push({
      id: "usdc:solana",
      kind: "usdc",
      chain: TRUSTWARE_SOLANA_CHAIN,
      chainLabel: "Solana",
      token: SOLANA_USDC_MINT,
      symbol: "USDC",
      decimals: USDC_DECIMALS,
      balanceAtomic: input.solanaUsdcAtomic,
      balanceUsd: Number(input.solanaUsdcAtomic) / 10 ** USDC_DECIMALS,
      target: usdc,
      executable: true,
    });
  }

  // 2. USDC anywhere else. Same destination, longer leg.
  if (usdc) {
    for (const stable of input.stables) {
      if (BigInt(stable.balanceAtomic || "0") <= 0n) continue;
      sources.push({
        id: `usdc:${stable.chain}:${stable.contract}`,
        kind: "usdc",
        chain: stable.chain,
        chainLabel: stable.chainLabel,
        token: stable.contract,
        symbol: stable.symbol,
        decimals: stable.decimals,
        balanceAtomic: stable.balanceAtomic,
        // Decimals are pinned per chain in the stables registry and matched by
        // contract address, never by symbol. Binance-peg USDC on BNB Chain is
        // 18 decimals, and reading it at 6 reports 250 USDC as 250 trillion.
        balanceUsd: Number(stable.balanceAtomic) / 10 ** stable.decimals,
        target: usdc,
        executable: false,
      });
    }
  }

  // 3. xStocks on Solana. The distinctive path: the stock pays for its own
  // margin instead of being sold to fund one.
  for (const xstock of XSTOCKS) {
    const atomic = input.xstocksAtomic[xstock.mint];
    if (!atomic || BigInt(atomic) <= 0n) continue;

    const target = collateralFor(xstock.symbol, input.collateral);
    if (!target) continue;

    const price = input.priceUsdByMint[xstock.mint];
    const quantity = Number(atomic) / 10 ** xstock.decimals;

    sources.push({
      id: `equity:solana:${xstock.mint}`,
      kind: "equity",
      chain: TRUSTWARE_SOLANA_CHAIN,
      chainLabel: "Solana",
      token: xstock.mint,
      symbol: xstock.symbol,
      decimals: xstock.decimals,
      balanceAtomic: atomic,
      balanceUsd: price === undefined ? null : quantity * price,
      target,
      executable: true,
    });
  }

  // 4. Tokenized equities held off Solana, including Ondo's own tokens. A user
  // already holding SPYon on Ethereum is one short hop from posting it.
  for (const equivalent of input.held) {
    if (BigInt(equivalent.balanceAtomic || "0") <= 0n) continue;

    const target = collateralFor(equivalent.source.symbol, input.collateral);
    if (!target) continue;

    sources.push({
      id: `equity:${equivalent.source.chain}:${equivalent.source.token}`,
      kind: "equity",
      chain: equivalent.source.chain,
      chainLabel: equivalent.source.chainLabel,
      token: equivalent.source.token,
      symbol: equivalent.source.symbol,
      decimals: equivalent.source.decimals,
      balanceAtomic: equivalent.balanceAtomic,
      // The registry does not carry a price, and marking an equity at its Ondo
      // collateral price would be wrong for a proxy route. Left null.
      balanceUsd: null,
      target,
      executable: equivalent.source.kind === "solana",
    });
  }

  return sources.sort(rank);
}

// Which Ondo collateral a holding becomes.
//
// Read through the hedge route table rather than by stripping suffixes, so
// there is one place in the repo that decides SPY has a collateral token and
// AAPL does not. A symbol like "SPYon" or "SPYx" resolves through its xStock
// form, which is what the table is keyed on.
function collateralFor(
  symbol: string,
  collateral: OndoCollateral[],
): OndoCollateral | undefined {
  const xstockSymbol = symbol.endsWith("on")
    ? `${symbol.slice(0, -2)}x`
    : symbol;

  const route = hedgeRouteFor(xstockSymbol);
  if (!route?.collateralSymbol) return undefined;

  return collateralBySymbol(collateral, route.collateralSymbol);
}

// USDC first, then what can be signed today, then by size.
//
// USDC leads because it is genuinely the better margin, not because it is
// simpler: no haircut, no per-asset cap, and no correlation between the
// collateral and the position it backs. Posting SPYon against a SPY short means
// a rally hits the margin from both sides.
function rank(a: OndoMarginSource, b: OndoMarginSource): number {
  if (a.kind !== b.kind) return a.kind === "usdc" ? -1 : 1;
  if (a.executable !== b.executable) return a.executable ? -1 : 1;
  return (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0);
}

// The source to offer by default: the largest thing that can actually be signed
// today, preferring USDC. Undefined when the wallet holds nothing usable.
export function bestMarginSource(
  sources: OndoMarginSource[],
): OndoMarginSource | undefined {
  return sources.find((s) => s.executable && (s.balanceUsd ?? 0) > 0);
}

// Value the user could post without touching anything off Solana, which is the
// number that decides whether "add margin" is a one-click action or a bridge.
export function readyMarginUsd(sources: OndoMarginSource[]): number {
  return sources
    .filter((s) => s.executable)
    .reduce((sum, s) => sum + (s.balanceUsd ?? 0), 0);
}
