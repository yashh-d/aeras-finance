// The user's Blend Safe, driven directly by its owner.
//
// A Blend withdrawal is a batch of calls the Safe has to make: redeem vault
// shares, reset allowances, hand USDC to a bridge. Blend's SDK sends that
// batch as an ERC-4337 UserOperation that a paymaster pays for, because its
// customers' users hold no gas. Ours does, so the batch goes the older way:
// the owner calls the Safe's own `execTransaction`, the Safe delegatecalls
// MultiSend with the batch, and the owner's wallet pays gas like any other
// transaction. No bundler, no paymaster, no sponsor key.
//
// What makes that possible, verified on the user's own Safe on Monad and
// Ethereum on 2026-09-22 (scripts/blend-withdraw-sim.mts): Blend deploys
// Safe v1.5.0 with the embedded wallet as the only owner at threshold 1, the
// Safe4337Module and a Blend module enabled, and no transaction guard set.
// A single owner who is also the sender needs no signature at all: Safe's
// "pre-validated" scheme (v = 1, r = the owner's address) is accepted when
// `msg.sender` is that owner, so the transaction carries the owner's address
// in place of a signature and nothing is signed off-chain. A stranger sending
// the same bytes is refused with GS026.
//
// With safeTxGas and gasPrice both zero, the Safe reverts the whole
// transaction if the batch fails, so a withdrawal either lands complete or
// not at all. Nothing here depends on the chain: the same encoding runs on
// Ethereum, Monad and Base.

import { encodeFunctionData, encodePacked, type Hex } from "viem";

// Safe's canonical MultiSend 1.4.1, the same address on every chain and the
// one the Blend SDK batches through. Not MultiSendCallOnly: the batch holds a
// delegatecall step (Blend's `liquidityReset`), which only the full MultiSend
// permits.
export const MULTISEND_ADDRESS: Hex = "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526";

const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

export const SAFE_ABI = [
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const MULTISEND_ABI = [
  {
    type: "function",
    name: "multiSend",
    stateMutability: "payable",
    inputs: [{ name: "transactions", type: "bytes" }],
    outputs: [],
  },
] as const;

export interface SafeCall {
  to: Hex;
  value: bigint;
  data: Hex;
  // 0 call, 1 delegatecall.
  operation: 0 | 1;
}

// The owner's stand-in for a signature: r carries the owner, s is unused,
// v = 1 marks it pre-validated. Accepted only when the transaction's sender
// is that owner.
export function preValidatedSignature(owner: Hex): Hex {
  const r = `0x${owner.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
  const s = `0x${"0".repeat(64)}` as Hex;
  return encodePacked(["bytes32", "bytes32", "uint8"], [r, s, 1]);
}

// MultiSend's packed batch: for each call, operation (1 byte), to (20),
// value (32), data length (32), data. The same layout the Blend SDK produces
// for its UserOperations, pinned by a test against a hand-packed example.
export function encodeMultiSendBatch(calls: readonly SafeCall[]): Hex {
  const packed = calls
    .map((c) =>
      encodePacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [c.operation, c.to, c.value, BigInt((c.data.length - 2) / 2), c.data],
      ).slice(2),
    )
    .join("");
  return `0x${packed}`;
}

// The call the Safe makes to run a batch: MultiSend, by delegatecall.
export function multiSendCalldata(calls: readonly SafeCall[]): {
  to: Hex;
  data: Hex;
} {
  return {
    to: MULTISEND_ADDRESS,
    data: encodeFunctionData({
      abi: MULTISEND_ABI,
      functionName: "multiSend",
      args: [encodeMultiSendBatch(calls)],
    }),
  };
}

// `execTransaction` calldata for the owner to send to the Safe. Gas fields
// zero: the Safe pays nothing and refunds nothing, and reverts the whole
// transaction if the inner call fails.
export function encodeExecTransaction(args: {
  to: Hex;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  signatures: Hex;
}): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [
      args.to,
      args.value,
      args.data,
      args.operation,
      0n,
      0n,
      0n,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      args.signatures,
    ],
  });
}

// One owner transaction that runs a whole batch through the Safe.
export function encodeOwnerBatch(owner: Hex, calls: readonly SafeCall[]): Hex {
  const inner = multiSendCalldata(calls);
  return encodeExecTransaction({
    to: inner.to,
    value: 0n,
    data: inner.data,
    operation: 1,
    signatures: preValidatedSignature(owner),
  });
}
