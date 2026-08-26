"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { bsc, mainnet, monad } from "viem/chains";
import { useMemo, type ReactNode } from "react";

export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    throw new Error(
      "NEXT_PUBLIC_PRIVY_APP_ID is not set. Add it to .env.local.",
    );
  }
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      "NEXT_PUBLIC_SOLANA_RPC_URL is not set. Add it to .env.local.",
    );
  }

  const solanaRpcs = useMemo(
    () => ({
      "solana:mainnet": {
        rpc: createSolanaRpc(rpcUrl),
        rpcSubscriptions: createSolanaRpcSubscriptions(
          rpcUrl.replace(/^http/, "ws"),
        ),
        blockExplorerUrl: "https://explorer.solana.com",
      },
    }),
    [rpcUrl],
  );

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "light",
          walletChainType: "solana-only",
          landingHeader: "Sign in to Aeras",
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          // EVM embedded wallet holds/signs the source-chain asset for the
          // Trustware cross-chain conversion. It is not a login method; Solana
          // stays the primary wallet (walletChainType above is unchanged).
          ethereum: { createOnLogin: "users-without-wallets" },
          // No per-transaction confirmation modals for embedded wallets. The
          // product thesis is that users do not want to touch a wallet UI, and
          // a funded Morpho deposit signs several transactions (bridge legs,
          // approve, deposit) that must read as one action. The app's own UI
          // is the confirmation surface: amounts are previewed before submit
          // and every stage is reported as progress.
          showWalletUIs: false,
        },
        // Chains the embedded EVM wallet is allowed to sign on. Privy defaults
        // an embedded wallet to `defaultChain` or the first supported chain, so
        // without declaring BNB Chain here the BSC half of the Trustware
        // equivalence registry could not be signed for. Monad is declared so the
        // embedded wallet can sign the ERC-4626 deposit/withdraw for the
        // Morpho-on-Monad earn venue. Ethereum stays default because it carries
        // the deeper tokenized-stock liquidity; the Morpho flow switches the
        // wallet to Monad itself before signing.
        supportedChains: [mainnet, bsc, monad],
        defaultChain: mainnet,
        solana: { rpcs: solanaRpcs },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
