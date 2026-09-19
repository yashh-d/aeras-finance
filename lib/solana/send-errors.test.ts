import { describe, expect, it } from "vitest";

import { SolanaSendError } from "./send-confirm";
import { SendValidationError, describeSendError } from "./send-errors";

describe("describeSendError", () => {
  it("passes a validation message through untouched", () => {
    const err = new SendValidationError("Send at least 0.0009 SOL.");
    expect(describeSendError(err)).toBe("Send at least 0.0009 SOL.");
  });

  it("turns the rent simulation dump into one sentence", () => {
    const err = new Error(
      'Simulation failed. Message: Transaction simulation failed: Transaction results in an account (1) with insufficient funds for rent. Logs: [ "Program 11111111111111111111111111111111 invoke [1]", "Program 11111111111111111111111111111111 success" ]. Catch the `SendTransactionError` and call `getLogs()` on it for full details.',
    );
    const msg = describeSendError(err);
    expect(msg).toMatch(/rent minimum/);
    expect(msg).not.toMatch(/getLogs|Simulation failed|Program 1111/);
  });

  it("maps insufficient lamports to a SOL shortfall", () => {
    expect(
      describeSendError(new Error("Transfer: insufficient lamports 100, need 200")),
    ).toMatch(/Not enough SOL/);
  });

  it("maps a 429 to an RPC message", () => {
    expect(
      describeSendError(new Error("failed to get recent blockhash: 429 Too Many Requests")),
    ).toMatch(/rate limiting/);
  });

  it("maps a stale blockhash to a retry", () => {
    expect(describeSendError(new Error("Blockhash not found"))).toMatch(/expired/);
  });

  it("distinguishes an on-chain failure from a rejection", () => {
    expect(
      describeSendError(new SolanaSendError("failed", "custom program error", "sig")),
    ).toMatch(/failed on chain/);
    expect(describeSendError(new SolanaSendError("unknown", "no answer", "sig"))).toMatch(
      /did not confirm/,
    );
  });

  it("falls back to a generic line for anything else, and never leaks the raw text", () => {
    const msg = describeSendError(new Error("ECONNRESET at socket.ts:42"));
    expect(msg).toMatch(/Nothing left the wallet/);
    expect(msg).not.toMatch(/ECONNRESET/);
    expect(describeSendError(undefined)).toMatch(/Nothing left the wallet/);
  });
});
