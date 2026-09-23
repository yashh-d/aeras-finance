"use client";

// Gas on the EVM chains, in one place.
//
// The embedded EVM wallet is born with no native token on any chain, and a
// position on one of them cannot pay for its own exit: with no MON there is
// no way to sign the approval that would sell Monad USDC for MON. So the
// source of gas is always the Solana wallet's USDC, through one Trustware
// leg to the chain's native token. Every deposit path already sizes that leg
// silently and sends it with the deposit; this module is the same leg for
// the paths that used to refuse instead (a return leg, an unstake, a vault
// withdrawal, an LP exit), so they can open the gas sheet and go on.
//
// Two ways of sizing, both taken from the venues that measured them:
//
//   Monad, Base, Robinhood  a floor in native units and a fixed USDC top-up
//                           that delivers a comfortable multiple of it, because
//                           gas on those chains is a fraction of a cent and
//                           does not move much. Monad's 0.5 USDC delivered
//                           about 17 MON when measured (lib/morpho/fund.ts).
//   Ethereum                sized from the live gas price and the units a
//                           full cycle costs, capped against the position, by
//                           lib/trustware/eth-gas.ts. Ethereum gas moves by an
//                           order of magnitude within a week.
//
// A caller that has simulated its transaction (Blend's withdrawal review)
// passes the simulated requirement instead of the floor; the top-up size
// stays the chain's fixed one.

import type { Hex } from "viem";

