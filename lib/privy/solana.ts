"use client";

// Access the user's Privy embedded Solana wallet. Companion to ./evm.ts, and
// the single place the app decides which Solana wallet it operates on.
//
// This exists because external wallets are a login method. Before that, every
// user had exactly one Solana wallet and `useWallets().wallets[0]` was always
// the embedded one. Now a user who signs in with Phantom has two, and the SDK
// sorts that array by connectedAt, so index 0 is whichever connected most
// recently. Positions live in the embedded wallet (see CLAUDE.md: an external
// wallet is identity and a funding source, never the account the app trades
// from), so reading or signing with the wrong one silently operates on the
// wrong account.
//
// The Solana subpath's ConnectedStandardSolanaWallet carries no
// walletClientType, so the embedded wallet cannot be picked out of that array
// directly the way ./evm.ts picks the EVM one. The linked account does carry
// it, so resolve the embedded address from `user.linkedAccounts` and match the
// signer object by address.

import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import {
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { useMemo } from "react";

export interface EmbeddedSolanaWallet {
  // The signer object, for passing to useSignTransaction / useSignMessage /
  // useSignAndSendTransaction. Undefined until Privy has provisioned it.
  wallet: ConnectedStandardSolanaWallet | undefined;
  // The base58 address. This is the account every balance and position is
  // read against.
  address: string | undefined;
  // True once the embedded wallet exists and is connected.
  ready: boolean;
}

export function useEmbeddedSolanaWallet(): EmbeddedSolanaWallet {
  const { user } = usePrivy();
  const { wallets } = useWallets();

  // Privy provisions embedded wallets with walletClientType "privy". A user
  // may also have linked an external Solana wallet; that one is skipped here.
  const address = useMemo(
    () =>
      user?.linkedAccounts.find(
        (account): account is WalletWithMetadata =>
          account.type === "wallet" &&
          account.walletClientType === "privy" &&
          account.chainType === "solana",
      )?.address,
    [user],
  );

  const wallet = useMemo(
    () => (address ? wallets.find((w) => w.address === address) : undefined),
    [wallets, address],
  );

  return { wallet, address, ready: Boolean(wallet) };
}

// Throwing accessor for call sites that are already inside an action and want
// to fail loudly rather than branch. The message is deliberately readable: it
// surfaces in the UI when a user reaches a signing path before Privy has
// finished provisioning the wallet.
export function requireEmbeddedSolanaWallet(
  wallet: ConnectedStandardSolanaWallet | undefined,
): ConnectedStandardSolanaWallet {
  if (!wallet) {
    throw new Error("Your Aeras wallet is still being set up. Try again in a moment.");
  }
  return wallet;
}
