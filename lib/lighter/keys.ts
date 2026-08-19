"use client";

import type { EIP1193Provider } from "@privy-io/react-auth";

import { createSignerClient, type LighterSignerSession } from "./signer";

// The Lighter trading key is derived from a signature, never stored.
//
// The alternative was to generate a random key and keep it in localStorage,
// which means a key that can be exfiltrated by any script on the page, is lost
// when the user clears site data, and does not follow them to another browser.
// Deriving instead means the wallet is the only thing that has to persist, which
// it already does through Privy.
//
// This works because of a coincidence of shapes. Lighter's signer takes a seed
// of at least 32 bytes and hashes it into a scalar; an Ethereum personal_sign
// result is exactly 65. So the signature over a fixed message is itself a valid
// seed, and the same wallet signing the same message always reproduces the same
// trading key. It is the pattern Hyperliquid and dYdX use for agent wallets.
//
// The load-bearing assumption is that ECDSA signing is deterministic, which it
// is under RFC 6979 and which every mainstream signer implements. We do not
// simply trust it: registeredKeyMatches below compares the derived key against
// what the account actually has registered, so if a signer ever produced a
// different signature we detect it and re-register rather than silently signing
// orders with a key the sequencer will reject.

// Bumping this rotates every user's trading key, which then has to be
// re-registered against their account before they can trade again. It exists so
// that is a deliberate act rather than an accident.
const KEY_DERIVATION_VERSION = 1;

// Byte-for-byte stable. A change anywhere in this string, including whitespace,
// derives a different key for every existing user.
//
// The address is included so a signature taken on one wallet cannot be replayed
// as another's. The last paragraph is there because this is the one prompt a
// user sees that does not move funds, and a signature request with no
// explanation is how phishing looks.
export function keyDerivationMessage(l1Address: string): string {
  return [
    "Aeras Finance",
    "",
    "Derive Lighter trading key",
    `Address: ${l1Address.toLowerCase()}`,
    `Version: ${KEY_DERIVATION_VERSION}`,
    "",
    "This signature does not move funds or authorize a trade. It derives the",
    "key your hedges are signed with, so that nothing sensitive is stored in",
    "your browser. Only sign this on Aeras Finance.",
  ].join("\n");
}

function toHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// personal_sign takes hex-encoded data. Wallets decode it back to text for
// display when it is valid UTF-8, so the user still reads the message rather
// than a blob.
export async function personalSign(
  provider: EIP1193Provider,
  address: string,
  message: string,
): Promise<string> {
  const signature = await provider.request({
    method: "personal_sign",
    params: [toHex(message), address],
  });

  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw new Error("Wallet returned an unusable signature");
  }
  return signature;
}

// Derives the trading key and loads it into the WASM signer for this account.
//
// Must run again after every page reload. The signer keeps its clients in WASM
// memory, so a refresh loses the key even though the account and its
// registration are untouched. That is the whole reason derivation has to be
// reproducible rather than one-time.
export async function deriveTradingKey(params: {
  provider: EIP1193Provider;
  l1Address: string;
  accountIndex: number;
  nonce: number;
}): Promise<LighterSignerSession> {
  const signature = await personalSign(
    params.provider,
    params.l1Address,
    keyDerivationMessage(params.l1Address),
  );

  return createSignerClient({
    seed: signature.slice(2),
    accountIndex: params.accountIndex,
    nonce: params.nonce,
  });
}

// Whether the key we just derived is the one the account will accept.
//
// Compared case-insensitively because the two sides format hex differently: the
// signer returns it lowercase, the API has returned it both ways.
export function registeredKeyMatches(
  derivedPublicKey: string,
  registeredPublicKey: string | undefined,
): boolean {
  if (!registeredPublicKey) return false;

  const strip = (key: string) => key.replace(/^0x/, "").toLowerCase();
  const registered = strip(registeredPublicKey);

  // An all-zero key is an empty slot rather than a real registration, and
  // comparing it naively would report a match for a user who has none.
  if (/^0+$/.test(registered)) return false;

  return strip(derivedPublicKey) === registered;
}
