"use client";

import type { EIP1193Provider } from "@privy-io/react-auth";

// Signing in to Ondo Perps from the browser.
//
// Three steps, one signature, and the JWT never comes back to this side: our
// own route holds it in an httpOnly cookie. See lib/ondo/session.ts.
//
// The wallet doing the signing is the Privy embedded EVM wallet, the same one
// Trustware signs its source leg with. Ondo keys the account by that address,
// so it is both the identity and, later, the owner of the deposit that funds
// the margin. Auth happens on Ethereum mainnet regardless of where the deposit
// lands, but nothing here switches chains: personal_sign is an off-chain
// signature and the chain id is asserted in the message text, not by the
// wallet's current network.

export interface OndoSignInResult {
  accountID: string;
  accountState: string;
  // 0 means Ondo's terms have never been accepted by this account. Reads work
  // at 0. Whether to ask is a UI decision, and POST /api/ondo/agreement is the
  // only thing that records an answer.
  termsVersion: number;
  privacyVersion: number;
  perpsEnabled: boolean;
}

export async function signInToOndo(
  provider: EIP1193Provider,
  address: string,
): Promise<OndoSignInResult> {
  const challenge = await postJson<{ id: string; message: string }>(
    "/api/ondo/auth/challenge",
    { walletAddress: address },
  );

  // The challenge carries a five-minute expiry inside the message. A user who
  // leaves the signing prompt open longer than that produces a valid signature
  // over a dead challenge, which fails at the next step. The remedy is a fresh
  // challenge, not a retry of this signature, so nothing here is cached.
  const signature = await personalSign(provider, address, challenge.message);

  return postJson<OndoSignInResult>("/api/ondo/auth/session", {
    id: challenge.id,
    signature,
    address,
  });
}

export async function signOutOfOndo(): Promise<void> {
  const res = await fetch("/api/ondo/auth/session", { method: "DELETE" });
  if (!res.ok) throw new Error("Could not clear the Ondo session");
}

// Registering the wallet as a withdrawal destination.
//
// A second SIWE flow, and holding a valid session is deliberately not enough to
// complete it: Ondo re-authorises this with a fresh wallet signature. That is
// the right call. A session cookie is a bearer credential for 24 hours, while
// adding a payout address is the one action that could empty an account rather
// than merely trade it.
//
// **No address argument.** The route mints the challenge against the wallet
// that owns the session and the signature is verified against the message Ondo
// issued, so there is nothing on this path that can redirect where money goes.
// The returned `withdrawalAddress` is what was actually authorised, and a
// caller should show it rather than assume it.
//
// Not called from sign-in. Registering a payout destination is a decision, and
// it belongs to an explicit action with the address visible.
export async function registerOndoWithdrawalAddress(
  provider: EIP1193Provider,
  address: string,
  label?: string,
): Promise<{ registered: boolean; withdrawalAddress: string }> {
  const challenge = await postJson<{
    id: string;
    message: string;
    withdrawalAddress: string;
  }>("/api/ondo/address-book/challenge", {});

  // Ondo binds the challenge to a wallet, and the signature has to come from
  // that wallet. If the browser's connected wallet has drifted from the one
  // that owns the session, signing produces a valid signature Ondo will reject,
  // so it is caught here where the message can say what actually happened.
  if (challenge.withdrawalAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      "The connected wallet is not the one signed in to Ondo. Sign in to Ondo again with this wallet before registering it.",
    );
  }

  // Same five-minute expiry as the login challenge, stated inside the message.
  // A prompt left open past it produces a valid signature over a dead
  // challenge, so nothing here is cached and a retry starts from a new one.
  const signature = await personalSign(provider, address, challenge.message);

  const result = await postJson<{ registered: boolean; ownAddress: string }>(
    "/api/ondo/address-book",
    { id: challenge.id, signature, label },
  );

  return { registered: result.registered, withdrawalAddress: result.ownAddress };
}

// Records acceptance of Ondo's terms. Call this from an explicit control with
// the documents linked, never as part of sign-in.
export async function acceptOndoTerms(versions: {
  termsVersion: number;
  privacyVersion: number;
}): Promise<void> {
  await postJson<unknown>("/api/ondo/agreement", versions);
}

// personal_sign takes hex-encoded data. Wallets decode it back to text for
// display when it is valid UTF-8, so the user reads the actual SIWE statement
// rather than a blob.
//
// lib/lighter/keys.ts has a twin of this. They are kept apart on purpose: the
// two venues are independent integrations and neither should stop working
// because the other was removed.
async function personalSign(
  provider: EIP1193Provider,
  address: string,
  message: string,
): Promise<string> {
  const hex = `0x${Array.from(new TextEncoder().encode(message), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")}`;

  const signature = await provider.request({
    method: "personal_sign",
    params: [hex, address],
  });

  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw new Error("Wallet returned an unusable signature");
  }
  return signature;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const parsed = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(parsed.error ?? `${path} failed: ${res.status}`);
  }
  return parsed;
}
