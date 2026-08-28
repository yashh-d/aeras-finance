"use client";

import bs58 from "bs58";
import { useSignMessage } from "@privy-io/react-auth/solana";

import {
  requireEmbeddedSolanaWallet,
  useEmbeddedSolanaWallet,
} from "@/lib/privy/solana";

// Signs a UTF-8 message with the Privy embedded Solana wallet and returns the
// signature base58-encoded, which is the form the Jupiter Trigger auth/verify
// endpoint expects. Companion to useSignSolanaTxBase64 in ./sign.ts.
export function useSignSolanaMessage() {
  const { signMessage } = useSignMessage();
  const { wallet: embedded } = useEmbeddedSolanaWallet();

  return async function signMessageBs58(message: string): Promise<string> {
    const wallet = requireEmbeddedSolanaWallet(embedded);
    const encoded = new TextEncoder().encode(message);
    const { signature } = await signMessage({ message: encoded, wallet });
    return bs58.encode(signature);
  };
}
