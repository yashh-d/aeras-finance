"use client";

// One BlendSdk per wallet, signed in.
//
// The SDK is loaded on demand: it pulls in axios, permissionless and viem's
// account-abstraction code, none of which the Earn table needs to draw a
// rate, so nothing from it is imported until a deposit or withdrawal starts.
//
// Sign-in is SIWE: Blend issues a message, the embedded wallet signs it, and
// Blend answers with a JWT and the account context (the Safe address and the
// chains it is deployed on). With Privy's wallet UIs off the signature is
// silent, so a sign-in costs the user nothing visible. It still creates the
// account record on Blend's side the first time, which is why the address is
// marked as having one here (lib/blend/session.ts) and why the table's
// position read is gated on that mark.
//
// The SDK is used for what it knows (sessions, quotes, Blend's own
// settlement polling) and not for what it signs: its `execute` sends Safe
// operations as paymaster-sponsored UserOperations, and this app sends them
// as owner transactions instead (lib/blend/execute.ts), through the SDK's
// public session module with our own submission step. The constructor still
// insists on a paymaster registry; an empty one is passed and never read.

import type { BlendSdk } from "@blend-money/fe";

import {
  BLEND_API_BASE_URL,
  BLEND_APP_CHAIN_ID,
  blendPublishableKey,
} from "./constants";
import {
  clearBlendSession,
  loadBlendSession,
  markBlendAccount,
  saveBlendSession,
} from "./session";
import { signBlendMessage, type EvmSigner } from "./signer";

export interface BlendSession {
  accountId: string;
  safeAddress: string;
  chainsDeployed: number[];
}

// Construct the SDK for `evm`, restore this tab's session when one exists for
// the address, and sign in when none does. Resolves signed in.
export async function loadBlendSdk(
  evm: EvmSigner,
): Promise<{ sdk: BlendSdk; session: BlendSession }> {
  const address = evm.address;
  if (!address) throw new Error("No embedded EVM wallet available.");
  const { BlendSdk } = await import("@blend-money/fe");

  const sdk = new BlendSdk({
    publishableKey: blendPublishableKey(),
    baseUrl: BLEND_API_BASE_URL,
    signMessage: (message) => signBlendMessage(evm, message),
    paymaster: {},
  });

  const saved = loadBlendSession(address);
  if (saved) {
    try {
      sdk.restoreSession(saved);
    } catch {
      clearBlendSession(address);
    }
  }
  if (!sdk.isSignedIn) {
    await sdk.signIn({ address, chainId: BLEND_APP_CHAIN_ID });
  }
  persistBlendSession(sdk, address);
  markBlendAccount(address);

  const s = sdk.session;
  return {
    sdk,
    session: {
      accountId: s.accountId,
      safeAddress: s.safeAddress,
      chainsDeployed: s.chainsDeployed,
    },
  };
}

// A restored token past its expiry is renewed by the SDK on the next call,
// through signMessage again, so callers persist once more when a flow ends.
export function persistBlendSession(sdk: BlendSdk, address: string): void {
  try {
    saveBlendSession(address, sdk.exportSession());
  } catch {
    // Not signed in; nothing to persist.
  }
}
