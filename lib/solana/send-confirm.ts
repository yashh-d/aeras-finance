import type { Connection } from "@solana/web3.js";

// Broadcast a signed transaction and wait for a real answer.
//
// This replaces `connection.confirmTransaction(signature, "confirmed")`, which
// was copy-pasted across every send site and is wrong in two ways that both
// showed up in production.
//
// First, passing a bare signature string selects web3.js's legacy timeout
// strategy: a flat 30-second `setTimeout` after which it throws
// "Transaction was not confirmed in 30.00 seconds. It is unknown if it
// succeeded or failed." A blockhash is valid for 150 slots, roughly 60 to 90
// seconds, so that gave up while the transaction still had half its life left
// and reported a failure the chain had not decided on.
//
// Second, that strategy confirms over a WebSocket signature subscription and
// polls `getSignatureStatus` exactly once, after the subscription goes live --
// there is no polling loop behind it (read out of
// node_modules/@solana/web3.js/lib/index.cjs.js). A socket that connects and
// then goes quiet fails every confirmation at exactly 30.00 seconds no matter
// what landed on chain.
//
// So: poll `getSignatureStatuses` on an interval, rebroadcast while we wait,
// and only call it dead once the block height actually passes the blockhash's
// last valid height. No WebSocket in the path at all.

export interface ConfirmWindow {
  blockhash: string;
  lastValidBlockHeight: number;
}

// An unsigned transaction plus the window it is valid in. Builders return this
// rather than a bare base64 string: `lastValidBlockHeight` is what lets the
// confirmation below tell "still in flight" apart from "dead", and every build
// site used to throw it away.
export interface BuiltTransaction extends ConfirmWindow {
  // base64-encoded VersionedTransaction.
  transaction: string;
}

export type SendFailureKind =
  // Simulation or the RPC rejected it outright. Never reached the chain.
  | "rejected"
  // Landed and the runtime returned an error.
  | "failed"
  // The blockhash expired with no status. Safe to rebuild and retry.
  | "expired"
  // The RPC never answered. Genuinely undecided -- do not tell the user either
  // way, point them at the signature.
  | "unknown";

export class SolanaSendError extends Error {
  readonly kind: SendFailureKind;
  readonly signature?: string;

  constructor(kind: SendFailureKind, message: string, signature?: string) {
    super(message);
    this.name = "SolanaSendError";
    this.kind = kind;
    this.signature = signature;
  }
}

const POLL_INTERVAL_MS = 2000;
// Check the block height every Nth poll rather than every one. Expiry moves
// slowly (150 slots) and this halves the request count over a full window.
const HEIGHT_CHECK_EVERY = 3;
// Absolute ceiling on the wait. A blockhash dies after 150 slots, so on a
// healthy RPC expiry always fires well before this. It exists because
// `stillAlive` deliberately answers "yes" when the RPC errors, and an RPC that
// is down for good would otherwise leave the caller waiting forever.
const MAX_POLLS = 60; // 120 seconds

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `window` is optional because not every transaction here is ours to build.
// Trustware and Kamino's klend KTX hand back a finished transaction with a
// blockhash already chosen, and there is no lastValidBlockHeight to go with it.
// In that case expiry is read off the transaction's own blockhash instead,
// which is exact and needs nothing threaded through the caller.
export async function sendAndConfirm(
  connection: Connection,
  signed: Uint8Array,
  window?: ConfirmWindow,
): Promise<string> {
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed, {
      // Keep preflight on: it turns a doomed transaction into a readable error
      // (insufficient funds, slippage) instead of a silent 60-second wait.
      skipPreflight: false,
      // Deliberately NOT capped. This used to be `maxRetries: 3`, which stops
      // the RPC rebroadcasting after about five seconds; one dropped packet at
      // a leader transition and nothing ever re-sent the transaction. Left
      // unset, the node rebroadcasts until the blockhash expires.
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SolanaSendError("rejected", msg);
  }

  for (let poll = 0; ; poll++) {
    await sleep(POLL_INTERVAL_MS);

    const status = await readStatus(connection, signature);
    if (status === "confirmed") return signature;
    if (status && typeof status === "object") {
      throw new SolanaSendError(
        "failed",
        `The transaction was rejected on chain: ${JSON.stringify(status.err)}`,
        signature,
      );
    }

    // Still unknown. Push it out again -- cheap, and it covers the case where
    // the node stopped its own rebroadcast.
    void connection
      .sendRawTransaction(signed, { skipPreflight: true })
      .catch(() => {});

    const outOfTime = poll >= MAX_POLLS;
    if (!outOfTime) {
      if (poll % HEIGHT_CHECK_EVERY !== HEIGHT_CHECK_EVERY - 1) continue;
      if (await stillAlive(connection, signed, window)) continue;
    }

    // One last look: a transaction can land in the same slot its blockhash
    // expires, and calling that a failure would be the old bug in reverse.
    const final = await readStatus(connection, signature);
    if (final === "confirmed") return signature;
    if (final && typeof final === "object") {
      throw new SolanaSendError(
        "failed",
        `The transaction was rejected on chain: ${JSON.stringify(final.err)}`,
        signature,
      );
    }
    // Hitting the ceiling instead of a real expiry means the RPC never gave a
    // straight answer, so this is the one case where we genuinely do not know.
    // Say that, rather than promising nothing moved.
    throw new SolanaSendError(
      outOfTime ? "unknown" : "expired",
      outOfTime
        ? `Could not reach the network to confirm this transaction. Check ${signature} on Solscan before retrying.`
        : "The transaction expired before it landed. Nothing was moved. Try again.",
      signature,
    );
  }
}

// Is the transaction's blockhash still inside its window? Errs toward "yes":
// a transient RPC failure must not be read as expiry, because expiry is the one
// answer that tells the user nothing moved.
async function stillAlive(
  connection: Connection,
  signed: Uint8Array,
  window: ConfirmWindow | undefined,
): Promise<boolean> {
  try {
    if (window) {
      const height = await connection.getBlockHeight("confirmed");
      return height <= window.lastValidBlockHeight;
    }
    const { VersionedTransaction } = await import("@solana/web3.js");
    const blockhash =
      VersionedTransaction.deserialize(signed).message.recentBlockhash;
    const { value } = await connection.isBlockhashValid(blockhash, {
      commitment: "confirmed",
    });
    return value;
  } catch {
    return true;
  }
}

// "confirmed" | { err } | null (not seen yet)
async function readStatus(
  connection: Connection,
  signature: string,
): Promise<"confirmed" | { err: unknown } | null> {
  try {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: false,
    });
    const status = value[0];
    if (!status) return null;
    if (status.err) return { err: status.err };
    if (
      status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized"
    ) {
      return "confirmed";
    }
    return null;
  } catch {
    // A transient RPC error is not a verdict. Keep waiting.
    return null;
  }
}
