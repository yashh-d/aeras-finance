"use client";

import { useCallback, useRef } from "react";
import { useSignSolanaMessage } from "@/lib/privy/sign-message";
import { requestChallenge, verifyChallenge } from "./trigger";

// Jupiter issues a 24h JWT; refresh a little early to avoid edge-of-expiry 401s.
const JWT_TTL_MS = 23 * 60 * 60 * 1000;

interface CachedToken {
  wallet: string;
  token: string;
  expiresAt: number;
}

// Holds the Trigger JWT in memory only (per Jupiter's guidance — never localStorage),
// keyed to the wallet. ensureToken() returns a valid token, running the challenge ->
// signMessage -> verify flow on first use, on expiry, or when the wallet changes.
export function useTriggerAuth(walletAddress: string | null) {
  const signMessage = useSignSolanaMessage();
  const cache = useRef<CachedToken | null>(null);

  const ensureToken = useCallback(async (): Promise<string> => {
    if (!walletAddress) {
      throw new Error("Wallet is not ready yet.");
    }
    const cached = cache.current;
    if (
      cached &&
      cached.wallet === walletAddress &&
      cached.expiresAt > Date.now()
    ) {
      return cached.token;
    }

    const { challenge } = await requestChallenge(walletAddress);
    const signature = await signMessage(challenge);
    const { token } = await verifyChallenge(walletAddress, signature);

    cache.current = {
      wallet: walletAddress,
      token,
      expiresAt: Date.now() + JWT_TTL_MS,
    };
    return token;
  }, [walletAddress, signMessage]);

  // Returns the cached token if one is valid for this wallet, without prompting a
  // signature. Lets read-only views (the open-orders list) avoid forcing a sign-in
  // until the user has already authenticated by placing an order.
  const peekToken = useCallback((): string | null => {
    const cached = cache.current;
    if (
      cached &&
      cached.wallet === walletAddress &&
      cached.expiresAt > Date.now()
    ) {
      return cached.token;
    }
    return null;
  }, [walletAddress]);

  // Drop the cached token so the next ensureToken() re-authenticates (e.g. after a 401).
  const reset = useCallback(() => {
    cache.current = null;
  }, []);

  return { ensureToken, peekToken, reset };
}

export type TriggerAuth = ReturnType<typeof useTriggerAuth>;
