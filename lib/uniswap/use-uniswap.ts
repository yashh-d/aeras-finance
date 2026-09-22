"use client";

// Everything the liquidity pools card reads and signs with: the pool figures,
// the wallet's positions and balances, the embedded EVM wallet, and the
// Solana signer for the Trustware funding legs. Owned by the card, polled on
// the vault table's 60-second cadence, refreshed explicitly after every
// action.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import type { SolanaSigner } from "@/lib/trustware/execute";

import {
  fetchUniswapPools,
  fetchUniswapPositions,
  type UniswapPoolsPayload,
  type UniswapPositionsPayload,
} from "./client";
import { reconcilePendingMints } from "./deposit";

const POLL_MS = 60_000;

export interface UniswapEarn {
  pools: UniswapPoolsPayload | null;
  positions: UniswapPositionsPayload | null;
  positionsError: string | null;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  solanaSigner: SolanaSigner | undefined;
  // True until the first pools read lands.
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useUniswapEarn(walletAddress: string | undefined): UniswapEarn {
  const evm = useEmbeddedEvmWallet();
  const sendSolanaTx = useSendSolanaTxBase64();
  const [pools, setPools] = useState<UniswapPoolsPayload | null>(null);
  const [positions, setPositions] = useState<UniswapPositionsPayload | null>(null);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(true);

  const solanaSigner = useMemo<SolanaSigner | undefined>(
    () => (walletAddress ? { address: walletAddress, signAndSendBase64: sendSolanaTx } : undefined),
    [walletAddress, sendSolanaTx],
  );

  const evmAddress = evm.address;
  // A mint whose record call failed is retried from its stored hash once
  // per wallet per session, before the first positions read (D8).
  const reconciled = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    if (evmAddress && reconciled.current !== evmAddress) {
      reconciled.current = evmAddress;
      try {
        await reconcilePendingMints(evmAddress);
      } catch (err) {
        console.error("[uniswap reconcile]", err);
      }
    }
    const [p, q] = await Promise.allSettled([
      fetchUniswapPools(),
      evmAddress ? fetchUniswapPositions() : Promise.resolve(null),
    ]);
    if (!live.current) return;
    if (p.status === "fulfilled") setPools(p.value);
    else console.error("[uniswap pools]", p.reason);
    if (q.status === "fulfilled") {
      setPositions(q.value);
      setPositionsError(null);
    } else {
      console.error("[uniswap positions]", q.reason);
      setPositionsError(q.reason instanceof Error ? q.reason.message : String(q.reason));
    }
    setLoading(false);
  }, [evmAddress]);

  useEffect(() => {
    live.current = true;
    // Deferred a tick so the state writes land in a callback rather than in
    // the effect body, the pattern runs-client.ts uses for the lint rule.
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      live.current = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  return { pools, positions, positionsError, evm, solanaSigner, loading, refresh };
}
