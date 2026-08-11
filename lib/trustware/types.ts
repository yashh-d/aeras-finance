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

// The signable payload from /route. Verified against a live Ethereum -> Solana
// response: a plain EVM transaction with nothing wallet-specific in it, which is
// why any EIP-1193 signer (our Privy embedded wallet) can execute it. Quantities
// come back as hex strings.
// Quantities are inconsistent between the docs (decimal strings) and the live
// payloads we captured (hex). Never parse these by hand; run them through
// toQuantity() below, which accepts either.
export interface TrustwareEvmTransaction {
  chainId?: number;
  to: string;
  data: string;
  value?: string;
  gasLimit?: string;
  gasPrice?: string;
  // EIP-1559 pricing. When present these replace gasPrice; sending both is
  // rejected by every node.
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  from?: string;
  type?: string;
}

// Normalize a Trustware-supplied quantity to the 0x-prefixed hex an EIP-1193
// provider expects. BigInt() parses both "0x1a" and "26", which is exactly the
// ambiguity we need to absorb.
export function toQuantity(
  value: string | number | undefined,
): `0x${string}` | undefined {
  if (value === undefined || value === "") return undefined;
  return `0x${BigInt(value).toString(16)}`;
}

// ERC-20 approvals that must land before the transaction above. `spender` is the
// router contract, which for the LI.FI provider is the LI.FI Diamond.
export interface TrustwareApproval {
  chainId: number;
  tokenAddress: string;
  spender: string;
  amount: string;
}

export interface TrustwareRouteExecution {
  transaction?: TrustwareEvmTransaction;
  approvals?: TrustwareApproval[];
}

export interface TrustwareRoute {
  estimate?: TrustwareEstimate;
  execution?: TrustwareRouteExecution;
  provider?: string;
  requestId?: string;
}

// Covers both endpoints. /quote nests its estimate at `data.estimate`; /route
// nests everything one level deeper under `data.route`.
export interface TrustwareQuoteResponse {
  estimate?: TrustwareEstimate;
  data?: {
    estimate?: TrustwareEstimate;
    intentId?: string;
    route?: TrustwareRoute;
  };
  intentId?: string;
  route?: TrustwareRoute;
  finalExchangeRate?: string;
  error?: string;
}

// Pull the estimate out wherever it is nested. The `data.route.estimate` path
// matters: /route puts it there, so without it every estimate read against a
// route response comes back undefined.
export function extractEstimate(
  res: TrustwareQuoteResponse,
): TrustwareEstimate | undefined {
  return (
    res.estimate ??
    res.data?.estimate ??
    res.data?.route?.estimate ??
    res.route?.estimate
  );
}

// The transaction plus its approvals, or undefined if the response was not an
// executable route.
export function extractExecution(
  res: TrustwareQuoteResponse,
): TrustwareRouteExecution | undefined {
  return res.data?.route?.execution ?? res.route?.execution;
}

export function extractIntentId(res: TrustwareQuoteResponse): string | undefined {
  return res.intentId ?? res.data?.intentId;
}

// --- GET /data/balances/:address ---
//
// Shapes verified against live responses on 2026-08-05 for both an EVM and a
// Solana address. Three things about this payload are load-bearing:
//
//  1. `symbol` is frequently missing. Ondo's Solana mints came back with no
//     symbol at all, and BSC returned lookalikes (TSLAB, NVDAB, QQQB) that are
//     not the tokens we accept. Match holdings on `contract` against the
//     equivalence registry and never on symbol.
//  2. `chain_key` was undefined on both live responses even though the docs
//     describe it. Use `chain_id`, which matches our registry's chain strings
//     exactly ("1", "56", "solana-mainnet-beta").
//  3. `partial` is effectively always true. The endpoint fans out across ~129
//     chains including ones the address format cannot exist on, so it is not a
//     health signal. Check `error` on the specific chains we care about.

export interface TrustwareBalance {
  chain_key?: string;
  category?: "native" | "erc20" | "spl" | "btc" | "bank" | string;
  // Missing for native assets, and sometimes for SPL tokens.
  contract?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  // Raw amount in the token's smallest unit.
  balance?: string;
  usdPrice?: number;
  logoURI?: string;
}

export interface TrustwareChainBalances {
  chain_id?: string;
  source?: string;
  balances?: TrustwareBalance[];
  count?: number;
  // "invalid address for chain" is the normal response for a chain the address
  // format does not apply to, not a failure worth surfacing.
  error?: string | null;
}

export interface TrustwareBalancesResponse {
  address?: string;
  partial?: boolean;
  results?: TrustwareChainBalances[];
  error?: string;
}

// Trustware's wording for "this address cannot exist on this chain". Returned
// for all 60+ Cosmos/Bitcoin chains on an EVM address and vice versa.
const INVALID_ADDRESS_ERROR = "invalid address for chain";

export function isAddressIncompatible(error: string | null | undefined): boolean {
  return (error ?? "").toLowerCase().includes(INVALID_ADDRESS_ERROR);
}

// --- GET /sdk/rpc/evm/allowance ---

export interface TrustwareAllowanceResponse {
  success?: boolean;
  data?: {
    chainId?: string;
    tokenAddress?: string;
    ownerAddress?: string;
    spenderAddress?: string;
    // uint256 as a decimal string, in the token's smallest unit.
    allowance?: string;
  };
  error?: string;
}

// --- POST /route-intent/:intentId/receipt and GET .../status ---

export interface TrustwareReceiptResponse {
  data?: { ok?: boolean; transaction_id?: string };
  error?: string;
}

// Poll until this reaches a terminal value. Nothing downstream may run before
// `success`: on `failed` Trustware refunds the source address, so treating a
// failure as a delivery would credit collateral the user does not have.
export type TrustwareStatusValue =
  | "submitted"
  | "bridging"
  | "success"
  | "failed";

export interface TrustwareStatusResponse {
  data?: {
    intent_id?: string;
    status?: TrustwareStatusValue;
    source_tx_hash?: string;
    dest_tx_hash?: string;
    // Destination amount actually received, in the smallest unit. Only
    // populated on success.
    to_amount_wei?: string;
    routing_provider?: string;
    // Present only when the destination step stalled for gas.
    gas_status?: string;
    // Server-suggested time for the next poll; preferred over a fixed interval.
    next_poll_at?: string;
  };
  error?: string;
}

export function isTerminalStatus(
  status: TrustwareStatusValue | undefined,
): boolean {
  return status === "success" || status === "failed";
}
