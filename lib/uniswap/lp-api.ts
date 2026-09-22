// Server-only client for Uniswap's Liquidity Provisioning API, the source of
// every mint, decrease and claim transaction this venue signs. The key is
// UNISWAP_API_KEY; app/api/uniswap/lp is the only caller and pins the wallet
// and the pool before anything reaches here. See docs/uniswap-lp-plan.md D5.
//
// Request and response shapes are from the integration guide at
// developers.uniswap.org/docs/liquidity/liquidity-provisioning-api, read
// 2026-09-21. The one field every response carries that matters is a
// TransactionRequest, and the guide's three rules about it are enforced by
// the proxy: never empty, never modified, always validated before broadcast.

import "server-only";

import { UNISWAP_LP_API_BASE_URL, type UniswapProtocol } from "./constants";

export interface LpTransactionRequest {
  to: string;
  from?: string;
  data: string;
  value?: string;
  chainId?: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

export interface LpTokenAmount {
  tokenAddress: string;
  amount: string;
}

export type LpOp = "check_approval" | "create" | "decrease" | "claim_fees";

export interface LpCheckApprovalBody {
  walletAddress: string;
  protocol: UniswapProtocol;
  chainId: number;
  lpTokens: LpTokenAmount[];
  action: "CREATE" | "INCREASE" | "DECREASE" | "MIGRATE";
  generatePermitAsTransaction?: boolean;
}

export interface LpCreateBody {
  walletAddress: string;
  protocol: UniswapProtocol;
  chainId: number;
  existingPool: { token0Address: string; token1Address: string; poolReference: string };
  independentToken: LpTokenAmount;
  tickBounds: { tickLower: number; tickUpper: number };
  slippageTolerance?: number;
  simulateTransaction?: boolean;
}

export interface LpDecreaseBody {
  walletAddress: string;
  chainId: number;
  protocol: UniswapProtocol;
  token0Address: string;
  token1Address: string;
  nftTokenId: string;
  liquidityPercentageToDecrease: number;
  withdrawAsWeth?: boolean;
  slippageTolerance?: number;
  simulateTransaction?: boolean;
}

export interface LpClaimBody {
  protocol: UniswapProtocol;
  walletAddress: string;
  chainId: number;
  tokenId: string;
  collectAsWeth?: boolean;
  simulateTransaction?: boolean;
}

// What the proxy hands the browser: one shape for every operation. The
// approval transactions (check_approval) or the single transaction (the
// rest), plus whatever amounts and ticks the API reported.
export interface LpProxyResult {
  op: LpOp;
  transaction: LpTransactionRequest | null;
  approvals: LpTransactionRequest[];
  token0?: LpTokenAmount;
  token1?: LpTokenAmount;
  tickLower?: number;
  tickUpper?: number;
  requestId?: string;
}

export class LpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LpApiError";
  }
}

const TIMEOUT_MS = 20_000;

function isTx(v: unknown): v is LpTransactionRequest {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as LpTransactionRequest).to === "string" &&
    typeof (v as LpTransactionRequest).data === "string" &&
    (v as LpTransactionRequest).data.length > 2 &&
    (v as LpTransactionRequest).data.startsWith("0x")
  );
}

export function hasUniswapApiKey(): boolean {
  return Boolean(process.env.UNISWAP_API_KEY);
}

export async function callLpApi(op: LpOp, body: LpCheckApprovalBody | LpCreateBody | LpDecreaseBody | LpClaimBody): Promise<LpProxyResult> {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) {
    throw new LpApiError(
      "Liquidity pool transactions are not enabled: UNISWAP_API_KEY is not set.",
      503,
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${UNISWAP_LP_API_BASE_URL}/lp/${op}`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new LpApiError(
      aborted ? "Uniswap's API did not answer in time." : `Uniswap's API could not be reached: ${err instanceof Error ? err.message : String(err)}`,
      503,
    );
  }
  clearTimeout(timer);
  const text = await res.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new LpApiError(`Uniswap's API answered ${res.status} with a non-JSON body.`, 502);
  }
  if (!res.ok) {
    const detail =
      (typeof parsed.detail === "string" && parsed.detail) ||
      (typeof parsed.message === "string" && parsed.message) ||
      (typeof parsed.error === "string" && parsed.error) ||
      text.slice(0, 200);
    throw new LpApiError(`Uniswap's API refused the request (${res.status}): ${detail}`, res.status === 401 ? 503 : 502);
  }

  const result: LpProxyResult = { op, transaction: null, approvals: [] };
  if (typeof parsed.requestId === "string") result.requestId = parsed.requestId;
  if (op === "check_approval") {
    const list = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    for (const entry of list) {
      const tx = (entry as { transaction?: unknown })?.transaction ?? entry;
      if (isTx(tx)) result.approvals.push(tx);
    }
    return result;
  }
  const tx = parsed.create ?? parsed.decrease ?? parsed.claim ?? parsed.transaction;
  if (!isTx(tx)) {
    throw new LpApiError("Uniswap's API returned no transaction to sign.", 502);
  }
  result.transaction = tx;
  const t0 = parsed.token0 as LpTokenAmount | undefined;
  const t1 = parsed.token1 as LpTokenAmount | undefined;
  if (t0?.tokenAddress && t0.amount) result.token0 = t0;
  if (t1?.tokenAddress && t1.amount) result.token1 = t1;
  if (typeof parsed.tickLower === "number") result.tickLower = parsed.tickLower;
  if (typeof parsed.tickUpper === "number") result.tickUpper = parsed.tickUpper;
  return result;
}
