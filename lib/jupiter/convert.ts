// Same-chain conversion between two Solana mints that track the same equity.
//
// Ondo issues these equities natively on Solana (TSLAon) and Jupiter Lend takes
// the Backed xStock (TSLAx). Converting one into the other never leaves Solana,
// so it is an ordinary swap.
//
// Two upstream constraints shaped this, both verified against the live APIs:
//
//   Trustware cannot execute it. Its /route selects a provider per request, and
//   a `relay` selection returns no execution.transaction, so there is nothing to
//   sign. Every Solana-to-Solana route tested came back that way, across sizes,
//   funded and unfunded wallets and repeated attempts, while an EVM source into
//   the same token returned a signable transaction every time. Reproduce with
//   scripts/trustware-solana-route-check.mts.
//
//   Jupiter Ultra refuses the pair: GET /ultra/v1/order returns HTTP 400 with
//   "Only USDC is available for swapping with Ondo tokens". That holds with and
//   without a taker, so the buy flow's Ultra path cannot be reused here.
//
// The classic swap API routes it directly, through a single Meteora DLMM hop at
// zero price impact for retail size. It has no execute endpoint, so the signed
// transaction is broadcast by the caller's wallet rather than handed back to
// Jupiter. That is the one place this deviates from the Ultra flow described in
// CLAUDE.md, and it is forced by the 400 above.
//
// Trustware still handles every cross-chain leg. Only the Solana-to-Solana case
// lives here.

// Slippage for the conversion, in basis points. The pair quotes zero price
// impact at retail size through one hop, and the planner sizes the deposit from
// the guaranteed minimum, so a loose tolerance would only spend more of the
// source token to promise the same floor.
export const CONVERSION_SLIPPAGE_BPS = 30;

const LITE_SWAP_BASE = "https://lite-api.jup.ag/swap/v1";

// Jupiter's quote payload. Passed back verbatim when building the transaction,
// so it is carried around opaquely rather than modelled field by field.
export interface JupiterSwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  // Minimum out after slippage.
  otherAmountThreshold: string;
  priceImpactPct?: string;
  slippageBps?: number;
  routePlan?: Array<{ swapInfo?: { label?: string } }>;
  [key: string]: unknown;
}

export interface SolanaConversionQuote {
  fromAmountAtomic: string;
  toAmountAtomic: string;
  // Guaranteed floor after slippage. Everything sizes against this.
  toAmountMinAtomic: string;
  fromAmountUsd: number | null;
  toAmountUsd: number | null;
  // Value lost end to end as a fraction of the input, measured in token units.
  // These mints track the same equity one for one, so the unit shortfall is the
  // round-trip cost. Solana network fees are paid in SOL and excluded.
  lossFraction: number | null;
  slippagePct: number;
  priceImpactPct: number | null;
  route: string;
  // The quote itself, needed to build the transaction.
  raw: JupiterSwapQuote;
}

export type QuoteTransport = (params: {
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
}) => Promise<JupiterSwapQuote>;

// Browser transport. Goes through our own proxy, which allowlists the pair.
const proxyQuote: QuoteTransport = async (params) => {
  const url = new URL("/api/jupiter/swap/quote", window.location.origin);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amountAtomic);
  url.searchParams.set("slippageBps", String(params.slippageBps));
  const res = await fetch(url.toString(), { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? `Swap quote failed: ${res.status}`);
  }
  return body as JupiterSwapQuote;
};

// Node transport for scripts, which have no window to resolve a relative URL
// against. Hits Jupiter directly; the endpoint needs no key.
export const directQuote: QuoteTransport = async (params) => {
  const url = new URL(`${LITE_SWAP_BASE}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amountAtomic);
  url.searchParams.set("slippageBps", String(params.slippageBps));
  const res = await fetch(url.toString(), { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? `Swap quote failed: ${res.status}`);
  }
  return body as JupiterSwapQuote;
};

function toNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function quoteSolanaConversion(args: {
  inputMint: string;
  inputDecimals: number;
  outputMint: string;
  outputDecimals: number;
  amountAtomic: string;
  slippageBps?: number;
  transport?: QuoteTransport;
}): Promise<SolanaConversionQuote> {
  const slippageBps = args.slippageBps ?? CONVERSION_SLIPPAGE_BPS;
  const transport = args.transport ?? proxyQuote;

  const quote = await transport({
    inputMint: args.inputMint,
    outputMint: args.outputMint,
    amountAtomic: args.amountAtomic,
    slippageBps,
  });

  if (!quote?.outAmount || BigInt(quote.outAmount) <= 0n) {
    throw new Error("Jupiter returned no output amount for this swap.");
  }

  // Compare like with like: rescale the input to the output's decimals, since
  // Ondo mints carry 9 and the xStocks carry 8.
  const scaleDiff = args.outputDecimals - args.inputDecimals;
  const inScaled =
    scaleDiff >= 0
      ? BigInt(quote.inAmount) * 10n ** BigInt(scaleDiff)
      : BigInt(quote.inAmount) / 10n ** BigInt(-scaleDiff);
  const out = BigInt(quote.outAmount);
  const lossFraction =
    inScaled > 0n ? Number(inScaled - out) / Number(inScaled) : null;

  return {
    fromAmountAtomic: quote.inAmount,
    toAmountAtomic: quote.outAmount,
    toAmountMinAtomic: quote.otherAmountThreshold,
    fromAmountUsd: null,
    toAmountUsd: null,
    lossFraction,
    slippagePct: (quote.slippageBps ?? slippageBps) / 100,
    priceImpactPct: toNumber(quote.priceImpactPct),
    route:
      quote.routePlan
        ?.map((r) => r.swapInfo?.label)
        .filter(Boolean)
        .join(" then ") || "Jupiter",
    raw: quote,
  };
}

// Build the transaction for a quote, sign it, and broadcast it.
//
// `signAndSendBase64` is the same Privy helper the rest of the app signs with,
// so the wallet prompt and the submission behave identically here.
export async function executeSolanaConversion(args: {
  quote: SolanaConversionQuote;
  userPublicKey: string;
  signAndSendBase64: (base64Tx: string) => Promise<string>;
}): Promise<{ signature: string }> {
  const res = await fetch("/api/jupiter/swap/build", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: args.quote.raw,
      userPublicKey: args.userPublicKey,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? `Swap build failed: ${res.status}`);
  }
  const swapTransaction = body?.swapTransaction as string | undefined;
  if (!swapTransaction) {
    throw new Error("Jupiter returned no transaction to sign.");
  }

  const signature = await args.signAndSendBase64(swapTransaction);
  return { signature };
}
