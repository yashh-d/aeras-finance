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

import { SOL_MINT } from "@/lib/jupiter/constants";
import type { JupiterPriceMap } from "@/lib/jupiter/prices";
import { XSTOCKS, xstockByMint } from "@/lib/jupiter/xstocks";
import type { HeldEquivalent } from "@/lib/trustware/planner";
import type { NativeHolding } from "@/lib/trustware/native";
import { nativeUiAmount } from "@/lib/trustware/native";
import type { StableHolding } from "@/lib/trustware/stables";
import { stableUiAmount } from "@/lib/trustware/stables";
import {
  ondoHoldingUiAmount,
  type OndoWalletHolding,
} from "@/lib/trustware/ondo-holdings";
import { unwindTargetFor } from "@/lib/ondo/unwind";
import type { AccountBalances } from "./balances";
import {
  SOLANA_EQUIVALENT_TOKENS,
  equivalentTokenByMint,
} from "./equivalent-tokens";

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

// ── The account, enumerated once ───────────────────────────────────────────
//
// Every priced thing the account holds, one entry per asset per chain. The
// header total is the sum of this list, and every surface that draws rows draws
// them from it, so a balance can no longer be shown in a list and missing from
// the total. That has now happened three times (off-Solana USDC, Ondo on
// Ethereum, and the whole Portfolio tab reading a Solana-only total), each time
// because a second copy of the sum was written next to the rows instead of
// derived from them.
//
// Anything that cannot be priced is left out rather than counted at zero, so
// the figure only ever understates.

export type HoldingKind = "stable" | "native" | "stock";

export interface PortfolioHolding {
  // Unique across the list. Chain-scoped, because the same symbol is genuinely
  // held on several chains and a symbol alone collides (USDC, ETH).
  key: string;
  symbol: string;
  name: string;
  chainLabel: string;
  amount: number;
  usd: number;
  kind: HoldingKind;
  // The curated xStock mint whose price history this holding follows, when one
  // exists. /api/jupiter/chart only serves the curated catalog, so this is the
  // mint a trend line can actually fetch, which is not always the mint the
  // holding was priced at: TSLAon has its own price but no chart, and it tracks
  // TSLAx one for one. Undefined means "no history available", which covers
  // dollar-denominated balances (correctly flat) and EVM gas (a real gap).
  chartMint?: string;
}

