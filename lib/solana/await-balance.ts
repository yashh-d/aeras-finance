"use client";

// Wait for an SPL balance to reach a target, then report what actually landed.
//
// A cross-chain conversion is reported as settled by the bridge before our RPC
// necessarily reflects it: the destination transaction has landed, but the node
// we read from can be a few slots behind, and the associated token account may
// have been created by that same transaction. Depositing against a stale read
// would size the deposit against a balance the wallet no longer has.
//
// This never throws on timeout. It returns whatever the account holds, and the
// caller decides whether that is enough, because a partial arrival is still the
// user's money and still worth depositing.

import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { getConnection } from "./balances";

const POLL_MS = 1_500;

export async function awaitTokenBalance(args: {
  mint: string;
  owner: string;
  // Stop as soon as the account holds at least this much, in atomic units.
  atLeastAtomic: string;
  // Token program the ATA is derived under. Defaults to Token-2022 (xStocks);
  // classic SPL mints like USDC pass TOKEN_PROGRAM_ID.
  programId?: PublicKey;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const { mint, owner, atLeastAtomic, timeoutMs = 90_000, signal } = args;
  const target = BigInt(atLeastAtomic);
  const conn = getConnection();
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(owner),
    false,
    args.programId ?? TOKEN_2022_PROGRAM_ID,
  );

  const deadline = Date.now() + timeoutMs;
  let last = "0";
  for (;;) {
    if (signal?.aborted) return last;
    try {
      // `processed` matches what transaction simulation reads, so a balance seen
      // here is one the deposit can actually spend.
      const res = await conn.getTokenAccountBalance(ata, "processed");
      last = res.value.amount;
      if (BigInt(last) >= target) return last;
    } catch {
      // The account may not exist until the conversion's destination transaction
      // creates it. Absence is expected here, not an error.
    }
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