import { BASE_CHAIN_ID, BASE_NATIVE_TOKEN } from "@/lib/base/constants";
import { ETHEREUM_CHAIN_ID } from "@/lib/ethereum/constants";
import { connectChain } from "@/lib/ethereum/tx";
import { BASE_GAS_TOPUP_USDC_ATOMIC } from "@/lib/glider/exit";
import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import { MONAD_CHAIN_ID, MONAD_NATIVE_TOKEN } from "@/lib/morpho/constants";
import {
  GAS_FLOOR_WEI as MONAD_GAS_FLOOR_WEI,
  GAS_MIN_DELIVERED_WEI as MONAD_GAS_MIN_DELIVERED_WEI,
  GAS_TOPUP_USDC_ATOMIC as MONAD_GAS_TOPUP_USDC_ATOMIC,
  fundingRequest,
  quoteFunding,
} from "@/lib/morpho/fund";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_GAS_FLOOR_WEI,
  ROBINHOOD_GAS_MIN_DELIVERED_WEI,
  ROBINHOOD_GAS_TOPUP_USDC_ATOMIC,
  ROBINHOOD_NATIVE_TOKEN,
} from "@/lib/robinhood/constants";
import { atomicToUi } from "@/lib/trustware/amounts";
import {
  fetchTrustwareQuoteViaProxy,
  fetchTrustwareRouteViaProxy,
} from "@/lib/trustware/client";
import { planEthGas, requiredEthWei, type TrustwareLeg } from "@/lib/trustware/eth-gas";
import {
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type EvmSigner,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import {
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
} from "@/lib/trustware/types";

export type { EvmSigner, SolanaSigner };

// ── policy ─────────────────────────────────────────────────────────────────

interface FixedGasPolicy {
  label: string;
  nativeSymbol: string;
  nativeDecimals: 18;
  floorWei: bigint;
  topupUsdcAtomic: bigint;
  minDeliveredWei: bigint;
  // What Trustware wants as the native destination on this chain.
  token: string;
}

// Base's floor is lib/trustware/base.ts's (measured against the gas limit
// Trustware returns for the return route) and its top-up the Mag7X exit's.
// The Uniswap venue had its own 1.5 USDC for Base; 2 is the one kept, since
// it was sized above the route's $0.30 flat cost so the leg is not mostly fee.
const BASE_GAS_FLOOR_WEI = 200_000_000_000_000n; // 0.0002 ETH
const BASE_GAS_MIN_DELIVERED_WEI = 150_000_000_000_000n; // 0.00015 ETH

export const FIXED_GAS_POLICY: Readonly<Record<number, FixedGasPolicy>> = {
  [MONAD_CHAIN_ID]: {
    label: "Monad",
    nativeSymbol: "MON",
    nativeDecimals: 18,
    floorWei: MONAD_GAS_FLOOR_WEI,
    topupUsdcAtomic: MONAD_GAS_TOPUP_USDC_ATOMIC,
    minDeliveredWei: MONAD_GAS_MIN_DELIVERED_WEI,
    token: MONAD_NATIVE_TOKEN,
  },
  [BASE_CHAIN_ID]: {
    label: "Base",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    floorWei: BASE_GAS_FLOOR_WEI,
    topupUsdcAtomic: BASE_GAS_TOPUP_USDC_ATOMIC,
    minDeliveredWei: BASE_GAS_MIN_DELIVERED_WEI,
    token: BASE_NATIVE_TOKEN,
  },
  [ROBINHOOD_CHAIN_ID]: {
    label: "Robinhood Chain",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    floorWei: ROBINHOOD_GAS_FLOOR_WEI,
    topupUsdcAtomic: ROBINHOOD_GAS_TOPUP_USDC_ATOMIC,
    minDeliveredWei: ROBINHOOD_GAS_MIN_DELIVERED_WEI,
    token: ROBINHOOD_NATIVE_TOKEN,
  },
};

export function evmChainLabel(chainId: number): string {
  if (chainId === ETHEREUM_CHAIN_ID) return "Ethereum";
  return FIXED_GAS_POLICY[chainId]?.label ?? `chain ${chainId}`;
}

export function evmNativeSymbol(chainId: number): string {
  if (chainId === ETHEREUM_CHAIN_ID) return "ETH";
  return FIXED_GAS_POLICY[chainId]?.nativeSymbol ?? "gas";
}

// ── the shortfall ──────────────────────────────────────────────────────────

export interface EvmGasShortfall {
  chainId: number;
  chainLabel: string;
  nativeSymbol: string;
  // What the wallet must hold there before the transaction is sent.
  requiredWei: bigint;
  balanceWei: bigint;
  // Where the native token has to land, for "Add" by hand.
  evmAddress: string;
  // The Solana USDC leg that covers it. Absent when it cannot run, with the
  // reason; the sheet then offers only Cancel and Add.
  topup:
    | { usdcAtomic: bigint; leg?: TrustwareLeg }
    | { usdcAtomic: null; reason: string };
}

// Read the wallet's native balance on a chain, and its gas price, through
// the wallet's own provider. Switches the wallet to the chain.
export async function readGasState(
  evm: EvmSigner,
  chainId: number,
): Promise<{ balanceWei: bigint; gasPriceWei: bigint }> {
  const provider = await connectChain(evm, chainId, evmChainLabel(chainId));
  const [balanceHex, priceHex] = await Promise.all([
    provider.request({
      method: "eth_getBalance",
      params: [evm.address as Hex, "latest"],
    }) as Promise<string>,
    provider.request({ method: "eth_gasPrice", params: [] }) as Promise<string>,
  ]);
  return { balanceWei: BigInt(balanceHex), gasPriceWei: BigInt(priceHex) };
}

// Read-only. Null when the wallet can pay.
//
// Reads the balance (and on Ethereum the gas price) live unless the caller
// passes them, because the figure a card holds in state is the one from
// before the top-up it is about to check.
export async function planEvmGas(args: {
  chainId: number;
  evm: EvmSigner;
  solanaUsdcAtomic: string;
  solanaAddress: string | undefined;
  // Ethereum only: the units the remaining cycle costs, and what the
  // position is worth for the gas allowance.
  gasUnits?: bigint;
  positionValueUsd?: number;
  // Supplied by a caller that has just read them (Blend's review).
  balanceWei?: bigint;
  gasPriceWei?: bigint;
  // A simulated requirement for a fixed-policy chain, in place of the floor.
  requiredWei?: bigint;
}): Promise<EvmGasShortfall | null> {
  const onSolana = BigInt(args.solanaUsdcAtomic || "0");
  const live =
    args.balanceWei != null && (args.chainId !== ETHEREUM_CHAIN_ID || args.gasPriceWei != null)
      ? { balanceWei: args.balanceWei, gasPriceWei: args.gasPriceWei ?? 0n }
      : await readGasState(args.evm, args.chainId);
  const balanceWei = live.balanceWei;

  if (args.chainId === ETHEREUM_CHAIN_ID) {
    const gasPriceWei = live.gasPriceWei.toString();
    const gasUnits = args.gasUnits ?? 0n;
    const requiredWei = requiredEthWei(gasPriceWei, gasUnits);
    if (balanceWei >= requiredWei) return null;
    const base = {
      chainId: args.chainId,
      chainLabel: "Ethereum",
      nativeSymbol: "ETH",
      requiredWei,
      balanceWei,
      evmAddress: args.evm.address,
    };
    const plan = await planEthGas({
      ethBalanceAtomic: balanceWei.toString(),
      gasPriceWei,
      solanaUsdcAtomic: args.solanaUsdcAtomic,
      solanaAddress: args.solanaAddress,
      evmAddress: args.evm.address,
      gasUnits,
      positionValueUsd: args.positionValueUsd ?? 0,
      fetchQuote: fetchTrustwareQuoteViaProxy,
    });
    if (plan.kind === "blocked") {
      return { ...base, topup: { usdcAtomic: null, reason: plan.reason } };
    }
    if (!plan.leg) return null;
    return {
      ...base,
      topup: { usdcAtomic: BigInt(plan.leg.sourceAmountAtomic), leg: plan.leg },
    };
  }

  const policy = FIXED_GAS_POLICY[args.chainId];
  if (!policy) {
    throw new Error(`Gas on chain ${args.chainId} is not handled.`);
  }
  const requiredWei = args.requiredWei ?? policy.floorWei;
  if (balanceWei >= requiredWei) return null;
  const base = {
    chainId: args.chainId,
    chainLabel: policy.label,
    nativeSymbol: policy.nativeSymbol,
    requiredWei,
    balanceWei,
    evmAddress: args.evm.address,
  };
  if (!args.solanaAddress) {
    return {
      ...base,
      topup: {
        usdcAtomic: null,
        reason: "No Solana wallet is available to buy gas from.",
      },
    };
  }
  if (onSolana < policy.topupUsdcAtomic) {
    return {
      ...base,
      topup: {
        usdcAtomic: null,
        reason: `Buying ${policy.nativeSymbol} takes ${atomicToUi(policy.topupUsdcAtomic.toString(), USDC_DECIMALS)} USDC on Solana, and the wallet holds ${atomicToUi(onSolana.toString(), USDC_DECIMALS)}.`,
      },
    };
  }
  return { ...base, topup: { usdcAtomic: policy.topupUsdcAtomic } };
}

// ── the top-up ─────────────────────────────────────────────────────────────

const ARRIVAL_TIMEOUT_MS = 3 * 60_000;
const ARRIVAL_POLL_MS = 3_000;

export type GasReport = (message: string) => void;

async function runSolanaLeg(args: {
  request: TrustwareQuoteRequest;
  solana: SolanaSigner;
  signal?: AbortSignal;
}): Promise<void> {
  const route = await fetchTrustwareRouteViaProxy(args.request);
  const intentId = extractIntentId(route);
  const base64Tx = extractExecution(route)?.transaction?.data;
  if (!intentId || !base64Tx || base64Tx.startsWith("0x")) {
    throw new Error("Trustware returned no signable Solana transaction for the gas top-up.");
  }
  const hash = await args.solana.signAndSendBase64(base64Tx);
  await submitTrustwareReceipt(intentId, hash, args.signal);
  await trackTrustwareSettlement(intentId, args.signal, () => {});
}

export async function readNativeBalance(evm: EvmSigner, chainId: number): Promise<bigint> {
  return (await readGasState(evm, chainId)).balanceWei;
}

// Buy the gas a shortfall names, from Solana USDC, and wait until the chain
// shows it. Signs one Solana transaction. Throws when the top-up cannot run.
export async function fundEvmGas(args: {
  shortfall: EvmGasShortfall;
  evm: EvmSigner;
  solana: SolanaSigner;
  report?: GasReport;
  signal?: AbortSignal;
}): Promise<void> {
  const { shortfall, evm, solana } = args;
  const report = args.report ?? (() => {});
  if (shortfall.topup.usdcAtomic == null) throw new Error(shortfall.topup.reason);

  if (shortfall.chainId === ETHEREUM_CHAIN_ID) {
    const leg = shortfall.topup.leg;
    if (!leg) throw new Error("The Ethereum gas top-up was not priced.");
    report(
      `Buying about $${atomicToUi(leg.sourceAmountAtomic, USDC_DECIMALS)} of ETH for gas from your Solana wallet.`,
    );
    await runSolanaLeg({ request: leg.request, solana, signal: args.signal });
  } else {
    const policy = FIXED_GAS_POLICY[shortfall.chainId];
    const request = fundingRequest(
      policy.topupUsdcAtomic.toString(),
      solana.address,
      evm.address,
      policy.token,
      shortfall.chainId,
    );
    const quote = await quoteFunding(request, fetchTrustwareQuoteViaProxy);
    if (BigInt(quote.toAmountMinAtomic) < policy.minDeliveredWei) {
      throw new Error(
        `The ${policy.label} gas top-up did not return a usable rate. Try again shortly.`,
      );
    }
    report(`Buying ${policy.nativeSymbol} on ${policy.label} for gas from your Solana wallet.`);
    await runSolanaLeg({ request, solana, signal: args.signal });
  }

  report(`Waiting for the gas to land on ${shortfall.chainLabel}.`);
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  let last = shortfall.balanceWei;
  for (;;) {
    if (args.signal?.aborted) break;
    try {
      last = await readNativeBalance(evm, shortfall.chainId);
      if (last >= shortfall.requiredWei) return;
    } catch {
      // Transient read failure; the next poll retries.
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, ARRIVAL_POLL_MS));
  }
  throw new Error(
    `The gas top-up settled but the ${shortfall.chainLabel} balance has not caught up. Your funds are safe. Try again in a moment.`,
  );
}

export function formatNative(wei: bigint, symbol: string): string {
  const n = Number(wei) / 1e18;
  return `${n < 0.001 ? n.toFixed(6) : n.toFixed(4)} ${symbol}`;
}
