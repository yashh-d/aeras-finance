"use client";

// Posting margin to Lighter from inside the app.
//
// This replaces the copy-this-address instruction the panel used to show. The
// address is still what Lighter wants the USDC sent to, but the user should
// never have to handle it: they hold the Solana wallet, the app holds the
// address, and a transfer between the two is something the app can do itself.
//
// The wallet is resolved here rather than passed in. The Privy Solana wallet is
// the same one the rest of the app signs with, and threading its address through
// the panel would only give a caller the chance to pass a different one.

import { useCallback, useMemo, useState } from "react";

import bs58 from "bs58";
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";

import type { AccountBalances } from "@/lib/solana/balances";
import type { WalletScan } from "@/lib/trustware/use-wallet-scan";

import { buildLighterDepositTransaction } from "./deposit";
import {
  fundingBlock,
  resolveMarginFunding,
  type FundingBlock,
  type MarginFunding,
} from "./funding";

export type DepositStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  // Landed on Solana. Lighter credits the L2 balance separately, which is why
  // this is not called "done": the user's margin has not moved yet.
  | { kind: "sent"; signature: string }
  | { kind: "error"; message: string };

export interface UseMarginFunding {
  funding: MarginFunding;
  block: FundingBlock;
  status: DepositStatus;
  // False only while the wallet is still provisioning.
  ready: boolean;
  deposit: (amountUsdc: string) => Promise<void>;
  reset: () => void;
}

export function useMarginFunding(params: {
  balances: AccountBalances | null;
  scan: WalletScan;
  depositAddress: string | undefined;
}): UseMarginFunding {
  const { balances, scan, depositAddress } = params;

  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { wallets } = useWallets();
  const [status, setStatus] = useState<DepositStatus>({ kind: "idle" });

  const funding = useMemo(
    () =>
      resolveMarginFunding({
        // Atomic, not the float field: a rounded-up balance sizes a transfer the
        // wallet cannot cover and the whole deposit fails on chain.
        solanaUsdcAtomic: balances?.usdcAtomic ?? "0",
        stables: scan.stables,
      }),
    [balances, scan.stables],
  );

  const walletAddress = wallets[0]?.address;

  const deposit = useCallback(
    async (amountUsdc: string) => {
      if (!walletAddress || !depositAddress) return;

      setStatus({ kind: "sending" });
      try {
        const built = await buildLighterDepositTransaction({
          sender: walletAddress,
          intentAddress: depositAddress,
          amountUsdc,
        });
        const { signature } = await signAndSendTransaction({
          transaction: built.transaction,
          wallet: wallets[0],
        });
        setStatus({ kind: "sent", signature: bs58.encode(signature) });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [walletAddress, depositAddress, signAndSendTransaction, wallets],
  );

  return {
    funding,
    block: useMemo(() => fundingBlock(funding), [funding]),
    status,
    ready: Boolean(walletAddress && depositAddress),
    deposit,
    reset: useCallback(() => setStatus({ kind: "idle" }), []),
  };
}
