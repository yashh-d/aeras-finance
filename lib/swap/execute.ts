"use client";

// Execute a priced swap. One entry point, three paths, chosen by the quote:
//
//   Jupiter                Solana to Solana. Build from the quote Jupiter
//                          returned, sign, broadcast.
//   Trustware, Solana in   Route the exact request that was priced, sign the
//                          Solana transaction, track to settlement.
//   Trustware, EVM in      Same, through the embedded EVM wallet: allowance,
//                          chain switch, broadcast, receipt, settlement.
//
// Nothing here prices anything. lib/trustware/swap-quote.ts does that and
// hands the executor what it needs on the quote itself (`jupiter` or
// `request`), so what runs is what was shown. The guaranteed minimum on the
// quote is the floor the Trustware paths refuse to sign below.

import { executeSolanaConversion } from "@/lib/jupiter/convert";
import {
  executeEvmRoute,
  executeSolanaRoute,
  type ConversionProgress,
  type EvmSigner,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import type { SwapQuote } from "@/lib/trustware/swap-quote";

export interface SwapResult {
  // The source transaction: a Solana signature or an EVM hash.
  sourceTxHash: string;
  // Destination units actually delivered, when the bridge reports them. A
  // same-chain Jupiter swap reports null; the wallet refresh shows it.
  deliveredAtomic: string | null;
}

export async function executeSwap(args: {
  quote: SwapQuote;
  solana: SolanaSigner;
  evm: EvmSigner | null;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
}): Promise<SwapResult> {
  const { quote, solana, evm, onProgress, signal } = args;
  const describe = `${quote.from.symbol} to ${quote.to.symbol}`;

  if (quote.engine === "jupiter") {
    if (!quote.jupiter) throw new Error("This quote cannot be executed. Get a fresh one.");
    onProgress?.({ stage: "signing", message: `Swapping ${describe} on Jupiter.` });
    const { signature } = await executeSolanaConversion({
      quote: quote.jupiter,
      userPublicKey: solana.address,
      signAndSendBase64: solana.signAndSendBase64,
    });
    onProgress?.({ stage: "settled", message: `${quote.to.symbol} is in your wallet.`, sourceTxHash: signature });
    return { sourceTxHash: signature, deliveredAtomic: null };
  }

  if (!quote.request) throw new Error("This quote cannot be executed. Get a fresh one.");
  const minDeliveredAtomic = BigInt(quote.toAmountMinAtomic || "0");

  if (quote.from.kind === "solana") {
    const r = await executeSolanaRoute({
      request: quote.request,
      solana,
      describe,
      minDeliveredAtomic,
      onProgress,
      signal,
    });
    return { sourceTxHash: r.sourceTxHash, deliveredAtomic: r.deliveredAtomic };
  }

  if (!evm) throw new Error("No embedded EVM wallet is available to sign.");
  const r = await executeEvmRoute({
    request: quote.request,
    evm,
    describe,
    minDeliveredAtomic,
    onProgress,
    signal,
  });
  return { sourceTxHash: r.sourceTxHash, deliveredAtomic: r.deliveredAtomic };
}
