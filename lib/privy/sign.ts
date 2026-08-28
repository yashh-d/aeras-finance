"use client";

import { useCallback } from "react";

import { useSignTransaction } from "@privy-io/react-auth/solana";

import {
  requireEmbeddedSolanaWallet,
  useEmbeddedSolanaWallet,
} from "@/lib/privy/solana";
import { getConnection } from "@/lib/solana/balances";
import { sendAndConfirm } from "@/lib/solana/send-confirm";

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
  const { wallet: embedded } = useEmbeddedSolanaWallet();

  return useCallback(
    async function signTxBase64(b64Tx: string): Promise<string> {
      const wallet = requireEmbeddedSolanaWallet(embedded);
      const transaction = base64ToBytes(b64Tx);
      const { signedTransaction } = await signTransaction({
        transaction,
        wallet,
      });
      return bytesToBase64(signedTransaction);
    },
    [signTransaction, embedded],
  );
}

// Sign, broadcast, and confirm in one call, resolving with the signature.
//
// The signing hook above stops at a signed blob, which is what Jupiter's execute
// endpoint wants. Trustware is the opposite: it needs us to broadcast the
// transaction ourselves and then hand it the resulting hash, so the caller needs
// a signature that is already on chain.
//
// Confirmation is not optional here. Reporting a hash to Trustware that never
// landed would leave it tracking a transaction that does not exist.
export function useSendSolanaTxBase64() {
  const signTxBase64 = useSignSolanaTxBase64();

  return useCallback(
    async function sendTxBase64(b64Tx: string): Promise<string> {
      const signed = await signTxBase64(b64Tx);
      const conn = getConnection();
      // No confirmation window is passed: Trustware built this transaction and
      // chose its blockhash, so sendAndConfirm reads expiry off the transaction
      // itself. It throws on both on-chain failure and expiry, which is what
      // the note above wants -- a hash only comes back if it really landed.
      return sendAndConfirm(conn, base64ToBytes(signed));
    },
    [signTxBase64],
  );
}
