"use client";

// Everything the shMON card reads and signs with: live metrics, the wallet's
// position, the MON price, the embedded EVM wallet, and the Solana signer for
// the Trustware funding leg. Owned by the card, polled on the vault table's
// 60-second cadence, refreshed explicitly after every action.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useSendSolanaTxBase64 } from "@/lib/privy/sign";
import type { SolanaSigner } from "@/lib/trustware/execute";

import {
  fetchMonUsd,
  fetchShmonMetrics,
  fetchShmonPosition,
  type ShmonMetrics,
  type ShmonPosition,
} from "./client";

const POLL_MS = 60_000;

export interface ShmonEarn {
  metrics: ShmonMetrics | null;
  position: ShmonPosition | null;
  monUsd: number | null;
  evm: ReturnType<typeof useEmbeddedEvmWallet>;
  solanaSigner: SolanaSigner | undefined;
  // True until the first metrics read lands.
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useShmonEarn(walletAddress: string | undefined): ShmonEarn {
  const evm = useEmbeddedEvmWallet();
  const sendSolanaTx = useSendSolanaTxBase64();
  const [metrics, setMetrics] = useState<ShmonMetrics | null>(null);
  const [position, setPosition] = useState<ShmonPosition | null>(null);
  const [monUsd, setMonUsd] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(true);

  const solanaSigner = useMemo<SolanaSigner | undefined>(
    () =>
      walletAddress
        ? { address: walletAddress, signAndSendBase64: sendSolanaTx }
        : undefined,
    [walletAddress, sendSolanaTx],
  );

  const evmAddress = evm.address;
  const refresh = useCallback(async () => {
    const [m, p, usd] = await Promise.allSettled([
      fetchShmonMetrics(),
      evmAddress ? fetchShmonPosition(evmAddress) : Promise.resolve(null),
      fetchMonUsd(),
    ]);
    if (!live.current) return;
    if (m.status === "fulfilled") setMetrics(m.value);
    else console.error("[shmonad metrics]", m.reason);
    if (p.status === "fulfilled") setPosition(p.value);
    else console.error("[shmonad position]", p.reason);
    if (usd.status === "fulfilled" && usd.value != null) setMonUsd(usd.value);
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

  return { metrics, position, monUsd, evm, solanaSigner, loading, refresh };
}
