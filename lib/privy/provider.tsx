"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { base, bsc, mainnet, monad } from "viem/chains";
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
          // Both chain types, so an EVM wallet (MetaMask and friends) can sign
          // a user in alongside the Solana wallets. This only widens the login
          // modal: it does not make an external wallet the account the app
          // operates on. See the embeddedWallets note below.
          walletChainType: "ethereum-and-solana",
          // Privy's built-in default is
          // ['detected_ethereum_wallets', 'detected_solana_wallets', 'metamask',
          //  'coinbase_wallet', 'rainbow', 'base_account', 'wallet_connect',
          //  'phantom'], filtered by walletChainType. Spelled out here to
          //  control the order and to add the Solana wallets Privy does not
          //  list by default. Solana entries lead because Solana is where
          //  positions settle.
          walletList: [
            "detected_solana_wallets",
            "phantom",
            "solflare",
            "backpack",
            "detected_ethereum_wallets",
            "metamask",
            "coinbase_wallet",
            "okx_wallet",
            "wallet_connect",
          ],
          landingHeader: "Sign in to Aeras",
        },
        embeddedWallets: {
          // "all-users", not "users-without-wallets". A user who signs in with
          // Phantom or MetaMask already has a wallet, so the narrower setting
          // would provision nothing and leave them with no account to hold a
          // position in. An external wallet is identity and a funding source
          // here; the embedded wallet is what the app reads balances from and
          // signs with, which is what lets every downstream flow stay
          // popup-free (see showWalletUIs below). lib/privy/solana.ts and
          // lib/privy/evm.ts are the only places that resolve it, and both pin
          // to walletClientType "privy" rather than trusting array order.
          solana: { createOnLogin: "all-users" },
          // EVM embedded wallet holds/signs the source-chain asset for the
          // Trustware cross-chain conversion, and the Morpho venues on Monad
          // and Ethereum. It is not the user's connected MetaMask.
          ethereum: { createOnLogin: "all-users" },
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
        // Morpho-on-Monad earn venue. Base is declared so the embedded wallet
        // can sign the return leg in lib/trustware/base.ts, which is the only
        // reason Base is offered at all: it holds no position and hosts no
        // venue, so without a signable way off it, USDC sent there would be
        // stuck. Ethereum stays default because it carries the deeper
        // tokenized-stock liquidity; both the Morpho and Base flows switch the
        // wallet themselves before signing.
        supportedChains: [mainnet, bsc, monad, base],
        defaultChain: mainnet,
        solana: { rpcs: solanaRpcs },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
