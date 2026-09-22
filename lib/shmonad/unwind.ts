"use client";

// The way home: native MON in the Monad wallet back to the Solana wallet as
// USDC, one Trustware route. Verified 2026-09-22 (scripts/shmonad-check.mts
// section 5): the native-MON-source route carries `value`, needs no ERC-20
// approval, and delivers Solana USDC. executeEvmRoute already forwards
// `value` through buildEvmTxParams, so this is the return leg in
// lib/morpho/fund.ts with the source token swapped.
//
// The two-leg fallback the plan names (MON -> Monad USDC, then
// sendMonadUsdcToSolana) is not built, because the single leg is verified;
// if a future check shows the native source no longer routes, build it there.

import { USDC_MINT } from "@/lib/jupiter/constants";
import { MONAD_CHAIN_ID } from "@/lib/morpho/constants";
import type { EvmSigner, MorphoTxProgress } from "@/lib/morpho/deposit";
import { GAS_FLOOR_WEI, quoteFunding, type QuoteFn } from "@/lib/morpho/fund";
import { fetchTrustwareQuoteViaProxy } from "@/lib/trustware/client";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
} from "@/lib/trustware/constants";
import { executeEvmRoute } from "@/lib/trustware/execute";
import type { TrustwareQuoteRequest } from "@/lib/trustware/types";

import { EXIT_GAS_MIN_WEI, SHMON_FUNDING_TOKEN } from "./constants";
import { stakeableAfterReserve } from "./math";

type Report = (p: MorphoTxProgress) => void;

export function monReturnRequest(
  monAtomic: string,
  evmAddress: string,
  solanaAddress: string,
): TrustwareQuoteRequest {
  return {
    fromChain: String(MONAD_CHAIN_ID),
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: SHMON_FUNDING_TOKEN,
    toToken: USDC_MINT,
    fromAmount: monAtomic,
    fromAddress: evmAddress,
    toAddress: solanaAddress,
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
  };
}

// MON the wallet can send home: the balance less the gas reserve, which pays
// for this very transaction and stays for the next exit.
export function maxReturnableMonAtomic(walletMonAtomic: string): bigint {
  return stakeableAfterReserve(BigInt(walletMonAtomic || "0"), GAS_FLOOR_WEI);
}

export async function quoteMonToSolana(args: {
  monAtomic: bigint;
  evmAddress: string;
  solanaAddress: string;
  fetchQuote?: QuoteFn;
}): Promise<{ toAmountMinAtomic: string; totalFeesUsd: number | null }> {
  return quoteFunding(
    monReturnRequest(args.monAtomic.toString(), args.evmAddress, args.solanaAddress),
    args.fetchQuote ?? fetchTrustwareQuoteViaProxy,
  );
}

// Send MON home as Solana USDC. Fees come out of the delivered side; gas is
// the reserve. Returns what Trustware reports delivered, when it does.
export async function sendMonToSolana(args: {
  monAtomic: bigint;
  walletMonAtomic: string;
  evm: EvmSigner;
  solanaAddress: string;
  // Guaranteed-minimum USDC floor the fresh route must clear, 6-decimal.
  minUsdcAtomic?: bigint;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ deliveredAtomic: string | null }> {
  if (args.monAtomic <= 0n) throw new Error("Enter an amount above zero.");
  const wallet = BigInt(args.walletMonAtomic || "0");
  if (args.monAtomic > maxReturnableMonAtomic(args.walletMonAtomic)) {
    throw new Error("Amount is above what the wallet can send after its gas reserve.");
  }
  if (wallet - args.monAtomic < EXIT_GAS_MIN_WEI) {
    throw new Error("That would leave no MON to pay the gas for this transfer.");
  }
  const result = await executeEvmRoute({
    request: monReturnRequest(args.monAtomic.toString(), args.evm.address, args.solanaAddress),
    evm: args.evm,
    describe: "MON",
    minDeliveredAtomic: args.minUsdcAtomic ?? 0n,
    onProgress: (p) =>
      args.onProgress?.({
        stage: p.stage === "settled" ? "done" : "funding",
        message: p.stage === "settled" ? "USDC arrived on Solana." : p.message,
      }),
    signal: args.signal,
  });
  return { deliveredAtomic: result.deliveredAtomic };
}
