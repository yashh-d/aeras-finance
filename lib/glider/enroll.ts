"use client";

// Creating the user's Mag7X portfolio: one signature from the embedded EVM
// wallet, then Glider provisions a Kernel smart account on Base with its
// agent as a session key. The whole flow is two calls to our own routes with
// a `personal_sign` between them.
//
// The digest is signed exactly as Glider returns it. It is already a 32-byte
// hash; hashing it again, or treating the hex as text, produces a signature
// Glider rejects with "does not match the session-key message". viem's
// `signMessage({ message: { raw } })` is the same call, spelled through the
// EIP-1193 provider Privy exposes.

import type { EvmSigner } from "@/lib/trustware/execute";

import { prepareGliderEnrollment, submitGliderEnrollment } from "./client";
import type { GliderEnrollmentResult } from "./types";

// The user's portfolio, created if it does not exist. `attested` is the
// eligibility checkbox; the server refuses without it and the ticket does
// not call this until it is ticked.
export async function ensureMag7xPortfolio(args: {
  evm: EvmSigner;
  attested: boolean;
  onProgress?: (message: string) => void;
}): Promise<GliderEnrollmentResult> {
  const report = args.onProgress ?? (() => {});
  report("Checking for an existing Mag7X account");
  const stage1 = await prepareGliderEnrollment(args.attested);
  if (stage1.existing) return stage1.existing;

  const prepared = stage1.prepared;
  report("Sign once to create your Mag7X account on Base");
  const provider = await args.evm.getProvider();
  const signature = (await provider.request({
    method: "personal_sign",
    params: [prepared.messageRaw, args.evm.address],
  })) as string;
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw new Error("The wallet returned no signature.");
  }

  report("Creating the account with Glider");
  return submitGliderEnrollment({
    signature,
    flowId: prepared.flowId,
    accountIndex: prepared.accountIndex,
    agentAccountId: prepared.agentAccountId,
  });
}
