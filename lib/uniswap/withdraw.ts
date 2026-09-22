"use client";

// The exits: claim a position's fees, withdraw it, reopen it around the
// current price, and move a pool token home to Solana. See
// docs/uniswap-lp-plan.md D11. Calldata for the first two comes from the LP
// API through the proxy; the reopen is a withdraw followed by the shared
// rebalance-and-mint; the way home is Trustware's `return` shape.

import type { EvmSigner, MorphoTxProgress } from "@/lib/morpho/deposit";
import { connectChain, waitForReceipt } from "@/lib/ethereum/tx";
import { USDC_MINT } from "@/lib/jupiter/constants";
import { TRUSTWARE_DEFAULT_SLIPPAGE, TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import { executeEvmRoute } from "@/lib/trustware/execute";

import { callLpProxy, fetchUniswapPositions, type UniswapPositionView, type WalletBalances } from "./client";
import { receiptOpts, sendLpTransaction } from "./deposit";
import { balanceAndMint, gasFloorWei } from "./fund";
import { NATIVE_FUNDING_TOKEN, UNISWAP_CHAINS, type PoolToken, type UniswapChainId, type UniswapPool } from "./pools";

type Report = (p: MorphoTxProgress) => void;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isNative(t: PoolToken): boolean {
  return Boolean(t.native) || t.address.toLowerCase() === ZERO_ADDRESS;
}

function heldOf(balances: WalletBalances | null | undefined, t: PoolToken): bigint {
  if (!balances) return 0n;
  return BigInt((isNative(t) ? balances.native : balances[t.address.toLowerCase()]) ?? "0");
}

async function readBalances(chainId: UniswapChainId): Promise<WalletBalances | null> {
  try {
    return (await fetchUniswapPositions()).balances[chainId] ?? null;
  } catch {
    return null;
  }
}

function gasGuard(chainId: UniswapChainId, balances: WalletBalances | null): void {
  const chain = UNISWAP_CHAINS[chainId];
  if (BigInt(balances?.native ?? "0") < gasFloorWei(chainId) / 4n) {
    throw new Error(
      `Your ${chain.label} wallet has no ${chain.nativeSymbol} to pay gas for this. A deposit from Solana adds gas automatically.`,
    );
  }
}

async function runLpTransaction(args: {
  pool: UniswapPool;
  signer: EvmSigner;
  op: "decrease" | "claim_fees";
  params: Record<string, unknown>;
  doing: string;
  done: string;
  report: Report;
}): Promise<string> {
  const { pool, signer, report } = args;
  const chain = UNISWAP_CHAINS[pool.chainId];
  gasGuard(pool.chainId, await readBalances(pool.chainId));
  report({ stage: "switching", message: `Switching to ${chain.label}.` });
  const provider = await connectChain(signer, pool.chainId, chain.label);
  report({ stage: "withdrawing", message: args.doing });
  const built = await callLpProxy(args.op, pool.chainId, pool.id, args.params);
  if (!built.transaction) throw new Error("Uniswap's API returned no transaction to sign.");
  const hash = await sendLpTransaction(provider, built.transaction, signer.address);
  report({ stage: "confirming", message: `Confirming on ${chain.label}.`, txHash: hash });
  await waitForReceipt(provider, hash, receiptOpts(pool.chainId));
  report({ stage: "done", message: args.done, txHash: hash });
  return hash;
}

// Collect the position's fees into the wallet.
export async function claimFees(args: {
  pool: UniswapPool;
  position: UniswapPositionView;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  return runLpTransaction({
    pool: args.pool,
    signer: args.signer,
    op: "claim_fees",
    params: { tokenId: args.position.tokenId },
    doing: `Claiming ${args.pool.label} fees.`,
    done: "Fees claimed into your wallet.",
    report: (p) => args.onProgress?.(p),
  });
}

// Remove the position's liquidity (and, on v3, its fees) into the wallet.
export async function withdrawPosition(args: {
  pool: UniswapPool;
  position: UniswapPositionView;
  signer: EvmSigner;
  percent?: number;
  onProgress?: Report;
}): Promise<string> {
  return runLpTransaction({
    pool: args.pool,
    signer: args.signer,
    op: "decrease",
    params: { tokenId: args.position.tokenId, percent: args.percent ?? 100 },
    doing: `Withdrawing the ${args.pool.label} position.`,
    done: "Withdrawn into your wallet.",
    report: (p) => args.onProgress?.(p),
  });
}

// Withdraw, then open a new position around the current price with what
// came out, rebalancing the two sides on the way.
export async function reopenPosition(args: {
  pool: UniswapPool;
  position: UniswapPositionView;
  signer: EvmSigner;
  prices: Record<string, number>;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ txHash: string; recorded: boolean }> {
  const { pool } = args;
  const before = await readBalances(pool.chainId);
  await withdrawPosition({ pool, position: args.position, signer: args.signer, onProgress: args.onProgress });
  const after = await readBalances(pool.chainId);
  const use: [bigint, bigint] = [0n, 0n];
  for (const i of [0, 1] as const) {
    const t = i === 0 ? pool.token0 : pool.token1;
    const gained = heldOf(after, t) - heldOf(before, t);
    use[i] = gained > 0n ? gained : 0n;
  }
  if (use[0] === 0n && use[1] === 0n) {
    throw new Error(`The withdrawal landed but the ${UNISWAP_CHAINS[pool.chainId].label} balance read has not caught up. Deposit from the wallet in a moment.`);
  }
  return balanceAndMint({ pool, signer: args.signer, use, prices: args.prices, onProgress: args.onProgress, signal: args.signal });
}

// Send a pool token from the EVM wallet home to Solana as USDC.
export async function moveTokenToSolana(args: {
  chainId: UniswapChainId;
  token: PoolToken;
  amountAtomic: bigint;
  balances: WalletBalances | null;
  evm: EvmSigner;
  solanaAddress: string;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ deliveredAtomic: string | null }> {
  const { token, chainId } = args;
  const chain = UNISWAP_CHAINS[chainId];
  if (args.amountAtomic <= 0n) throw new Error("Enter an amount above zero.");
  const heldNow = heldOf(args.balances, token);
  const ceiling = isNative(token) ? heldNow - gasFloorWei(chainId) : heldNow;
  if (args.amountAtomic > ceiling) {
    throw new Error(
      isNative(token)
        ? `Amount is above what the wallet can send while keeping its ${chain.nativeSymbol} gas reserve.`
        : `Amount is above the wallet's ${token.symbol} balance on ${chain.label}.`,
    );
  }
  gasGuard(chainId, args.balances);
  const result = await executeEvmRoute({
    request: {
      fromChain: String(chainId),
      toChain: TRUSTWARE_SOLANA_CHAIN,
      fromToken: isNative(token) ? NATIVE_FUNDING_TOKEN[chainId] : token.address,
      toToken: USDC_MINT,
      fromAmount: args.amountAtomic.toString(),
      fromAddress: args.evm.address,
      toAddress: args.solanaAddress,
      slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
    },
    evm: args.evm,
    describe: token.symbol,
    onProgress: (p) =>
      args.onProgress?.({
        stage: p.stage === "settled" ? "done" : "funding",
        message: p.stage === "settled" ? "USDC arrived on Solana." : p.message,
      }),
    signal: args.signal,
  });
  return { deliveredAtomic: result.deliveredAtomic };
}
