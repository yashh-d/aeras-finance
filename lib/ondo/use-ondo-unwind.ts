"use client";

// Bringing withdrawn Ondo collateral home to Solana.
//
// Two jobs, and the first one matters as much as the second.
//
// **It reads the Ethereum balances directly.** The shared wallet scan cannot
// show them: it filters cross-chain holdings through the equivalence registry
// in lib/trustware/equivalents.ts, every entry there is built around a Jupiter
// Lend borrow vault, and only four xStocks have one. So a withdrawn SPCXon is
// confirmed on chain and invisible on every screen in this app. Rather than
// widen that registry, which is load-bearing for the borrow surface and would
// throw on any underlying without a vault, this reads `balanceOf` straight off
// each Ondo collateral contract. It is a handful of eth_calls against a fixed,
// server-derived token list, and it answers the only question that matters
// here: what is actually sitting in the wallet.
//
// **Then it converts.** See lib/ondo/unwind.ts for the guards.
//
// Every read goes through connectEvmChain, not a raw provider. A Privy provider
// is bound to whichever chain was active when it was requested, so a provider
// left on Monad answers an Ethereum balanceOf with a Monad balance, silently.

import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, erc20Abi } from "viem";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { atomicToUi, uiToAtomic } from "@/lib/trustware/amounts";
import { connectEvmChain, type ConversionProgress } from "@/lib/trustware/execute";

import type { OndoCollateral } from "./collateral";
import {
  executeOndoUnwind,
  planOndoUnwind,
  unwindTargetFor,
  type UnwindPlan,
} from "./unwind";

const ETHEREUM_CHAIN = "1";

export interface EthereumHolding {
  symbol: string;
  label: string;
  contractAddress: string;
  decimals: number;
  balanceAtomic: string;
  balanceTokens: number;
  valueUsd: number | null;
  // The Solana xStock it can be converted into, when one is registered.
  xstockSymbol: string | null;
}

export type UnwindStatus =
  | { kind: "idle" }
  | { kind: "pricing" }
  | { kind: "ready"; plan: UnwindPlan }
  | { kind: "confirm"; reason: string; lossBps: number }
  | { kind: "working"; message: string }
  | { kind: "sent"; sourceTxHash: string; destTxHash: string | null }
  | { kind: "error"; message: string };

export interface UseOndoUnwind {
  // Ondo collateral tokens actually held in the embedded Ethereum wallet.
  holdings: EthereumHolding[];
  // Native ETH, which pays for this leg. Ondo paid for the withdrawal; it does
  // not pay for this.
  gasWei: string;
  loading: boolean;
  error: string | null;
  status: UnwindStatus;
  refresh: () => Promise<void>;
  price: (symbol: string, amountUi: string, acceptLossBps?: number) => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => void;
}

