"use client";

// Getting assets back out of Ondo.
//
// The mirror of useOndoMargin, and deliberately a much shorter file, because
// the two directions are not symmetric. Funding has to bridge, so it prices a
// route, guards against a lossy one, and signs on Solana. Withdrawing does not:
// Ondo performs the Ethereum transfer and pays the gas, so the only signature
// on this path is an off-chain one, and it is only needed once.
//
// Two steps, in order:
//
//   1. Register. One personal_sign, free, and only ever over the wallet that
//      owns the session. Ondo refuses a withdrawal to an unregistered address.
//   2. Withdraw. A plain API call. What lands is the asset that was deposited,
//      on Ethereum, in the user's own embedded EVM wallet.
//
// What this does NOT do is bring anything to Solana. That is a separate bridge
// leg with its own cost and its own failure modes, and it is not built yet.
// Every piece of copy here says Ethereum for that reason: a user who reads
// "withdrawn" as "back in my Solana wallet" has been misled by us, not by Ondo.

import { useCallback, useEffect, useRef, useState } from "react";

import { useEmbeddedEvmWallet } from "@/lib/privy/evm";

import { registerOndoWithdrawalAddress } from "./auth";
import {
  fetchOndoWithdrawalView,
  newWithdrawalId,
  submitOndoWithdrawal,
  type OndoWithdrawalReceipt,
} from "./client";
import type { OndoHolding, OndoWithdrawalView } from "./withdraw";

export type WithdrawStatus =
  | { kind: "idle" }
  | { kind: "registering" }
  | { kind: "working" }
  | { kind: "sent"; receipt: OndoWithdrawalReceipt }
  | { kind: "error"; message: string };

export interface UseOndoWithdraw {
  view: OndoWithdrawalView | null;
  loading: boolean;
  error: string | null;
  status: WithdrawStatus;
  register: () => Promise<void>;
  withdraw: (symbol: string, amount: string) => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

export function useOndoWithdraw(params?: {
  // Called after a withdrawal is accepted, so the surrounding surface can
  // re-read balances rather than waiting for its own poll.
  onWithdrawn?: () => void;
  // Defaults to true. Worth turning off until the surface actually has a
  // session: GET /api/ondo/withdraw fans out to eight upstream Ondo calls, and
  // a tab that renders before sign-in has nothing to spend them on. Matches the
  // `enabled` flag on usePerps.
  enabled?: boolean;
}): UseOndoWithdraw {
  const enabled = params?.enabled ?? true;
  const evm = useEmbeddedEvmWallet();
  const [view, setView] = useState<OndoWithdrawalView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<WithdrawStatus>({ kind: "idle" });

  // Derived rather than held, matching usePerps.
  //
  // `loaded` is separate from `view !== null` on purpose: a null view is the
  // ordinary answer for a user with no Ondo session, not a pending one, and
  // conflating them would show a spinner forever to someone who has simply
  // never signed in.
  const loading = enabled && !loaded && error === null;

  // One idempotency key per attempt, held across retries.
  //
  // This is the difference between a network timeout costing a retry and
  // costing a second withdrawal. Minting a fresh key on each attempt would make
  // every retry a new withdrawal in Ondo's eyes; reusing this one means the
  // second request is refused with `withdrawal_duplicate_customer_withdrawal_id`
  // rather than sending the money twice. Cleared only on success or on a
  // deliberate reset.
  const attemptId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      // Awaited into a local before any setState, so nothing in this function
      // runs synchronously when the mount effect calls it.
      const next = await fetchOndoWithdrawalView();
      setView(next);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const register = useCallback(async () => {
    if (!evm.address) {
      setStatus({
        kind: "error",
        message: "No embedded Ethereum wallet is available to sign.",
      });
      return;
    }

    setStatus({ kind: "registering" });
    try {
      // No chain switch. personal_sign is off-chain and the challenge states
      // its own chain id in the message text, exactly as the login flow does.
      const provider = await evm.getProvider();
      const { registered } = await registerOndoWithdrawalAddress(
        provider,
        evm.address,
        "Aeras wallet",
      );

      if (!registered) {
        setStatus({
          kind: "error",
          message:
            "Ondo accepted the signature but the address is not in the address book yet. Wait a moment and reload before withdrawing.",
        });
        await refresh();
        return;
      }

      setStatus({ kind: "idle" });
      await refresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [evm, refresh]);

  const withdraw = useCallback(
    async (symbol: string, amount: string) => {
      attemptId.current ??= newWithdrawalId();

      setStatus({ kind: "working" });
      try {
        const receipt = await submitOndoWithdrawal({
          symbol,
          amount,
          customerWithdrawalId: attemptId.current,
        });

        attemptId.current = null;
        setStatus({ kind: "sent", receipt });
        await refresh();
        params?.onWithdrawn?.();
      } catch (err) {
        // The key is kept. Whatever failed, a retry of the same attempt has to
        // carry the same id, because the one failure mode worth protecting
        // against is a request Ondo accepted and we did not see the answer to.
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [refresh, params],
  );

  return {
    view,
    loading,
    error,
    status,
    register,
    withdraw,
    refresh,
    reset: useCallback(() => {
      attemptId.current = null;
      setStatus({ kind: "idle" });
    }, []),
  };
}

// Largest holding with something withdrawable, for the default selection.
export function defaultHolding(view: OndoWithdrawalView | null): OndoHolding | null {
  if (!view) return null;
  return (
    view.holdings.find((h) => h.withdrawableQuantity > 0) ?? view.holdings[0] ?? null
  );
}
