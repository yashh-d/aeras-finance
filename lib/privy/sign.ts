"use client";

import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useSignSolanaTxBase64() {
  const { signTransaction } = useSignTransaction();
  const { wallets } = useWallets();

  return async function signTxBase64(b64Tx: string): Promise<string> {
    const wallet = wallets[0];
    if (!wallet) {
      throw new Error("No Solana wallet available to sign.");
    }
    const transaction = base64ToBytes(b64Tx);
    const { signedTransaction } = await signTransaction({ transaction, wallet });
    return bytesToBase64(signedTransaction);
  };
}