export function useOndoUnwind(params: {
  collateral: OndoCollateral[];
  solanaAddress: string | undefined;
  enabled?: boolean;
  onDelivered?: () => void;
}): UseOndoUnwind {
  const enabled = params.enabled ?? true;
  const { collateral, solanaAddress } = params;

  // **Destructured, never used as an object in a dependency array.**
  //
  // `useEmbeddedEvmWallet` returns a fresh object literal on every render; it
  // memoizes `switchChain` and `getProvider` individually but not the wrapper.
  // Putting that object in a useCallback dep list makes the callback unstable,
  // and a useEffect keyed on that callback then re-runs on every render. Doing
  // exactly that here spun a loop that called switchChain and eth_call
  // continuously and took the wallet panel's other rows down with it.
  //
  // `address` is a string and the two callbacks are `useCallback(..., [])`, so
  // these three are stable and safe to depend on.
  const { address: evmAddress, switchChain, getProvider } = useEmbeddedEvmWallet();

  const [holdings, setHoldings] = useState<EthereumHolding[]>([]);
  const [gasWei, setGasWei] = useState("0");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<UnwindStatus>({ kind: "idle" });

  const loading = enabled && !loaded && error === null;

  const refresh = useCallback(async () => {
    if (!enabled || !evmAddress || collateral.length === 0) return;
    try {
      const provider = await connectEvmChain(
        { address: evmAddress, switchChain, getProvider },
        ETHEREUM_CHAIN,
      );

      const native = (await provider.request({
        method: "eth_getBalance",
        params: [evmAddress, "latest"],
      })) as string;

      // One eth_call per collateral token. The set is eight at most and comes
      // from Ondo's own live token config, so this is bounded and cannot be
      // widened by anything the browser says.
      const rows: EthereumHolding[] = [];
      for (const asset of collateral) {
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [evmAddress as `0x${string}`],
        });
        let raw: string;
        try {
          raw = (await provider.request({
            method: "eth_call",
            params: [{ to: asset.contractAddress, data }, "latest"],
          })) as string;
        } catch {
          // A token that will not answer balanceOf is skipped rather than
          // failing the whole read: one bad contract must not hide the others.
          continue;
        }

        const balanceAtomic = BigInt(raw || "0x0").toString();
        if (BigInt(balanceAtomic) <= 0n) continue;

        const balanceTokens = Number(atomicToUi(balanceAtomic, asset.decimals));
        const mark = Number(asset.markPriceUsd);
        rows.push({
          symbol: asset.symbol,
          label: asset.label,
          contractAddress: asset.contractAddress,
          decimals: asset.decimals,
          balanceAtomic,
          balanceTokens,
          valueUsd: asset.priceable && mark > 0 ? balanceTokens * mark : null,
          xstockSymbol: unwindTargetFor(asset.symbol)?.xstockSymbol ?? null,
        });
      }

      rows.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
      setHoldings(rows);
      setGasWei(BigInt(native || "0x0").toString());
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    }
  }, [enabled, evmAddress, switchChain, getProvider, collateral]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const price = useCallback(
    async (symbol: string, amountUi: string, acceptLossBps?: number) => {
      const asset = collateral.find((c) => c.symbol === symbol);
      const holding = holdings.find((h) => h.symbol === symbol);
      if (!asset || !holding) {
        setStatus({ kind: "error", message: `No ${symbol} balance on Ethereum.` });
        return;
      }
      if (!evmAddress) {
        setStatus({ kind: "error", message: "No embedded Ethereum wallet available." });
        return;
      }
      if (!solanaAddress) {
        setStatus({ kind: "error", message: "No Solana wallet available to receive." });
        return;
      }

      setStatus({ kind: "pricing" });
      try {
        const amountAtomic = uiToAtomic(amountUi, asset.decimals);
        if (BigInt(amountAtomic) > BigInt(holding.balanceAtomic)) {
          setStatus({
            kind: "error",
            message: `That is more than the ${holding.balanceTokens} ${symbol} in the wallet.`,
          });
          return;
        }

        // Gas price is read live rather than assumed. Ethereum was at 0.125
        // gwei when this was built, which makes the whole leg about $0.14; the
        // same two transactions at 40 gwei are $45, and the difference decides
        // whether this is worth doing at all on a small balance.
        const provider = await connectEvmChain(
          { address: evmAddress, switchChain, getProvider },
          ETHEREUM_CHAIN,
        );
        const gasPriceHex = (await provider.request({
          method: "eth_gasPrice",
          params: [],
        })) as string;

        const result = await planOndoUnwind({
          collateral: asset,
          amountAtomic,
          evmAddress,
          solanaAddress,
          gasBalanceWei: BigInt(gasWei),
          gasPriceWei: BigInt(gasPriceHex || "0x0"),
          acceptLossBps,
        });

        if (result.kind === "blocked") {
          setStatus({ kind: "error", message: result.reason });
          return;
        }
        if (result.kind === "needs-confirmation") {
          setStatus({ kind: "confirm", reason: result.reason, lossBps: result.lossBps });
          return;
        }
        setStatus({ kind: "ready", plan: result });
      } catch (err) {
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [collateral, holdings, evmAddress, switchChain, getProvider, solanaAddress, gasWei],
  );

  const confirm = useCallback(async () => {
    if (status.kind !== "ready" || !evmAddress || !solanaAddress) return;

    setStatus({ kind: "working", message: "Preparing the conversion." });
    try {
      const { sourceTxHash, destTxHash } = await executeOndoUnwind({
        plan: status.plan,
        evm: { address: evmAddress, switchChain, getProvider },
        solanaAddress,
        onProgress: (p: ConversionProgress) =>
          setStatus({ kind: "working", message: p.message }),
      });

      setStatus({ kind: "sent", sourceTxHash, destTxHash });
      await refresh();
      params.onDelivered?.();
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [status, evmAddress, switchChain, getProvider, solanaAddress, refresh, params]);

  return {
    holdings,
    gasWei,
    loading,
    error,
    status,
    refresh,
    price,
    confirm,
    reset: useCallback(() => setStatus({ kind: "idle" }), []),
  };
}
