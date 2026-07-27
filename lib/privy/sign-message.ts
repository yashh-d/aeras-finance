"use client";

import bs58 from "bs58";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";

// Signs a UTF-8 message with the Privy embedded Solana wallet and returns the
// signature base58-encoded, which is the form the Jupiter Trigger auth/verify
// endpoint expects. Companion to useSignSolanaTxBase64 in ./sign.ts.
export function useSignSolanaMessage() {
  const { signMessage } = useSignMessage();
  const { wallets } = useWallets();

  return async function signMessageBs58(message: string): Promise<string> {
    const wallet = wallets[0];
    if (!wallet) {
      throw new Error("No Solana wallet available to sign.");
    }
    const encoded = new TextEncoder().encode(message);
    const { signature } = await signMessage({ message: encoded, wallet });
    return bs58.encode(signature);
  };
}
