// The rent rules the runtime applies to a plain SOL transfer, checked before
// anything is signed so the user gets a sentence instead of a simulation dump.
//
// Solana rejects any transaction that leaves a touched system account above
// zero but below the rent-exempt minimum; the preflight error for it is
// "Transaction results in an account (N) with insufficient funds for rent".
// Both directions were live failures: a small first transfer to a fresh
// address fails because the recipient would sit below the floor, and sending
// nearly everything fails because the sender would.
//
// Pure arithmetic, no chain reads, so it is unit tested. The caller reads the
// two balances and passes them in.

import { SendValidationError } from "@/lib/solana/send-errors";

const LAMPORTS_PER_SOL = 1_000_000_000;

// Rent-exempt minimum for a zero-data system account. A protocol constant
// (getMinimumBalanceForRentExemption(0) on mainnet), hardcoded so the send
// path costs one RPC read rather than two.
export const SYSTEM_ACCOUNT_RENT_LAMPORTS = 890_880;

export function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL)
    .toFixed(9)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export interface SolRentInput {
  // Amount being transferred.
  lamports: number;
  // Base fee plus priority fee the sender pays on top of the amount.
  feeLamports: number;
  // Current balances. A missing account is 0.
  senderLamports: number;
  recipientLamports: number;
}

export function checkSolRent({
  lamports,
  feeLamports,
  senderLamports,
  recipientLamports,
}: SolRentInput): void {
  const recipientAfter = recipientLamports + lamports;
  if (recipientAfter < SYSTEM_ACCOUNT_RENT_LAMPORTS) {
    const short = SYSTEM_ACCOUNT_RENT_LAMPORTS - recipientLamports;
    throw new SendValidationError(
      recipientLamports === 0
        ? `That address holds no SOL yet. Solana requires a new account to receive at least ${formatSol(short)} SOL.`
        : `That address holds less than Solana's rent minimum. Send at least ${formatSol(short)} SOL so it ends above ${formatSol(SYSTEM_ACCOUNT_RENT_LAMPORTS)} SOL.`,
    );
  }

  const senderAfter = senderLamports - lamports - feeLamports;
  if (senderAfter < 0) {
    throw new SendValidationError(
      `Not enough SOL to cover the amount plus about ${formatSol(feeLamports)} SOL in fees.`,
    );
  }
  if (senderAfter > 0 && senderAfter < SYSTEM_ACCOUNT_RENT_LAMPORTS) {
    const sendable = senderLamports - feeLamports;
    throw new SendValidationError(
      `This would leave less than ${formatSol(SYSTEM_ACCOUNT_RENT_LAMPORTS)} SOL behind, which Solana does not allow. Send at most ${formatSol(sendable - SYSTEM_ACCOUNT_RENT_LAMPORTS)} SOL, or all ${formatSol(sendable)} SOL.`,
    );
  }
}
