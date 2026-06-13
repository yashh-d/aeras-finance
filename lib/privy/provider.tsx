"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
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
          ethereum: { createOnLogin: "off" },
        },
        solana: { rpcs: solanaRpcs },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
