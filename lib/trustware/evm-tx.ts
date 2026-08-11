// Pure translation from a Trustware route payload to EIP-1193 request params.
//
// This is deliberately free of React, Privy and network calls so it can be
// exercised directly against captured live payloads. It is the highest-risk
// pure code in the conversion path: get a quantity encoding wrong and the user
// signs a transaction that reverts or overpays, which is not recoverable after
// broadcast.

import { toQuantity, type TrustwareApproval, type TrustwareEvmTransaction } from "./types";

// Approvals worth acting on. Trustware documents every field as optional, and
// Solana routes come back carrying a vestigial EVM approval entry (the spender
// is the provider's Diamond contract) that would be nonsense to act on, since
// Solana has no ERC-20 allowances. The caller gates on source kind; this drops
// the malformed and no-op entries.
export function usableApprovals(
  approvals: TrustwareApproval[] | undefined,
): TrustwareApproval[] {
  return (approvals ?? []).filter(
    (a) => a.tokenAddress && a.spender && a.amount && BigInt(a.amount) > 0n,
  );
}

// Params for `eth_sendTransaction`.
//
// Two things this has to get right:
//
//   1. Quantities arrive as hex in some payloads and decimal in others, so every
//      one goes through toQuantity rather than being passed along verbatim.
//   2. Gas pricing is either EIP-1559 or legacy. Sending both forms in one
//      request is rejected by every node, so maxFeePerGas wins when present and
//      gasPrice is dropped entirely.
export function buildEvmTxParams(
  tx: TrustwareEvmTransaction,
  from: string,
): Record<string, string> {
  if (!tx.to) throw new Error("Trustware transaction has no destination.");
  if (!tx.data) throw new Error("Trustware transaction has no calldata.");

  const params: Record<string, string> = { from, to: tx.to, data: tx.data };

  const value = toQuantity(tx.value);
  if (value) params.value = value;
  const gas = toQuantity(tx.gasLimit);
  if (gas) params.gas = gas;

  const maxFee = toQuantity(tx.maxFeePerGas);
  const maxPriority = toQuantity(tx.maxPriorityFeePerGas);
  if (maxFee) {
    params.maxFeePerGas = maxFee;
    if (maxPriority) params.maxPriorityFeePerGas = maxPriority;
  } else {
    const gasPrice = toQuantity(tx.gasPrice);
    if (gasPrice) params.gasPrice = gasPrice;
  }

  return params;
}
