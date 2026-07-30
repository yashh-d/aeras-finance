"use client";

// Access the user's Privy embedded EVM wallet. The root `useWallets` from
// `@privy-io/react-auth` returns EVM wallets (the `/solana` subpath returns
// Solana wallets). Trustware signs the source-chain leg of a cross-chain
// conversion through this wallet's EIP-1193 provider; the destination is just
// the user's Solana address (recipient only).

import { useWallets, type EIP1193Provider } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";

export interface EmbeddedEvmWallet {
  // The 0x address. Same address across every EVM chain (Monad, Ethereum, Base...).
  address: string | undefined;
  // True once an embedded EVM wallet exists on the user.
  ready: boolean;
  // Resolve the EIP-1193 provider Trustware signs through. Throws if no
  // embedded EVM wallet is available.
  getProvider: () => Promise<EIP1193Provider>;
}

export function useEmbeddedEvmWallet(): EmbeddedEvmWallet {
  const { wallets } = useWallets();

  // Privy provisions embedded wallets with walletClientType "privy".
  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === "privy"),
    [wallets],
  );

  const getProvider = useCallback(async (): Promise<EIP1193Provider> => {
    if (!embedded) {
      throw new Error("No embedded EVM wallet available.");
    }
    return embedded.getEthereumProvider();
  }, [embedded]);

  return {
    address: embedded?.address,
    ready: Boolean(embedded),
    getProvider,
  };
}
