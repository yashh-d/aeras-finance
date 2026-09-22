"use client";

// Putting a Blend action plan on chain from the embedded wallet, and running
// a quoted session through Blend with that as the submission step.
//
// Blend's SDK carries a session from quote to settlement: lock it, submit the
// plan on chain, hand Blend the hashes, poll until Blend has seen the receipts
// and settled. All of that is its public session module and is used as is.
// The one step it would do differently is the middle one: the SDK sends a
// Safe plan as an ERC-4337 UserOperation that a paymaster pays for. Here the
// same plan goes out as an owner transaction the wallet pays for
// (lib/blend/safe.ts), through the same EIP-1193 provider every other venue
// signs with, and the wallet is switched to the plan's chain and read back
// first, as always.
//
// A plan is simulated with eth_estimateGas before it is signed. A batch that
// would revert (Blend's Monad step did, in simulation on 2026-09-22, when the
// vault could not redeem the whole position) fails here with the chain named
// and nothing sent, rather than as a reverted transaction the user paid for.

import type { ActionPlan, BlendSdk, ExecuteResult, Quote } from "@blend-money/fe";
import type { EIP1193Provider } from "@privy-io/react-auth";
import type { Hex } from "viem";

import { connectEvmChain, type EvmSigner } from "@/lib/trustware/execute";

import { BLEND_SIGNING_CHAIN_IDS, blendChainName } from "./constants";
import { describeRevert } from "./revert";
import { encodeOwnerBatch, type SafeCall } from "./safe";

export { describeRevert } from "./revert";

export type { EvmSigner } from "@/lib/trustware/execute";

// Ethereum blocks are twelve seconds and a low-priority transaction can sit
// for a while; Monad and Base confirm in seconds.
function receiptTiming(chainId: number): { timeoutMs: number; pollMs: number } {
  return chainId === 1
    ? { timeoutMs: 10 * 60_000, pollMs: 4_000 }
    : { timeoutMs: 5 * 60_000, pollMs: 2_000 };
}

export async function waitForReceipt(
  provider: EIP1193Provider,
  hash: string,
  chainId: number,
): Promise<void> {
  const { timeoutMs, pollMs } = receiptTiming(chainId);
  const name = blendChainName(chainId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error(`The transaction failed on ${name}.`);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `The transaction did not confirm on ${name} in time. It may still land; check your wallet before retrying.`,
  );
}

function hexQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

// The calls a multisend plan batches, in the order Blend gave them.
function safeCallsOf(plan: ActionPlan): SafeCall[] {
  return [...plan.requiredApprovals, ...plan.requiredTxns].map((t) => ({
    to: t.to,
    value: BigInt(t.value),
    data: t.data,
    operation: t.isDelegateCall ? 1 : 0,
  }));
}

// What the owner sends for a plan: for a Safe plan, `execTransaction` on the
// Safe (the plan's `account`); for a direct plan, its transactions one by one
// from the wallet. Exposed so a withdrawal can be simulated before it is
// confirmed (lib/blend/gas.ts).
export function ownerTransactionsOf(
  plan: ActionPlan,
  owner: Hex,
): { to: Hex; data: Hex; value: bigint }[] {
  if (plan.deployType === "multisend") {
    // The plan's transactions all carry the Safe as their account; the batch
    // is one owner transaction to it.
    const safe = plan.requiredTxns[0]?.account ?? plan.requiredApprovals[0]?.account;
    if (!safe) throw new Error("Blend returned an empty plan for this chain.");
    return [{ to: safe, data: encodeOwnerBatch(owner, safeCallsOf(plan)), value: 0n }];
  }
  return [...plan.requiredApprovals, ...plan.requiredTxns].map((t) => ({
    to: t.to,
    data: t.data,
    value: BigInt(t.value),
  }));
}

// Point the wallet at the plan's chain. Every chain here is one Privy can
// switch to; anything else is refused before a provider is even asked for.
export async function connectPlanChain(
  evm: EvmSigner,
  chainId: number,
): Promise<EIP1193Provider> {
  if (!BLEND_SIGNING_CHAIN_IDS.includes(chainId)) {
    throw new Error(
      `This step needs a transaction on ${blendChainName(chainId)}, which the app cannot sign on. Nothing was signed and no funds moved.`,
    );
  }
  return connectEvmChain(evm, String(chainId));
}

export type Report = (message: string) => void;

// Submit one plan from the wallet and return its hashes. Estimates before it
// sends, so a batch that would revert is refused unsigned, and the estimate
// is passed as the gas limit with headroom rather than letting the wallet
// re-estimate a delegatecall-heavy batch on its own.
export async function submitBlendActionPlan(args: {
  plan: ActionPlan;
  evm: EvmSigner;
  report?: Report;
}): Promise<{ hash: string; chainId: number }[]> {
  const { plan, evm } = args;
  const report = args.report ?? (() => {});
  const owner = evm.address as Hex;
  const chainId = plan.chainId;
  const name = blendChainName(chainId);

  report(`Switching to ${name}.`);
  const provider = await connectPlanChain(evm, chainId);

  const hashes: { hash: string; chainId: number }[] = [];
  const txs = ownerTransactionsOf(plan, owner);
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const call = {
      from: owner,
      to: tx.to,
      data: tx.data,
      ...(tx.value > 0n ? { value: hexQuantity(tx.value) } : {}),
    };
    let gas: bigint;
    try {
      gas = BigInt(
        (await provider.request({ method: "eth_estimateGas", params: [call] })) as string,
      );
    } catch (err) {
      throw new Error(describeRevert(chainId, err));
    }
    report(
      txs.length > 1
        ? `Sending transaction ${i + 1} of ${txs.length} on ${name}.`
        : `Sending on ${name}.`,
    );
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ ...call, gas: hexQuantity((gas * 125n) / 100n) }],
    })) as string;
    report(`Confirming on ${name}.`);
    await waitForReceipt(provider, hash, chainId);
    hashes.push({ hash, chainId });
  }
  return hashes;
}

// Run a quoted session to settlement with the owner-transaction submission
// above. The SDK's own `execute` is not called: it would route Safe plans to
// its paymaster path. Mirrors what it does around the submission: the expiry
// check first, then lock, submit, poll, and the same result shape.
export async function runBlendQuote(args: {
  sdk: BlendSdk;
  quote: Quote;
  evm: EvmSigner;
  report?: Report;
  onSubmitted?: () => void;
  signal?: AbortSignal;
}): Promise<ExecuteResult> {
  const { sdk, quote, evm } = args;
  if (Date.now() >= new Date(quote.expiresAt).getTime()) {
    throw new Error("The quote has expired. Review again for a fresh one.");
  }
  const { toExecuteResult } = await import("@blend-money/fe");
  const session = await sdk.sessions.execute(
    quote.intentId,
    {
      signerAddress: evm.address,
      submitActionPlan: (plan) =>
        submitBlendActionPlan({ plan, evm, report: args.report }),
      onStatusChange: (status) => {
        if (status === "SUBMITTED") args.onSubmitted?.();
      },
    },
    { signal: args.signal },
  );
  return toExecuteResult(session);
}
