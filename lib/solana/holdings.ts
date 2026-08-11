// Holdings grouped by the equity they represent.
//
// A user can hold the same company through two different mints: the Backed
// xStock the app trades (TSLAx) and Ondo's Solana issuance (TSLAon). They are
// the same underlying position, so the wallet shows one Tesla line with the
// combined value and breaks it into its parts on demand.
//
// The two mints price independently on Solana, and the gap has been several
// percent on thin liquidity. The group total is the sum of what each part is
// worth at its own price, which is what the wallet could actually realise. The
// breakdown carries each part's own value so that gap stays visible.

import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS } from "@/lib/jupiter/xstocks";
import type { HeldEquivalent } from "@/lib/trustware/planner";
import type { NativeHolding } from "@/lib/trustware/native";
import { nativeUiAmount } from "@/lib/trustware/native";
import { totalAccountUsd } from "./balances";
import type { AccountBalances } from "./balances";
import { SOLANA_EQUIVALENT_TOKENS } from "./equivalent-tokens";

export interface HoldingPart {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  usd: number | null;
  logo?: string;
  // True for the Backed xStock the app trades and deposits directly. False for
  // an Ondo mint, which has to be converted before it can be used.
  direct: boolean;
  // Only meaningful when direct is false: whether a conversion route exists.
  convertible: boolean;
  // Where it lives. Solana unless the holding came from the cross-chain scan.
  chainLabel: string;
}

export interface HoldingGroup {
  // The xStock mint the group is keyed on.
  key: string;
  // Ticker without the issuer suffix, e.g. TSLA.
  symbol: string;
  name: string;
  logo?: string;
  // Units summed across the parts. They track the same equity one for one, so
  // the sum is the position size.
  amount: number;
  // Sum of each part valued at its own price. Null when no part could be priced.
  usd: number | null;
  parts: HoldingPart[];
}

function usdOf(
  amount: number,
  mint: string,
  prices: JupiterPriceMap | null,
): number | null {
  const price = prices?.[mint]?.usdPrice;
  return price != null ? amount * price : null;
}

// Every equity the wallet holds anything of, in catalog order. Groups with a
// zero total are dropped, as are individual parts with a zero balance.
export function groupHoldings(
  balances: AccountBalances | null,
  prices: JupiterPriceMap | null,
  // Same-underlying holdings on other chains, from the Trustware scan. Priced
  // off their Solana twin: the registry only holds strict 1:1 equivalents, so
  // one TSLAon on Ethereum is one TSLAon on Solana for valuation.
  crossChain: HeldEquivalent[] = [],
): HoldingGroup[] {
  if (!balances) return [];
  const groups: HoldingGroup[] = [];

  for (const xstock of XSTOCKS) {
    const parts: HoldingPart[] = [];

    const direct = balances.xstocks[xstock.mint] ?? 0;
    if (direct > 0) {
      parts.push({
        mint: xstock.mint,
        symbol: xstock.symbol,
        name: xstock.name,
        amount: direct,
        usd: usdOf(direct, xstock.mint, prices),
        logo: xstock.logo,
        direct: true,
        convertible: true,
        chainLabel: "Solana",
      });
    }

    for (const token of SOLANA_EQUIVALENT_TOKENS) {
      if (token.xstockMint !== xstock.mint) continue;
      const amount = balances.equivalents[token.mint] ?? 0;
      if (amount <= 0) continue;
      parts.push({
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        amount,
        usd: usdOf(amount, token.mint, prices),
        logo: token.logo,
        direct: false,
        convertible: token.convertible,
        chainLabel: "Solana",
      });
    }

    for (const held of crossChain) {
      if (held.source.kind === "solana") continue; // already counted above
      const twin = SOLANA_EQUIVALENT_TOKENS.find(
        (t) => t.symbol === held.source.symbol && t.xstockMint === xstock.mint,
      );
      // An EVM xStock has no Solana twin of its own; it is the same asset as the
      // catalog entry, so it prices off that.
      const priceMint = twin?.mint ?? xstock.mint;
      if (!twin && held.source.symbol !== xstock.symbol) continue;
      const amount =
        Number(held.balanceAtomic) / 10 ** held.source.decimals;
      if (amount <= 0) continue;
      parts.push({
        mint: `${held.source.chain}:${held.source.token}`,
        symbol: held.source.symbol,
        name: xstock.name,
        amount,
        usd: usdOf(amount, priceMint, prices),
        logo: xstock.logo,
        direct: false,
        convertible: true,
        chainLabel: held.source.chainLabel,
      });
    }

    if (parts.length === 0) continue;

    const priced = parts.filter((p) => p.usd != null);
    groups.push({
      key: xstock.mint,
      // "AAPLx" -> "AAPL". The group is the equity, not one issuer's wrapper.
      symbol: xstock.symbol.replace(/x$/, ""),
      name: xstock.name,
      logo: xstock.logo,
      amount: parts.reduce((sum, p) => sum + p.amount, 0),
      usd: priced.length
        ? priced.reduce((sum, p) => sum + (p.usd ?? 0), 0)
        : null,
      parts,
    });
  }

  return groups;
}

// Everything the account is worth, across every chain it holds on.
//
// totalAccountUsd covers Solana alone. This adds the cross-chain equity
// holdings, priced off their Solana twin, and the native gas balances, priced
// from the native feed. Anything that cannot be priced contributes nothing
// rather than guessing, so the figure only ever understates.
export function totalPortfolioUsd(
  balances: AccountBalances | null,
  prices: JupiterPriceMap | null,
  crossChain: HeldEquivalent[],
  native: NativeHolding[],
  nativePrices: Record<string, number>,
): number | null {
  const solana = totalAccountUsd(balances, prices);
  if (solana == null) return null;

  let total = solana;

  for (const held of crossChain) {
    // Solana-side equivalents are already inside totalAccountUsd.
    if (held.source.kind === "solana") continue;
    const twin = SOLANA_EQUIVALENT_TOKENS.find(
      (t) => t.symbol === held.source.symbol,
    );
    const price = twin ? prices?.[twin.mint]?.usdPrice : undefined;
    if (!price) continue;
    total += (Number(held.balanceAtomic) / 10 ** held.source.decimals) * price;
  }

  for (const holding of native) {
    const price = nativePrices[holding.priceId];
    if (!price) continue;
    total += nativeUiAmount(holding) * price;
  }

  return total;
}
