"use client";

import type { EIP1193Provider } from "@privy-io/react-auth";

import {
  fetchLighterAccountState,
  submitLighterTx,
  type LighterAccountState,
} from "./client";
import { LIGHTER_API_KEY_INDEX, LIGHTER_TX_TYPE_CHANGE_PUBKEY } from "./constants";
import { deriveTradingKey, personalSign, registeredKeyMatches } from "./keys";
import { signChangePubKey } from "./signer";

// Getting a user from "logged into Aeras" to "can place a hedge" takes two
// things: a Lighter account, which only a deposit creates, and a trading key
// registered against it.
//
// The state is derived entirely from reads rather than stored. That is what
// makes it survive a refresh, which matters more here than usual: a deposit
// takes 15 to 20 minutes to credit, so the user will reload, close the tab, and
// come back before it lands. Persisted progress would drift out of sync with
// what Lighter actually thinks. Reading it fresh cannot.
//
// One state deliberately does not exist. "Waiting for a deposit to arrive" and
// "has not deposited yet" are the same thing from Lighter's side, since the
// account simply does not exist until the money lands. Distinguishing them needs
// a local marker of what the user says they did, which is a UI concern and is
// not invented here.

export type LighterOnboardingStatus =
  // No embedded EVM wallet, so there is no address to key an account by.
  | "no-wallet"
  // No Lighter account for this address. It is created by the first deposit,
  // with no signature or contract call.
  | "needs-deposit"
  // Account exists but our trading key is not registered against it.
  | "needs-key"
  | "ready";

export interface LighterOnboarding {
  status: LighterOnboardingStatus;
  l1Address?: string;
  accountIndex?: number;
  collateral?: string;
  // Where the user sends USDC, present only while a deposit is what is needed.
  depositAddress?: string;
  // What is registered in our slot right now, if anything.
  registeredPublicKey?: string;
}

// Resolving needs the derived key only to tell "someone else's key is in our
// slot" from "our key is already there", and deriving costs the user a signature
// prompt. So when the slot is empty we answer without one: a brand new user goes
// straight to registration rather than signing twice.
export function resolveOnboarding(
  l1Address: string | undefined,
  state: LighterAccountState | null,
  derivedPublicKey?: string,
): LighterOnboarding {
  if (!l1Address) {
    return { status: "no-wallet" };
  }
  if (!state || !state.account) {
    return {
      status: "needs-deposit",
      l1Address,
      depositAddress: state?.depositAddress,
    };
  }

  const registered = state.apiKeys.find(
    (key) => key.apiKeyIndex === LIGHTER_API_KEY_INDEX,
  )?.publicKey;

  const base = {
    l1Address,
    accountIndex: state.account.index,
    collateral: state.account.collateral,
    registeredPublicKey: registered,
  };

  if (derivedPublicKey && registeredKeyMatches(derivedPublicKey, registered)) {
    return { status: "ready", ...base };
  }
  return { status: "needs-key", ...base };
}

export interface EnsureTradingKeyResult {
  onboarding: LighterOnboarding;
  // The registration transaction, when one was submitted. Absent when the key
  // was already registered, which is the common case for a returning user.
  txHash?: string;
}

// Brings the account to "ready", deriving the key and registering it only if it
// is not already registered.
//
// A returning user still signs once, because the key lives in WASM memory and a
// reload loses it, but they do not pay for a second signature or a redundant
// transaction. A first-time user signs twice, and that is unavoidable: the
// registration message names the public key, so the key has to exist before
// there is anything to authorize.
export async function ensureTradingKey(params: {
  provider: EIP1193Provider;
  l1Address: string;
}): Promise<EnsureTradingKeyResult> {
  const state = await fetchLighterAccountState(params.l1Address);
  const initial = resolveOnboarding(params.l1Address, state);

  if (initial.status !== "needs-key" || !state?.account) {
    return { onboarding: initial };
  }

  const session = await deriveTradingKey({
    provider: params.provider,
    l1Address: params.l1Address,
    accountIndex: state.account.index,
    nonce: state.nextNonce,
  });

  // Re-resolve now that the derived key is known. A returning user lands here
  // and is already done.
  const resolved = resolveOnboarding(params.l1Address, state, session.publicKey);
  if (resolved.status === "ready") {
    return { onboarding: resolved };
  }

  // Plain text naming the key being authorized, so the wallet prompt is
  // readable rather than a hash.
  const signature = await personalSign(
    params.provider,
    params.l1Address,
    session.registerMessage,
  );

  const tx = await signChangePubKey({
    accountIndex: state.account.index,
    signedMessage: signature,
    nonce: state.nextNonce,
    apiKeyIndex: LIGHTER_API_KEY_INDEX,
  });

  const txHash = await submitLighterTx(LIGHTER_TX_TYPE_CHANGE_PUBKEY, tx.txInfo);

  // Registration is not instant. Report what we believe rather than re-reading
  // here, and let the caller poll until the key shows up.
  return {
    onboarding: { ...resolved, status: "ready", registeredPublicKey: session.publicKey },
    txHash,
  };
}
