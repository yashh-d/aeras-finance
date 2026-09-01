"use client";

// Leg one of a bridged buy: USDC on another chain becoming USDC on Solana, so
// the Jupiter swap that actually buys the asset can run from the user's own
// wallet.
//
// A sibling of lib/lighter/bridge-home.ts rather than a caller of it. That one
// is pinned to Ethereum because the Lighter exit can only ever pay the account's
// Ethereum address; this one has to work from whatever chain the user happens
// to hold USDC on, so the chain and the token contract are arguments.
//
// The destination is always the user's own Solana wallet, never a router or a
// venue. That is what makes an abandoned second leg harmless: the money stops
// as Solana USDC, which is spendable everywhere else in the app. A bridge
// pointed straight at a swap would have no such resting state.
//
// Gas is the part worth stating rather than discovering. The source leg is an
// ERC-20 approve plus a router call on the source chain, paid in that chain's
// native token, and the embedded EVM wallet is born holding none of it. The
// check runs BEFORE anything is signed and refuses with a readable reason,
// because failing inside a signature prompt teaches the user nothing.

import {
  executeEvmRoute,
  type ConversionProgress,
  type EvmSigner,
} from "@/lib/trustware/execute";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";

import { USDC_MINT } from "./constants";

// Most the route may give up before this refuses. USDC to USDC prices tight;
// anything past this is a broken route, not a spread. Mirrors the bound the
// Lighter return leg uses.
const MAX_BRIDGE_LOSS_BPS = 150n;

// Gas the source leg needs: an approve plus the router transfer. Deliberately
// about double a typical run, because refusing a leg that would have succeeded
// costs a retry, while running out mid-sequence costs a stuck approval.
const GAS_UNITS_SOURCE_LEG = 300_000n;

export interface BridgeGasCheck {
  balanceWei: bigint;
  requiredWei: bigint;
  ok: boolean;
}

// Whether the wallet can pay gas on the SOURCE chain.
//
// The chain switch happens first and a fresh provider is requested after it,
// because a Privy provider is bound to the chain that was active when it was
// requested. Reading the balance through a stale provider prices the wrong
// chain's gas and answers confidently with a number about somewhere else.
export async function checkBridgeGas(
  evm: EvmSigner,
  chain: string,
): Promise<BridgeGasCheck> {
  const chainId = Number(chain);
  if (Number.isFinite(chainId)) {
    await evm.switchChain(chainId);
  }
  const provider = await evm.getProvider();
  const [balanceHex, priceHex] = await Promise.all([
    provider.request({
      method: "eth_getBalance",
      params: [evm.address, "latest"],
    }) as Promise<string>,
    provider.request({ method: "eth_gasPrice", params: [] }) as Promise<string>,
  ]);
  const balanceWei = BigInt(balanceHex);
  const requiredWei = BigInt(priceHex) * GAS_UNITS_SOURCE_LEG;
  return { balanceWei, requiredWei, ok: balanceWei >= requiredWei };
}

// Bring USDC from an EVM chain to the user's Solana wallet.
//
// Resolves only once Trustware reports settlement, so the caller can treat a
// resolved promise as "the USDC is on Solana" and quote the swap against it.
export async function bridgeUsdcToSolana(args: {
  chain: string;
  chainLabel: string;
  contract: string;
  amountAtomic: bigint;
  evm: EvmSigner;
  solanaAddress: string;
  // Native symbol of the source chain, for the gas message. ETH on Ethereum
  // and Base, BNB on BNB Chain.
  nativeSymbol: string;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
}): Promise<{ deliveredAtomic: string | null }> {
  if (args.amountAtomic <= 0n) {
    throw new Error("Enter an amount above zero.");
  }

  const gas = await checkBridgeGas(args.evm, args.chain);
  if (!gas.ok) {
    const need = Number(gas.requiredWei) / 1e18;
    const have = Number(gas.balanceWei) / 1e18;
    throw new Error(
      `Your wallet cannot pay gas on ${args.chainLabel}: it needs about ` +
        `${need.toFixed(5)} ${args.nativeSymbol} and holds ${have.toFixed(5)}. ` +
        `Top up ${args.nativeSymbol} on ${args.chainLabel}, or pay with an asset ` +
        `already on Solana instead.`,
    );
  }

  const minDelivered =
    (args.amountAtomic * (10_000n - MAX_BRIDGE_LOSS_BPS)) / 10_000n;

  const result = await executeEvmRoute({
    request: {
      fromChain: args.chain,
      toChain: TRUSTWARE_SOLANA_CHAIN,
      fromToken: args.contract,
      toToken: USDC_MINT,
      fromAmount: args.amountAtomic.toString(),
      fromAddress: args.evm.address,
      // The user's own wallet. Never the swap, never a router.
      toAddress: args.solanaAddress,
      slippage: 0.3,
    },
    evm: args.evm,
    describe: "USDC",
    minDeliveredAtomic: minDelivered,
    onProgress: args.onProgress,
    signal: args.signal,
  });

  return { deliveredAtomic: result.deliveredAtomic };
}
