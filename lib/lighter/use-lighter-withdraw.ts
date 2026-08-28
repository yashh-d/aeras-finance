"use client";

// The Withdraw button's state machine: Lighter margin, through the secure
// withdrawal, through the Ethereum resting stop, home to Solana.
//
// Three phases, each ending in a state that is safe to walk away from:
//
//   withdraw   sign with the trading key, submit, watch the margin debit.
//              After this the money is Lighter's problem until the delay
//              elapses; nothing the user does can lose it.
//   ethereum   the resting stop. USDC at the user's own address. The hook
//              polls for its arrival and simply reports what it sees; a user
//              can close the tab and come back tomorrow.
//   home       the Trustware return leg, offered once Ethereum shows a
//              balance, refused with a plain reason when gas cannot be paid.
//
// The phases are separate confirmations on purpose. The borrow flow chains its
// legs because its middle states are dangerous; this flow's middle state is
// money at rest in the user's own wallet, and chaining past it would mean
// signing an Ethereum transaction the user never saw coming.

import { useCallback, useEffect, useState } from "react";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";
import { useEmbeddedSolanaWallet } from "@/lib/privy/solana";
import type { ConversionProgress, EvmSigner } from "@/lib/trustware/execute";

import { useSignSolanaTxBase64 } from "@/lib/privy/sign";

import {
  checkEthGas,
  executeGasTopUp,
  fetchEthereumUsdcAtomic,
  planGasTopUp,
  sendEthereumUsdcHome,
} from "./bridge-home";
import { fetchLighterAccountState } from "./client";
import { ensureTradingKey } from "./onboarding";
import {
  executeSecureWithdraw,
  fetchWithdrawalDelaySeconds,
  planWithdraw,
  type WithdrawProgress,
} from "./withdraw";

export type LighterWithdrawState =
  | { kind: "idle" }
  | { kind: "withdrawing"; progress: WithdrawProgress }
  | {
      kind: "submitted";
      amountUsd: number;
      delaySeconds: number | null;
    }
  | { kind: "topping-up"; message: string }
  | { kind: "bridging"; message: string }
  | { kind: "bridged"; deliveredUsd: number | null }
  | { kind: "error"; message: string };

export interface UseLighterWithdraw {
  state: LighterWithdrawState;
  // Live secure-withdrawal delay for display, null until read.
  delaySeconds: number | null;
  // USDC currently resting at the EVM address on Ethereum, from earlier
  // withdrawals included. Null until the first scan lands.
  ethereumUsdc: number | null;
  // Whether the wallet can pay the return leg's gas right now.
  ethGasOk: boolean | null;
  ready: boolean;
  withdraw: (amountUsd: number, availableUsd: number) => Promise<void>;
  bridgeHome: () => Promise<void>;
  // Buy a little ETH with Solana USDC so bridgeHome can run. One Solana
  // signature; refuses with a plain reason when gas is expensive or the
  // Solana balance cannot cover it.
  topUpGas: (solanaUsdcAtomic: bigint) => Promise<void>;
  reset: () => void;
}