export function portfolioHoldings(
  balances: AccountBalances | null,
  prices: JupiterPriceMap | null,
  crossChain: HeldEquivalent[] = [],
  native: NativeHolding[] = [],
  nativePrices: Record<string, number> = {},
  // Ondo collateral withdrawn to the user's Ethereum wallet. Kept apart from
  // `crossChain` for the reason lib/trustware/ondo-holdings.ts gives: most Ondo
  // margin tokens have no borrow vault and so are not convertible equivalents.
  ondo: OndoWalletHolding[] = [],
  // USDC held off Solana. Monad USDC is deliberately absent and is appended by
  // the caller from its own read, so there is no double count.
  stables: StableHolding[] = [],
): PortfolioHolding[] {
  const out: PortfolioHolding[] = [];

  if (balances) {
    if (balances.usdc > 0) {
      out.push({
        key: "solana:USDC",
        symbol: "USDC",
        name: "US Dollar",
        chainLabel: "Solana",
        amount: balances.usdc,
        usd: balances.usdc,
        kind: "stable",
      });
    }

    const solPrice = prices?.[SOL_MINT]?.usdPrice;
    if (solPrice && balances.sol > 0) {
      out.push({
        key: "solana:SOL",
        symbol: "SOL",
        name: "Solana",
        chainLabel: "Solana",
        amount: balances.sol,
        usd: balances.sol * solPrice,
        kind: "native",
      });
    }

    for (const [mint, amount] of Object.entries(balances.xstocks)) {
      const price = prices?.[mint]?.usdPrice;
      if (!price || amount <= 0) continue;
      const meta = xstockByMint(mint);
      out.push({
        key: mint,
        symbol: meta?.symbol ?? mint.slice(0, 4),
        name: meta?.name ?? "Tokenized asset",
        chainLabel: "Solana",
        amount,
        usd: amount * price,
        kind: "stock",
        chartMint: meta ? mint : undefined,
      });
    }

    // Ondo's Solana mints. Not tradable here, but the value is in the wallet
    // either way, and omitting it makes the total disagree with the rows.
    for (const [mint, amount] of Object.entries(balances.equivalents)) {
      const price = prices?.[mint]?.usdPrice;
      if (!price || amount <= 0) continue;
      const meta = equivalentTokenByMint(mint);
      out.push({
        key: mint,
        symbol: meta?.symbol ?? mint.slice(0, 4),
        name: meta?.name ?? "Tokenized asset",
        chainLabel: "Solana",
        amount,
        usd: amount * price,
        kind: "stock",
        // Its own mint has no chart. It tracks the xStock one for one, so the
        // xStock's curve is the honest shape for it.
        chartMint: meta?.xstockMint,
      });
    }
  }

  for (const held of crossChain) {
    // Solana-side equivalents came out of `balances.equivalents` above.
    if (held.source.kind === "solana") continue;
    // The registry lists both issuers on EVM: Ondo's TSLAon, which has a Solana
    // twin to price off, and Backed's TSLAx, which does not because the Solana
    // xStock IS that asset. Looking only for a twin dropped every xStock-issued
    // EVM holding from the total while groupHoldings rendered it as a row.
    const twin = SOLANA_EQUIVALENT_TOKENS.find(
      (t) => t.symbol === held.source.symbol,
    );
    const xstock = twin
      ? undefined
      : XSTOCKS.find((x) => x.symbol === held.source.symbol);
    const priceMint = twin?.mint ?? xstock?.mint;
    const price = priceMint ? prices?.[priceMint]?.usdPrice : undefined;
    if (!price) continue;
    const amount = Number(held.balanceAtomic) / 10 ** held.source.decimals;
    if (amount <= 0) continue;
    out.push({
      key: `${held.source.chain}:${held.source.token}`,
      symbol: held.source.symbol,
      name: twin?.name ?? xstock?.name ?? "Tokenized asset",
      chainLabel: held.source.chainLabel,
      amount,
      usd: amount * price,
      kind: "stock",
      chartMint: xstock?.mint ?? twin?.xstockMint,
    });
  }

  for (const holding of native) {
    const price = nativePrices[holding.priceId];
    const amount = nativeUiAmount(holding);
    if (!price || amount <= 0) continue;
    out.push({
      key: `${holding.chain}:${holding.symbol}`,
      symbol: holding.symbol,
      name: "Gas",
      chainLabel: holding.chainLabel,
      amount,
      usd: amount * price,
      kind: "native",
    });
  }

  // Priced off the matching Solana xStock: SPCXon and SPCXx track the same
  // underlying, and the mint is what this app has a price feed for.
  for (const holding of ondo) {
    const target = unwindTargetFor(holding.symbol);
    if (!target) continue;
    const price = prices?.[target.mint]?.usdPrice;
    const amount = ondoHoldingUiAmount(holding);
    if (!price || amount <= 0) continue;
    out.push({
      key: `1:${holding.contractAddress}`,
      symbol: holding.symbol,
      name: xstockByMint(target.mint)?.name ?? "Tokenized asset",
      chainLabel: "Ethereum",
      amount,
      usd: amount * price,
      kind: "stock",
      chartMint: target.mint,
    });
  }

  // USDC is dollar denominated, so the balance is the USD figure. No price feed
  // to miss and nothing to understate.
  for (const stable of stables) {
    const amount = stableUiAmount(stable);
    if (amount <= 0) continue;
    out.push({
      key: `${stable.chain}:${stable.symbol}`,
      symbol: stable.symbol,
      name: "US Dollar",
      chainLabel: stable.chainLabel,
      amount,
      usd: amount,
      kind: "stable",
    });
  }

  return out;
}

export function sumHoldingsUsd(holdings: PortfolioHolding[]): number {
  return holdings.reduce((sum, h) => sum + h.usd, 0);
}

// Everything the account is worth on Solana and on the chains the Trustware
// scan reads. Monad and Lighter sit outside that scan and are added by the
// caller from its own read.
//
// Deliberately the sum of portfolioHoldings rather than its own walk over the
// same inputs: the two drifting apart is the bug this file keeps growing
// comments about.
export function totalPortfolioUsd(
  balances: AccountBalances | null,
  prices: JupiterPriceMap | null,
  crossChain: HeldEquivalent[],
  native: NativeHolding[],
  nativePrices: Record<string, number>,
  ondo: OndoWalletHolding[] = [],
  stables: StableHolding[] = [],
): number | null {
  if (!balances) return null;
  return sumHoldingsUsd(
    portfolioHoldings(
      balances,
      prices,
      crossChain,
      native,
      nativePrices,
      ondo,
      stables,
    ),
  );
}
