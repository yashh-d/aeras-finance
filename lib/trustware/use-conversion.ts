"use client";

// Binds the conversion engine to the user's Privy wallets.
//
// executeConversion is deliberately signer-agnostic so it can be tested without
// React. This is the only place that knows a conversion is signed by Privy: it
// supplies the Solana wallet (always, since Solana is the destination and also
// the signer for Solana-to-Solana routes) and the embedded EVM wallet (only when
// the source is an EVM chain).

import { useCallback } from "react";

import { useWallets } from "@privy-io/react-auth/solana";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import { executeConversion, type ConversionProgress, type ConversionResult } from "./execute";
import type { ConvertThenDepositPlan } from "./planner";

export interface ConversionRunner {
  // True when the wallets a conversion needs are actually available. An EVM
  // source with no embedded EVM wallet cannot be signed, and finding that out
  // before the user commits is the whole point.
  canRun: (plan: ConvertThenDepositPlan) => boolean;
  run: (
    plan: ConvertThenDepositPlan,
    onProgress?: (progress: ConversionProgress) => void,
    signal?: AbortSignal,
  ) => Promise<ConversionResult>;
}

export function useConversionRunner(): ConversionRunner {
  const { wallets } = useWallets();
  const solanaAddress = wallets[0]?.address;
  const sendSolanaTx = useSendSolanaTxBase64();
  const evm = useEmbeddedEvmWallet();

  const canRun = useCallback(
    (plan: ConvertThenDepositPlan) =>
      Boolean(solanaAddress) &&
      (plan.source.kind === "solana" ? true : Boolean(evm.address)),
    [solanaAddress, evm.address],
  );

  const run = useCallback(
    async (
      plan: ConvertThenDepositPlan,
      onProgress?: (progress: ConversionProgress) => void,
      signal?: AbortSignal,
    ) => {
      if (!solanaAddress) {
        throw new Error("No Solana wallet is available to receive the conversion.");
      }
      if (plan.source.kind === "evm" && !evm.address) {
        throw new Error(
          `Your ${plan.source.chainLabel} wallet is not ready yet. Reload and try again.`,
        );
      }
      return executeConversion({
        plan,
        solana: { address: solanaAddress, signAndSendBase64: sendSolanaTx },
        evm: evm.address
          ? { address: evm.address, getProvider: evm.getProvider }
          : undefined,
        onProgress,
        signal,
      });
    },
    [solanaAddress, sendSolanaTx, evm.address, evm.getProvider],
  );

  return { canRun, run };
}