export function useLighterWithdraw(params: {
  accountIndex: number | undefined;
  onSettled?: () => void;
}): UseLighterWithdraw {
  const evm = useEmbeddedEvmWallet();
  const { address: solanaAddress } = useEmbeddedSolanaWallet();
  const signSolanaBase64 = useSignSolanaTxBase64();

  const [state, setState] = useState<LighterWithdrawState>({ kind: "idle" });
  const [delaySeconds, setDelaySeconds] = useState<number | null>(null);
  const [ethereumUsdc, setEthereumUsdc] = useState<number | null>(null);
  const [ethGasOk, setEthGasOk] = useState<boolean | null>(null);
  const [scanTick, setScanTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seconds = await fetchWithdrawalDelaySeconds();
      if (!cancelled) setDelaySeconds(seconds);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The Ethereum resting balance. Scanned on mount and on demand, not on an
  // interval: a pending withdrawal takes the posted delay to land, and the
  // user drives the re-check with the refresh this hook's card offers.
  useEffect(() => {
    if (!evm.address) return;
    let cancelled = false;
    (async () => {
      try {
        const address = evm.address as string;
        const atomic = await fetchEthereumUsdcAtomic(address);
        if (!cancelled) setEthereumUsdc(Number(atomic) / 1e6);
        if (atomic > 0n) {
          const gas = await checkEthGas({
            address,
            switchChain: evm.switchChain,
            getProvider: evm.getProvider,
          });
          if (!cancelled) setEthGasOk(gas.ok);
        }
      } catch (err) {
        console.error("[lighter withdraw scan]", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // evm is a stable hook object; address is the value that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evm.address, scanTick]);

  const withdraw = useCallback(
    async (amountUsd: number, availableUsd: number) => {
      if (!evm.address || params.accountIndex == null) return;

      const plan = planWithdraw({ amountUsd, availableUsd, delaySeconds });
      if (!plan.ok) {
        setState({ kind: "error", message: plan.reason ?? "Cannot withdraw." });
        return;
      }

      setState({
        kind: "withdrawing",
        progress: { stage: "signing", message: "Preparing." },
      });
      try {
        // The trading key lives in WASM memory and dies with the page, so it
        // is re-derived (one gasless signature) whenever this session has not
        // signed yet. Same precondition every order placement runs.
        const provider = await evm.getProvider();
        const { onboarding } = await ensureTradingKey({
          provider,
          l1Address: evm.address as string,
        });
        if (onboarding.status !== "ready") {
          setState({
            kind: "error",
            message:
              "The trading key is not registered yet. Place any order once, or retry in a few seconds.",
          });
          return;
        }

        // The nonce comes off a fresh account read, the same source every
        // order uses. The account state is cached for a few seconds along the
        // way; a nonce gone stale in that window is rejected by the sequencer
        // and surfaces as a retryable error, never as a lost withdrawal.
        const state = await fetchLighterAccountState(evm.address as string);
        const nonce = state.nextNonce;
        const outcome = await executeSecureWithdraw({
          accountIndex: params.accountIndex,
          amountUsd,
          availableBeforeUsd: availableUsd,
          nonce,
          l1Address: evm.address as string,
          onProgress: (progress) =>
            setState({ kind: "withdrawing", progress }),
        });

        if (outcome.kind === "blocked") {
          setState({ kind: "error", message: outcome.message });
        } else {
          setState({
            kind: "submitted",
            amountUsd: outcome.amountUsd,
            delaySeconds: outcome.delaySeconds,
          });
        }
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        params.onSettled?.();
      }
    },
    [evm, params, delaySeconds],
  );

  const bridgeHome = useCallback(async () => {
    if (!evm.address || !solanaAddress) return;
    setState({ kind: "bridging", message: "Preparing the route." });
    try {
      const signer: EvmSigner = {
        address: evm.address as string,
        switchChain: evm.switchChain,
        getProvider: evm.getProvider,
      };
      const atomic = await fetchEthereumUsdcAtomic(signer.address);
      const result = await sendEthereumUsdcHome({
        amountAtomic: atomic,
        evm: signer,
        solanaAddress,
        onProgress: (p: ConversionProgress) =>
          setState({ kind: "bridging", message: p.message }),
      });
      setState({
        kind: "bridged",
        deliveredUsd: result.deliveredAtomic
          ? Number(result.deliveredAtomic) / 1e6
          : null,
      });
      setScanTick((n) => n + 1);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      params.onSettled?.();
    }
  }, [evm, solanaAddress, params]);

  const topUpGas = useCallback(
    async (solanaUsdcAtomic: bigint) => {
      if (!evm.address || !solanaAddress) return;
      const signer: EvmSigner = {
        address: evm.address as string,
        switchChain: evm.switchChain,
        getProvider: evm.getProvider,
      };
      setState({ kind: "topping-up", message: "Pricing the ETH top-up." });
      try {
        const plan = await planGasTopUp({
          evm: signer,
          solanaAddress,
          solanaUsdcAtomic,
        });
        if (!plan.ok) {
          setState({ kind: "error", message: plan.reason ?? "Cannot top up." });
          return;
        }
        await executeGasTopUp({
          plan,
          evm: signer,
          solanaAddress,
          signAndSendBase64: signSolanaBase64,
          onProgress: (message) => setState({ kind: "topping-up", message }),
        });
        setEthGasOk(true);
        setState({ kind: "idle" });
        setScanTick((n) => n + 1);
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [evm, solanaAddress, signSolanaBase64],
  );

  return {
    state,
    delaySeconds,
    ethereumUsdc,
    ethGasOk,
    ready: Boolean(evm.address && params.accountIndex != null),
    withdraw,
    bridgeHome,
    topUpGas,
    reset: useCallback(() => {
      setState({ kind: "idle" });
      setScanTick((n) => n + 1);
    }, []),
  };
}
