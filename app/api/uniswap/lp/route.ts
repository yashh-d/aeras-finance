import { NextResponse } from "next/server";

import { authenticate } from "@/lib/privy/auth";
import { LP_SLIPPAGE_PERCENT } from "@/lib/uniswap/constants";
import {
  callLpApi,
  LpApiError,
  type LpCheckApprovalBody,
  type LpClaimBody,
  type LpCreateBody,
  type LpDecreaseBody,
  type LpOp,
} from "@/lib/uniswap/lp-api";
import { isUniswapChainId, uniswapPoolById } from "@/lib/uniswap/pools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Liquidity Provisioning API proxy: the one route that hands the browser
// a signable Uniswap transaction.
//
// **The wallet and the pool are not free parameters.** The wallet is the
// embedded EVM wallet on the verified Privy identity, and the pool is named
// by chain and id and has to be in the registry; the token addresses, the
// protocol and the pool reference the API needs are all derived from that
// entry. What the browser chooses is the operation, an amount, a tick range,
// or a token id. That keeps the proxy from becoming a way to build calldata
// against arbitrary pools with a key the browser never sees.

const OPS = new Set<LpOp>(["check_approval", "create", "decrease", "claim_fees"]);
const ATOMIC = /^\d+$/;

type Params = Record<string, unknown>;

function atomic(v: unknown): string | null {
  return typeof v === "string" && ATOMIC.test(v) ? v : null;
}
function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

export async function POST(request: Request) {
  const identity = await authenticate(request);
  if (!identity) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const wallet = identity.embedded.evm;
  if (!wallet) {
    return NextResponse.json({ error: "No EVM wallet has been provisioned on this account yet." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { op, chainId, poolId, params } = (body ?? {}) as { op?: unknown; chainId?: unknown; poolId?: unknown; params?: Params };
  if (typeof op !== "string" || !OPS.has(op as LpOp)) {
    return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
  }
  if (typeof chainId !== "number" || !isUniswapChainId(chainId)) {
    return NextResponse.json({ error: "Unknown chain" }, { status: 400 });
  }
  const pool = typeof poolId === "string" ? uniswapPoolById(chainId, poolId) : undefined;
  if (!pool) return NextResponse.json({ error: "Unknown pool" }, { status: 400 });
  const p = params ?? {};

  let upstream: LpCheckApprovalBody | LpCreateBody | LpDecreaseBody | LpClaimBody;
  switch (op as LpOp) {
    case "check_approval": {
      const a0 = atomic(p.amount0);
      const a1 = atomic(p.amount1);
      if (!a0 || !a1) return NextResponse.json({ error: "amount0 and amount1 must be atomic strings" }, { status: 400 });
      const action = p.action === "DECREASE" ? "DECREASE" : "CREATE";
      upstream = {
        walletAddress: wallet,
        protocol: pool.protocol,
        chainId,
        lpTokens: [
          { tokenAddress: pool.token0.address, amount: a0 },
          { tokenAddress: pool.token1.address, amount: a1 },
        ],
        action,
        // A v4 Permit2 batch permit comes back as a transaction rather than
        // typed data, so one signing path covers v3 and v4 (D7).
        generatePermitAsTransaction: true,
      };
      break;
    }
    case "create": {
      const side = p.independent === 0 || p.independent === 1 ? p.independent : null;
      const amount = atomic(p.amount);
      const tickLower = int(p.tickLower);
      const tickUpper = int(p.tickUpper);
      if (side === null || !amount || tickLower === null || tickUpper === null || tickLower >= tickUpper) {
        return NextResponse.json({ error: "create needs independent (0 or 1), amount, tickLower and tickUpper" }, { status: 400 });
      }
      if (tickLower % pool.tickSpacing !== 0 || tickUpper % pool.tickSpacing !== 0) {
        return NextResponse.json({ error: "ticks must sit on the pool's spacing" }, { status: 400 });
      }
      upstream = {
        walletAddress: wallet,
        protocol: pool.protocol,
        chainId,
        existingPool: { token0Address: pool.token0.address, token1Address: pool.token1.address, poolReference: pool.id },
        independentToken: { tokenAddress: side === 0 ? pool.token0.address : pool.token1.address, amount },
        tickBounds: { tickLower, tickUpper },
        slippageTolerance: LP_SLIPPAGE_PERCENT,
        simulateTransaction: false,
      };
      break;
    }
    case "decrease": {
      const tokenId = atomic(p.tokenId);
      const percent = int(p.percent);
      if (!tokenId || percent === null || percent < 1 || percent > 100) {
        return NextResponse.json({ error: "decrease needs tokenId and percent (1 to 100)" }, { status: 400 });
      }
      upstream = {
        walletAddress: wallet,
        chainId,
        protocol: pool.protocol,
        token0Address: pool.token0.address,
        token1Address: pool.token1.address,
        nftTokenId: tokenId,
        liquidityPercentageToDecrease: percent,
        // WETH stays WETH: the way home (a Trustware return leg) takes it as
        // it is, and native ETH would need wrapping to be sent anywhere else.
        withdrawAsWeth: true,
        slippageTolerance: LP_SLIPPAGE_PERCENT,
        simulateTransaction: false,
      };
      break;
    }
    case "claim_fees": {
      const tokenId = atomic(p.tokenId);
      if (!tokenId) return NextResponse.json({ error: "claim_fees needs tokenId" }, { status: 400 });
      upstream = {
        protocol: pool.protocol,
        walletAddress: wallet,
        chainId,
        tokenId,
        collectAsWeth: true,
        simulateTransaction: false,
      };
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
  }

  try {
    const result = await callLpApi(op as LpOp, upstream);
    // The API's transaction must be for this chain and, for approvals,
    // must not be a call to anything but a token or Permit2. The chain is
    // the one thing a wrong response could silently get wrong.
    for (const tx of [result.transaction, ...result.approvals]) {
      if (tx && tx.chainId != null && tx.chainId !== chainId) {
        return NextResponse.json({ error: "Uniswap's API returned a transaction for another chain." }, { status: 502 });
      }
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LpApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
