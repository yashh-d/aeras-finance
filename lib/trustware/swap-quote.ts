// Pricing for the swap surface.
//
// One entry point, two engines, chosen by the pair:
//
//   Solana -> Solana   Jupiter's classic swap API. Trustware cannot execute this
//                      shape at all: its /route picks a provider per request and
//                      a `relay` selection returns no signable transaction, which
//                      scripts/trustware-solana-route-check.mts demonstrates.
//                      lib/jupiter/convert.ts already owns this path.
//   anything else      Trustware /quote, through our server proxy so the API key
//                      stays server-side.
//
// The one thing this module must not do is invent a price-impact number.
// planner.ts has a fallback that derives loss from unit parity when a quote
// omits its USD legs, and that is correct there because the equivalence registry
// holds strict 1:1 representations of the same underlying, so one TSLAon really
// should deliver one TSLAx. Here the two sides are different assets. One SOL is
// not one USDC, so the same fallback would report a 7,400% loss on a perfectly
// good quote. When the USD legs are missing, price impact is reported as null
// and the UI shows the rate and the fee instead of a fabricated percentage.
//
// Whether the USD legs are present is provider-dependent and not predictable
// from the pair: measured 2026-08-16, Solana USDC and SOL sources carried
// fromAmountUsd while Solana USDT, ETH and WBTC sources did not.

import {
  quoteSolanaConversion,
  type QuoteTransport,
} from "@/lib/jupiter/convert";
import { atomicToUi, toNumberOrNull, uiToAtomic } from "./amounts";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_SLIPPAGE,
} from "./constants";
import { isSamePair, solanaMintFor, type SwapToken } from "./swap-tokens";
import { extractEstimate, type TrustwareQuoteResponse } from "./types";

export interface SwapQuote {
  from: SwapToken;
  to: SwapToken;
  fromAmountAtomic: string;
  toAmountAtomic: string;
  // Guaranteed floor after slippage. This is the number to show as "minimum
  // received" and the number any downstream sizing must use.
  toAmountMinAtomic: string;
  fromAmountUi: string;
  toAmountUi: string;
  toAmountMinUi: string;
  // Destination units per source unit. Always computable from the amounts, so
  // this is the figure the UI can always show.
  rate: number;
  fromAmountUsd: number | null;
  toAmountUsd: number | null;
  totalFeesUsd: number | null;
  // Fraction of value lost end to end, e.g. 0.009 = 0.9%. Null when the quote
  // does not support computing it honestly. Never inferred from unit parity.
  priceImpactFraction: number | null;
  slippagePct: number;
  // Which engine priced it, for display and for picking the executor.
  engine: "jupiter" | "trustware";
}

// Post to our own proxy. Relative by default, which only resolves in the
// browser; scripts pass an absolute-URL fetcher instead.
export type TrustwareQuoteFn = (
  body: Record<string, unknown>,
) => Promise<TrustwareQuoteResponse>;

