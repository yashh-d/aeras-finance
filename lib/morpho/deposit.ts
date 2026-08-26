"use client";

// Deposit into / withdraw from a Monad Morpho (ERC-4626) vault, signed by the
// user's Privy embedded EVM wallet.
//
// This mirrors the EVM signing shape in lib/trustware/execute.ts (switch chain,
// approve, send, poll the receipt) but talks to a vault contract directly rather
// than to a Trustware route. The wallet must be allowed to sign on Monad, which
// is why Monad is declared in lib/privy/provider.tsx `supportedChains`.
//
// Amounts: deposits and withdrawals are denominated in USDC (6-decimal atomic).
// A full exit redeems the exact share balance instead of a converted asset
// amount, so no share dust is left behind.

import type { EIP1193Provider } from "@privy-io/react-auth";
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
} from "viem";

import { MONAD_CHAIN_ID } from "./constants";
import type { MorphoVault } from "./vaults";

// The ERC-4626 entry points we call, plus the views we read to size an approval
// and a full exit.
const VAULT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface EvmSigner {
  address: string;
  // Wallet-level chain switch. Privy binds each provider instance to the chain
  // active when it was requested, and the signing confirmation follows the
  // wallet's active chain, so the switch must happen at the wallet level and a
  // FRESH provider must be requested after it (see lib/privy/evm.ts).
  switchChain: (chainId: number) => Promise<void>;
  getProvider: () => Promise<EIP1193Provider>;
}

// "funding" covers the optional Trustware leg that converts USDC from another
// chain into Monad USDC before the vault deposit (lib/morpho/fund.ts).
export type MorphoTxStage =
  | "funding"
  | "switching"
  | "approving"
  | "depositing"
  | "withdrawing"
  | "confirming"
  | "done";

export interface MorphoTxProgress {
  stage: MorphoTxStage;
  message: string;
  txHash?: string;
}

type Report = (p: MorphoTxProgress) => void;

// ── low-level helpers ──────────────────────────────────────────────────────

async function ethCall(
  provider: EIP1193Provider,
  to: string,
  data: Hex,
): Promise<Hex> {
  return (await provider.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  })) as Hex;
}

// Point the embedded wallet at Monad and hand back a provider that is actually
// bound to it.
//
// The switch happens on the WALLET, never via wallet_switchEthereumChain on a
// provider. A provider is bound to the chain that was active when it was
// requested, and switching through it leaves the wallet's own active chain
// (which the Privy signing confirmation follows) where it was: that split once
// presented a Monad vault approval as an Ethereum transaction. Privy only
// permits chains declared in `supportedChains`, so an undeclared chain still
// fails loudly here rather than signing on the wrong network. The chainId
// read-back is the final guard: if the fresh provider is not on Monad, nothing
// gets signed.
async function connectMonad(signer: EvmSigner): Promise<EIP1193Provider> {
  try {
    await signer.switchChain(MONAD_CHAIN_ID);
  } catch {
    throw new Error(
      "Could not switch your wallet to Monad. Nothing was signed and no funds moved.",
    );
  }
  // The wallet-level switch propagates asynchronously: switchChain can resolve
  // while a provider requested right after is still bound to the previous
  // chain (observed live, 2026-08-26). Poll for the binding, nudging the
  // provider instance directly as a fallback, and only give up after the
  // window. The chainId read-back stays the hard gate: nothing is signed
  // until a provider actually reports Monad.
  const deadline = Date.now() + 5_000;
  for (;;) {
    const provider = await signer.getProvider();
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (BigInt(current) === BigInt(MONAD_CHAIN_ID)) return provider;
    if (Date.now() >= deadline) {
      throw new Error(
        "The wallet did not switch to Monad. Nothing was signed and no funds moved.",
      );
    }
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${MONAD_CHAIN_ID.toString(16)}` }],
      });
    } catch {
      // The wallet-level switch may still land on its own; keep polling.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function waitForReceipt(provider: EIP1193Provider, hash: string) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error("The transaction failed on Monad.");
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error("The transaction did not confirm on Monad in time.");
}

async function sendTx(
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

// ── deposit ────────────────────────────────────────────────────────────────

// Deposit `amountAtomic` USDC (6dp) into the vault. Grants a USDC allowance to
// the vault first if the current one is short. Returns the deposit tx hash.
export async function depositToMorphoVault(args: {
  vault: MorphoVault;
  amountAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { vault, amountAtomic, signer, onProgress } = args;
  if (amountAtomic <= 0n) throw new Error("Enter an amount to deposit.");
  const report: Report = (p) => onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Monad." });
  const provider = await connectMonad(signer);

  // Approve only if the standing allowance cannot cover this deposit.
  const allowanceHex = await ethCall(
    provider,
    vault.asset.address,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, vault.address as `0x${string}`],
    }),
  );
  const allowance = decodeFunctionResult({
    abi: erc20Abi,
    functionName: "allowance",
    data: allowanceHex,
  });
  if (allowance < amountAtomic) {
    report({ stage: "approving", message: `Approving USDC for ${vault.name}.` });
    const approveHash = await sendTx(
      provider,
      owner,
      vault.asset.address,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [vault.address as `0x${string}`, amountAtomic],
      }),
    );
    await waitForReceipt(provider, approveHash);
  }

  report({ stage: "depositing", message: `Depositing into ${vault.name}.` });
  const depositHash = await sendTx(
    provider,
    owner,
    vault.address,
    encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "deposit",
      args: [amountAtomic, owner],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Monad.", txHash: depositHash });
  await waitForReceipt(provider, depositHash);
  report({ stage: "done", message: "Deposit confirmed.", txHash: depositHash });
  return depositHash;
}

// ── withdraw ───────────────────────────────────────────────────────────────

// Withdraw from the vault. A partial withdrawal is priced in USDC (`withdraw`);
// a full exit redeems the exact share balance (`redeem`) so no dust is left.
// Returns the tx hash.
export async function withdrawFromMorphoVault(args: {
  vault: MorphoVault;
  // USDC atomic (6dp) for a partial withdrawal. Ignored when `redeemAll`.
  amountAtomic: bigint;
  redeemAll: boolean;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { vault, amountAtomic, redeemAll, signer, onProgress } = args;
  const report: Report = (p) => onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Monad." });
  const provider = await connectMonad(signer);

  let data: Hex;
  if (redeemAll) {
    const balHex = await ethCall(
      provider,
      vault.address,
      encodeFunctionData({
        abi: VAULT_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),
    );
    const shares = decodeFunctionResult({
      abi: VAULT_ABI,
      functionName: "balanceOf",
      data: balHex,
    });
    if (shares <= 0n) throw new Error("You have no position to withdraw.");
    data = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "redeem",
      args: [shares, owner, owner],
    });
  } else {
    if (amountAtomic <= 0n) throw new Error("Enter an amount to withdraw.");
    data = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "withdraw",
      args: [amountAtomic, owner, owner],
    });
  }

  report({ stage: "withdrawing", message: `Withdrawing from ${vault.name}.` });
  const hash = await sendTx(provider, owner, vault.address, data);
  report({ stage: "confirming", message: "Confirming on Monad.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Withdrawal confirmed.", txHash: hash });
  return hash;
}
