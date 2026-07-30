// Request/response shapes for the Trustware routes API (POST /quote and /route).
// Field names match Trustware's live payloads as observed in
// scripts/trustware-quote-spike.mjs. The route API nests its estimate under
// `data.estimate`; a bare `estimate` is also tolerated so a shape change upstream
// does not silently drop values.

export interface TrustwareQuoteRequest {
  // EVM chains use numeric chainId strings ("1", "8453"); Solana is the
  // string alias "solana-mainnet-beta".
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  // Atomic units of fromToken, as a decimal string.
  fromAmount: string;
  fromAddress: string;
  toAddress: string;
  // Percent (1 = 1%). Optional; defaults applied server-side.
  slippage?: number;
}

export interface TrustwareFee {
  type?: string;
  amountUsd?: number | string;
  // Some payloads label the USD figure `usd` instead of `amountUsd`.
  usd?: number | string;
}

export interface TrustwareEstimate {
  // Atomic units of toToken.
  toAmount?: string;
  toAmountMin?: string;
  toAmountUsd?: number | string;
  fromAmountUsd?: number | string;
  totalFeesUsd?: number | string;
  fees?: TrustwareFee[];
}

// Raw route/quote response. `estimate` is what callers care about; `intentId`
// and `txReq` only appear on the executable /route response.
export interface TrustwareQuoteResponse {
  estimate?: TrustwareEstimate;
  data?: { estimate?: TrustwareEstimate };
  intentId?: string;
  txReq?: unknown;
  finalExchangeRate?: string;
  route?: unknown;
  error?: string;
}

// Pull the estimate out regardless of whether it is nested under `data`.
export function extractEstimate(
  res: TrustwareQuoteResponse,
): TrustwareEstimate | undefined {
  return res.estimate ?? res.data?.estimate;
}
