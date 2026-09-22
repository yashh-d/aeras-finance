"use client";

// The shMON calls the app signs, over the same signer shape the Morpho venue
// uses: a payable deposit of native MON, the instant exit, and the two halves
// of the queued exit. Each one switches the embedded wallet to Monad through
// lib/morpho/deposit.ts's connectMonad (one implementation of that switch
// exists on purpose), sends, and waits for the receipt.
//
// Amounts are 18-decimal atomic throughout: shares are shMON, `value` is MON.
// Nothing here sizes anything; callers pass exact figures they have already
// read from the chain.

import { encodeFunctionData } from "viem";

import {
  connectMonad,
  sendTx,
  waitForReceipt,
  type EvmSigner,
  type MorphoTxProgress,
} from "@/lib/morpho/deposit";

import { SHMON_ABI } from "./abi";
import { EXIT_GAS_MIN_WEI, SHMON_ADDRESS } from "./constants";

export type { EvmSigner };
export type ShmonTxProgress = MorphoTxProgress;
type Report = (p: ShmonTxProgress) => void;

function gasGuard(walletMonAtomic: bigint) {
  if (walletMonAtomic < EXIT_GAS_MIN_WEI) {
    throw new Error(
      "Your Monad wallet has no MON to pay gas for this. Staking from Solana " +
        "keeps 0.1 MON back for exactly this; fund the wallet from Solana first.",
    );
  }
}

// deposit(assets, receiver) with value == assets. The contract reverts on a
// mismatch, which the check script confirms, so both come from one variable.
export async function stakeMon(args: {
  amountAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { amountAtomic, signer } = args;
  if (amountAtomic <= 0n) throw new Error("Nothing to stake.");
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Monad." });
  const provider = await connectMonad(signer);
  report({ stage: "depositing", message: "Staking MON into shMON." });
  const hash = await sendTx(
    provider,
    owner,
    SHMON_ADDRESS,
    encodeFunctionData({
      abi: SHMON_ABI,
      functionName: "deposit",
      args: [amountAtomic, owner],
    }),
    amountAtomic,
  );
  report({ stage: "confirming", message: "Confirming on Monad.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Staked.", txHash: hash });
  return hash;
}

// The instant exit. `minMonAtomic` is the floor the contract enforces; the
// caller derives it from previewRedeemDetailed less a tolerance.
export async function redeemInstant(args: {
  sharesAtomic: bigint;
  minMonAtomic: bigint;
  walletMonAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { sharesAtomic, minMonAtomic, signer } = args;
  if (sharesAtomic <= 0n) throw new Error("Enter an amount to unstake.");
  gasGuard(args.walletMonAtomic);
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Monad." });
  const provider = await connectMonad(signer);
  report({ stage: "withdrawing", message: "Unstaking instantly." });
  const hash = await sendTx(
    provider,
    owner,
    SHMON_ADDRESS,
    encodeFunctionData({
      abi: SHMON_ABI,
      functionName: "redeemWithSlippageProtection",
      args: [sharesAtomic, owner, owner, minMonAtomic],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Monad.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Unstaked. The MON is in your Monad wallet.", txHash: hash });
  return hash;
}

// First half of the queued exit. The rate locks now; the MON arrives after
// completeUnstake once the wait has passed.
export async function requestUnstake(args: {
  sharesAtomic: bigint;
  walletMonAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { sharesAtomic, signer } = args;
  if (sharesAtomic <= 0n) throw new Error("Enter an amount to unstake.");
  gasGuard(args.walletMonAtomic);
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Monad." });
  const provider = await connectMonad(signer);
  report({ stage: "withdrawing", message: "Queueing the unstake." });
  const hash = await sendTx(
    provider,
    owner,
    SHMON_ADDRESS,
    encodeFunctionData({ abi: SHMON_ABI, functionName: "requestUnstake", args: [sharesAtomic] }),
  );
  report({ stage: "confirming", message: "Confirming on Monad.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Queued. Come back in about a day to complete it.", txHash: hash });
  return hash;
}

// Second half. Only offered once the position route's simulation says it
// would succeed; sent anyway if a caller insists, in which case the chain
// answers with a revert and the error is shown.
export async function completeUnstake(args: {
  walletMonAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { signer } = args;
  gasGuard(args.walletMonAtomic);
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Monad." });
  const provider = await connectMonad(signer);
  report({ stage: "withdrawing", message: "Completing the unstake." });
  const hash = await sendTx(
    provider,
    owner,
    SHMON_ADDRESS,
    encodeFunctionData({ abi: SHMON_ABI, functionName: "completeUnstake" }),
  );
  report({ stage: "confirming", message: "Confirming on Monad.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Completed. The MON is in your Monad wallet.", txHash: hash });
  return hash;
}
