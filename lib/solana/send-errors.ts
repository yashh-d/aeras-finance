// Turn whatever a send throws into one sentence a user can act on.
//
// The send forms used to render `err.message` directly, which for a preflight
// rejection is web3.js's "Simulation failed. Message: Transaction simulation
// failed: ... Logs: [...]. Catch the `SendTransactionError` and call
// `getLogs()`" dump. Nothing in that tells the user what to change. Every
// branch below is a message that was seen in production or in the send path's
// own validation; anything unrecognised falls through to a generic line that
// still says the one thing that matters, which is that nothing left the wallet.

import { SolanaSendError } from "@/lib/solana/send-confirm";

// Thrown before anything is signed when the send cannot succeed as entered.
// The message is written for the user and is shown as is.
export class SendValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendValidationError";
  }
}

const GENERIC =
  "The transaction could not be sent. Nothing left the wallet. Try again in a moment.";

export function describeSendError(err: unknown): string {
  // Our own pre-signing checks already speak to the user.
  if (err instanceof SendValidationError) return err.message;

  // A transaction that landed and failed is not "try again" territory: the
  // signature is the record, and the caller shows it.
  if (err instanceof SolanaSendError && err.kind === "failed") {
    return "The transaction reached Solana but failed on chain. Check the signature for details.";
  }
  if (err instanceof SolanaSendError && err.kind === "unknown") {
    return "The network did not confirm the transaction either way. Check the signature before sending again.";
  }

  const raw = err instanceof Error ? err.message : String(err ?? "");
  const msg = raw.toLowerCase();

  if (msg.includes("insufficient funds for rent")) {
    return "Solana rejected this transfer because an account would end up below the rent minimum of about 0.0009 SOL. Send a larger amount, or send everything.";
  }
  if (
    msg.includes("insufficient lamports") ||
    msg.includes("insufficient funds") ||
    msg.includes("found no record of a prior credit")
  ) {
    return "Not enough SOL in this wallet to cover the amount and fees.";
  }
  if (msg.includes("blockhash not found") || msg.includes("block height exceeded")) {
    return "The transaction expired before it was sent. Try again.";
  }
  if (msg.includes("429") || msg.includes("too many requests")) {
    return "The Solana RPC is rate limiting requests right now. Wait a few seconds and try again.";
  }
  if (msg.includes("user rejected") || msg.includes("rejected the request")) {
    return "Signing was cancelled. Nothing was sent.";
  }

  return GENERIC;
}
