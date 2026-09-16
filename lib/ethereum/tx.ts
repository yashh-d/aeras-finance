"use client";

// The client-side Ethereum transaction plumbing every Ethereum venue needs:
// point the embedded wallet at mainnet, send, wait for a receipt, and grant an
// ERC-20 allowance the way USDT will accept.
//
// Written for lib/morpho/gold-borrow.ts and lifted out when lib/aave/deposit.ts
// needed the same five helpers. Only the EIP-1193 provider is used; there is no
// viem wallet client (see CLAUDE.md, Privy).

import type { EIP1193Provider } from "@privy-io/react-auth";
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
} from "viem";

import type { EvmSigner } from "@/lib/trustware/execute";

import { ETHEREUM_CHAIN_ID } from "./constants";

export type { EvmSigner } from "@/lib/trustware/execute";

export async function ethCall(
  provider: EIP1193Provider,
  to: string,
  data: Hex,
): Promise<Hex> {
  return (await provider.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  })) as Hex;
}

export async function sendTx(
  provider: EIP1193Provider,
  from: string,
  to: string,
  data: Hex,
): Promise<string> {
  return (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  })) as string;
}

// Point the embedded wallet at Ethereum and hand back a provider actually bound
// to it.
//
// The switch happens on the WALLET, never via wallet_switchEthereumChain on a
// provider: a provider is bound to the chain active when it was requested, and
// the Privy signing confirmation follows the wallet's active chain. That split
// once presented a Monad approval as an Ethereum transaction. Privy also
// propagates the switch through React state, so a provider requested
// immediately after switchChain resolves can still be on the old chain; the
// poll below absorbs that, and the chain id read-back is the hard gate.
// Nothing is signed until a fresh provider reports Ethereum.
export async function connectEthereum(signer: EvmSigner): Promise<EIP1193Provider> {
  try {
    await signer.switchChain(ETHEREUM_CHAIN_ID);
  } catch {
    throw new Error(
      "Could not switch your wallet to Ethereum. Nothing was signed and no funds moved.",
    );
  }
  const deadline = Date.now() + 5_000;
  for (;;) {
    const provider = await signer.getProvider();
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (BigInt(current) === BigInt(ETHEREUM_CHAIN_ID)) return provider;
    if (Date.now() >= deadline) {
      throw new Error(
        "The wallet did not switch to Ethereum. Nothing was signed and no funds moved.",
      );
    }
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${ETHEREUM_CHAIN_ID.toString(16)}` }],
      });
    } catch {
      // The wallet-level switch may still land on its own; keep polling.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function waitForReceipt(provider: EIP1193Provider, hash: string) {
  // Ethereum blocks are 12 seconds and a low-priority transaction can sit for a
  // while, so this window is wider than Monad's.
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error("The transaction failed on Ethereum.");
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 4_000));
  }
  throw new Error(
    "The transaction did not confirm on Ethereum in time. It may still land; check your wallet before retrying.",
  );
}

export async function readAllowance(
  provider: EIP1193Provider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const hex = await ethCall(
    provider,
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner as `0x${string}`, spender as `0x${string}`],
    }),
  );
  return decodeFunctionResult({
    abi: erc20Abi,
    functionName: "allowance",
    data: hex,
  });
}

// Grant `amount` of `token` to `spender`, dealing with USDT's approve rule.
//
// The rule: USDT reverts on any approve that changes a non-zero allowance to a
// different non-zero value. So a standing allowance that is too small must be
// zeroed before it can be raised. Compliant tokens are unaffected by the extra
// step beyond one wasted transaction, and only ever pay it when their allowance
// is genuinely short, so the branch is not worth splitting by token.
export async function approveIfShort(args: {
  provider: EIP1193Provider;
  token: string;
  symbol: string;
  owner: string;
  spender: string;
  // What the spender is, for the progress line ("Morpho", "Aave").
  spenderLabel: string;
  amount: bigint;
  report: (message: string) => void;
}): Promise<void> {
  const { provider, token, owner, spender, amount, report } = args;
  const current = await readAllowance(provider, token, owner, spender);
  if (current >= amount) return;

  if (current > 0n) {
    report(`Resetting the ${args.symbol} approval.`);
    const zeroHash = await sendTx(
      provider,
      owner,
      token,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender as `0x${string}`, 0n],
      }),
    );
    await waitForReceipt(provider, zeroHash);
  }

  report(`Approving ${args.symbol} for ${args.spenderLabel}.`);
  const hash = await sendTx(
    provider,
    owner,
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender as `0x${string}`, amount],
    }),
  );
  await waitForReceipt(provider, hash);
}