const proxyQuote: TrustwareQuoteFn = async (body) => {
  const res = await fetch("/api/trustware/quote", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as TrustwareQuoteResponse;
  if (!res.ok) {
    throw new Error(parsed.error ?? `Swap quote failed: ${res.status}`);
  }
  return parsed;
};

export interface QuoteSwapInput {
  from: SwapToken;
  to: SwapToken;
  // What the user typed into the amount field.
  amountUi: string;
  // Both addresses are required by Trustware even for a read-only quote.
  fromAddress: string;
  toAddress: string;
  slippagePct?: number;
  fetchTrustware?: TrustwareQuoteFn;
  // Override Jupiter's transport, for scripts with no window.
  jupiterTransport?: QuoteTransport;
}

function rateOf(quote: {
  fromAmountAtomic: string;
  toAmountAtomic: string;
  from: SwapToken;
  to: SwapToken;
}): number {
  const inUi = Number(atomicToUi(quote.fromAmountAtomic, quote.from.decimals));
  const outUi = Number(atomicToUi(quote.toAmountAtomic, quote.to.decimals));
  return inUi > 0 ? outUi / inUi : 0;
}

export async function quoteSwap(input: QuoteSwapInput): Promise<SwapQuote> {
  const { from, to, amountUi } = input;
  if (isSamePair(from, to)) {
    throw new Error("Pick two different tokens.");
  }
  const fromAmountAtomic = uiToAtomic(amountUi, from.decimals);
  if (BigInt(fromAmountAtomic) <= 0n) {
    throw new Error("Enter an amount.");
  }

  return from.kind === "solana" && to.kind === "solana"
    ? quoteViaJupiter(input, fromAmountAtomic)
    : quoteViaTrustware(input, fromAmountAtomic);
}

async function quoteViaJupiter(
  input: QuoteSwapInput,
  fromAmountAtomic: string,
): Promise<SwapQuote> {
  const { from, to } = input;
  const slippagePct = input.slippagePct ?? TRUSTWARE_SOLANA_SLIPPAGE;
  const quote = await quoteSolanaConversion({
    inputMint: solanaMintFor(from),
    inputDecimals: from.decimals,
    outputMint: solanaMintFor(to),
    outputDecimals: to.decimals,
    amountAtomic: fromAmountAtomic,
    slippageBps: Math.round(slippagePct * 100),
    transport: input.jupiterTransport,
  });

  return finish({
    from,
    to,
    fromAmountAtomic,
    toAmountAtomic: quote.toAmountAtomic,
    toAmountMinAtomic: quote.toAmountMinAtomic,
    fromAmountUsd: quote.fromAmountUsd,
    toAmountUsd: quote.toAmountUsd,
    totalFeesUsd: null,
    // Jupiter reports a real price impact for the pair it routed, so this one
    // does not need the USD legs at all. It is a percent, not a fraction.
    priceImpactFraction:
      quote.priceImpactPct === null ? null : quote.priceImpactPct / 100,
    slippagePct,
    engine: "jupiter",
  });
}

async function quoteViaTrustware(
  input: QuoteSwapInput,
  fromAmountAtomic: string,
): Promise<SwapQuote> {
  const { from, to } = input;
  const slippagePct = input.slippagePct ?? TRUSTWARE_DEFAULT_SLIPPAGE;
  const fetchQuote = input.fetchTrustware ?? proxyQuote;

  const res = await fetchQuote({
    fromChain: from.chain,
    toChain: to.chain,
    fromToken: from.address,
    toToken: to.address,
    fromAmount: fromAmountAtomic,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    slippage: slippagePct,
  });

  const estimate = extractEstimate(res);
  if (!estimate?.toAmount) {
    throw new Error("No route is available for this pair right now.");
  }

  // Not every route echoes a minimum. Falling back to toAmount would present an
  // optimistic number as a guarantee, so derive a floor from the slippage.
  const toAmountMinAtomic =
    estimate.toAmountMin ??
    (
      (BigInt(estimate.toAmount) * BigInt(Math.round((100 - slippagePct) * 100))) /
      10_000n
    ).toString();

  const fromAmountUsd = toNumberOrNull(estimate.fromAmountUsd);
  const toAmountUsd = toNumberOrNull(estimate.toAmountUsd);

  return finish({
    from,
    to,
    fromAmountAtomic,
    toAmountAtomic: estimate.toAmount,
    toAmountMinAtomic,
    fromAmountUsd,
    toAmountUsd,
    totalFeesUsd: toNumberOrNull(estimate.totalFeesUsd),
    // Only when both legs are priced. See the module header for why there is no
    // unit-parity fallback here.
    priceImpactFraction:
      fromAmountUsd && toAmountUsd && fromAmountUsd > 0
        ? (fromAmountUsd - toAmountUsd) / fromAmountUsd
        : null,
    slippagePct,
    engine: "trustware",
  });
}

function finish(
  q: Omit<SwapQuote, "fromAmountUi" | "toAmountUi" | "toAmountMinUi" | "rate">,
): SwapQuote {
  return {
    ...q,
    fromAmountUi: atomicToUi(q.fromAmountAtomic, q.from.decimals),
    toAmountUi: atomicToUi(q.toAmountAtomic, q.to.decimals),
    toAmountMinUi: atomicToUi(q.toAmountMinAtomic, q.to.decimals),
    rate: rateOf(q),
  };
}
