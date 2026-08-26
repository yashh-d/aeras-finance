"use client";

// Access the user's Privy embedded EVM wallet. The root `useWallets` from
// `@privy-io/react-auth` returns EVM wallets (the `/solana` subpath returns
// Solana wallets). Trustware signs the source-chain leg of a cross-chain
// conversion through this wallet's EIP-1193 provider; the destination is just
// the user's Solana address (recipient only).

import { useWallets, type EIP1193Provider } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef } from "react";

export interface EmbeddedEvmWallet {
  // The 0x address. Same address across every EVM chain (Monad, Ethereum, Base...).
  address: string | undefined;
  // True once an embedded EVM wallet exists on the user.
  ready: boolean;
  // Switch the WALLET's active chain. This must happen at the wallet level,
  // not via wallet_switchEthereumChain on a provider: Privy binds each provider
  // instance to the chain that was active when it was requested, and the
  // signing confirmation follows the wallet's active chain. Switching only a
  // provider once presented a Monad vault approval on Ethereum. After calling
  // this, request a FRESH provider via getProvider; a provider obtained before
  // the switch keeps its old binding (Privy documents this on switchChain).
  switchChain: (chainId: number) => Promise<void>;
  // Resolve an EIP-1193 provider bound to the wallet's currently active chain.
  // Throws if no embedded EVM wallet is available.
  getProvider: () => Promise<EIP1193Provider>;
}

export function useEmbeddedEvmWallet(): EmbeddedEvmWallet {
  const { wallets } = useWallets();

  // Privy provisions embedded wallets with walletClientType "privy".
  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === "privy"),
    [wallets],
  );

  // Privy stores the active chain in React state: switchChain writes the new
  // chain id and the NEXT render rebuilds the wallet object with it baked in
  // (verified in the SDK source, v3.26.1). A callback that closed over
  // `embedded` therefore keeps resolving providers bound to the old chain for
  // as long as it lives, which made every first-attempt Monad flow fail its
  // chain read-back while a fresh second attempt worked. This ref always
  // points at the latest wallet object, so an in-flight flow picks up the
  // switch as soon as Privy re-renders.
  const embeddedRef = useRef(embedded);
  useEffect(() => {
    embeddedRef.current = embedded;
  }, [embedded]);

  const switchChain = useCallback(async (chainId: number): Promise<void> => {
    const wallet = embeddedRef.current;
    if (!wallet) {
      throw new Error("No embedded EVM wallet available.");
    }
    // Throws if the chain is not in the provider config's supportedChains,
    // which is the loud failure we want instead of signing elsewhere.
    await wallet.switchChain(chainId);
  }, []);

  const getProvider = useCallback(async (): Promise<EIP1193Provider> => {
    const wallet = embeddedRef.current;
    if (!wallet) {
      throw new Error("No embedded EVM wallet available.");
    }
    return wallet.getEthereumProvider();
  }, []);

  return {
    address: embedded?.address,
    ready: Boolean(embedded),
    switchChain,
    getProvider,
  };
}
