"use client";

// Lighter margin back to the Solana wallet.
//
// Lighter cannot pay Solana. Its withdrawal machinery, verified against the
// docs, the Python SDK's source and lighter-go on 2026-08-27, offers exactly
// two exits and both end on Ethereum:
//
//   secure (tx type 13)  Signed by the L2 trading key alone. No fee, $1
//                        minimum, no destination field AT ALL: it can pay
//                        nothing but the account's own L1 address, as a
//                        claimable balance on the ZkLighter contract that
//                        Lighter usually claims on the user's behalf. The
//                        delay is dynamic (GET /withdrawalDelay; ~24 minutes
//                        when measured, up to a day when raised).
//   fast                 An L2 transfer to Lighter's pool account with the
//                        payout address in the memo. $4 minimum, dynamic fee,
//                        and TWO signatures: the trading key plus the Ethereum
//                        key over a template the signer emits. More surface,
//                        more upstream state, and the WASM we ship wraps no
//                        transfer call, so it is not buildable today anyway.
//
// So this module does the secure exit, and the road home is a second leg: the
// withdrawn USDC lands at the embedded EVM wallet on Ethereum, and Trustware's
// already-allowlisted funding-return shape (any source chain, Solana USDC
// destination) brings it back. That leg needs ETH for gas, which the wallet is
// born without; the flow surfaces that honestly instead of hiding the leg.
//
// The two legs are deliberately separate confirmations. Between them the money
// is at the user's own address on Ethereum, which is a resting state, not a
// stranding: nothing is lost by stopping there, unlike the borrow flow where
// the state between legs is a debt with no hedge.

import {
  LIGHTER_ASSET_ID_USDC,
  LIGHTER_MIN_SECURE_WITHDRAW_USDC,
  LIGHTER_ROUTE_PERP,
  LIGHTER_TX_TYPE_WITHDRAW,
} from "./constants";
import { fetchLighterAccountState, submitLighterTx } from "./client";
import { signWithdraw } from "./signer";

export type WithdrawStage =
  | "signing"
  | "submitting"
  | "confirming"
  | "done";

export interface WithdrawProgress {
  stage: WithdrawStage;
  message: string;
}

export type WithdrawOutcome =
  // Lighter accepted the withdrawal. The funds leave the margin balance now
  // and arrive at the L1 address after the current delay; nothing else in the
  // flow can fail in a way that loses them.
  | {
      kind: "submitted";
      txHash: string;
      amountUsd: number;
      delaySeconds: number | null;
    }
  | { kind: "blocked"; message: string };

// The current secure-withdrawal delay, in seconds. Dynamic on Lighter's side,
// so it is read live for display rather than hardcoded; null when the read
// fails, which only costs the UI a number.
export async function fetchWithdrawalDelaySeconds(): Promise<number | null> {
  try {
    const res = await fetch("/api/lighter/withdrawal-delay", {
      cache: "no-store",
    });
    const body = (await res.json()) as { seconds?: number };
    return typeof body.seconds === "number" ? body.seconds : null;
  } catch {
    return null;
  }
}

export interface WithdrawPlan {
  amountUsd: number;
  // What the account can actually spare: available balance, not collateral.
  // Margin backing an open position is not withdrawable, and asking for it
  // fails on Lighter's side after the signature was already spent.
  availableUsd: number;
  minimumUsd: number;
  delaySeconds: number | null;
  ok: boolean;
  reason?: string;
}

export function planWithdraw(args: {
  amountUsd: number;
  availableUsd: number;
  delaySeconds: number | null;
}): WithdrawPlan {
  const base = {
    amountUsd: args.amountUsd,
    availableUsd: args.availableUsd,
    minimumUsd: LIGHTER_MIN_SECURE_WITHDRAW_USDC,
    delaySeconds: args.delaySeconds,
  };
  if (!(args.amountUsd > 0)) {
    return { ...base, ok: false, reason: "Enter an amount to withdraw." };
  }
  if (args.amountUsd < LIGHTER_MIN_SECURE_WITHDRAW_USDC) {
    return {
      ...base,
      ok: false,
      reason: `Lighter's minimum withdrawal is $${LIGHTER_MIN_SECURE_WITHDRAW_USDC}.`,
    };
  }
  if (args.amountUsd > args.availableUsd) {
    return {
      ...base,
      ok: false,
      reason:
        "That is more than the margin not currently backing a position. " +
        "Close or reduce the position first.",
    };
  }
  return { ...base, ok: true };
}

// Sign and submit the secure withdrawal. The caller has already run
// ensureTradingKey, so the WASM signer session for this account exists.
//
// The amount crosses the wire in micro-USDC as a decimal string, matching the
// SDK (amounts are scaled per asset; USDC is 1e6). Floored, never rounded: a
// withdrawal rounded up past the available balance fails after the nonce was
// already consumed, and Lighter nonces are not free retries.
export async function executeSecureWithdraw(args: {
  accountIndex: number;
  amountUsd: number;
  // Available balance as the caller last read it, for confirming the debit.
  availableBeforeUsd: number;
  nonce: number;
  l1Address: string;
  onProgress?: (progress: WithdrawProgress) => void;
}): Promise<WithdrawOutcome> {
  const report = (stage: WithdrawStage, message: string) =>
    args.onProgress?.({ stage, message });

  const atomic = BigInt(Math.floor(args.amountUsd * 1e6));
  if (atomic < BigInt(LIGHTER_MIN_SECURE_WITHDRAW_USDC) * 1_000_000n) {
    return {
      kind: "blocked",
      message: `Lighter's minimum withdrawal is $${LIGHTER_MIN_SECURE_WITHDRAW_USDC}.`,
    };
  }

  report("signing", "Signing the withdrawal with your trading key.");
  let signed;
  try {
    signed = await signWithdraw({
      accountIndex: args.accountIndex,
      assetIndex: LIGHTER_ASSET_ID_USDC,
      routeType: LIGHTER_ROUTE_PERP,
      assetAmount: atomic.toString(),
      nonce: args.nonce,
    });
  } catch (err) {
    return {
      kind: "blocked",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  report("submitting", "Submitting to Lighter.");
  let txHash: string;
  try {
    txHash = await submitLighterTx(LIGHTER_TX_TYPE_WITHDRAW, signed.txInfo);
  } catch (err) {
    return {
      kind: "blocked",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Confirmed by the balance actually moving, not by the submission being
  // accepted. The debit is the full amount at once, so the available balance
  // dropping by most of it (most: a fill or funding tick can nudge the figure
  // between reads) is the confirmation. Timing out here does NOT fail the
  // withdrawal: Lighter accepted it, and the outcome says what was measured.
  report("confirming", "Waiting for Lighter to debit the margin.");
  const confirmedBelow = args.availableBeforeUsd - args.amountUsd * 0.5;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = await fetchLighterAccountState(args.l1Address).catch(
      () => null,
    );
    const available = Number(state?.detail?.availableBalanceUsd ?? NaN);
    if (Number.isFinite(available) && available <= confirmedBelow) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  const delaySeconds = await fetchWithdrawalDelaySeconds();
  report("done", "Withdrawal accepted.");
  return { kind: "submitted", txHash, amountUsd: args.amountUsd, delaySeconds };
}
