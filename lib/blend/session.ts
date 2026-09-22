"use client";

// Where the Blend sign-in lives between calls, and the one hint the app keeps
// about whether a wallet has a Blend account at all.
//
// The SIWE session (a JWT plus the account context) goes in sessionStorage,
// keyed by address, which is Blend's own guidance: per tab, gone when the tab
// closes, and never handed to a different address than it was minted for.
//
// The account marker goes in localStorage. It holds no secret, only the fact
// that this wallet has signed in to Blend from this browser, and it gates the
// table's position read (app/api/blend/position). That read has to look the
// account up by address, and Blend's lookup creates the account record when
// there is none, so the table asks only for wallets known to have one. A user
// who deposited from another device sees no position here until the panel
// signs them in once, which it does on the first deposit attempt; that gap is
// the price of not creating a Blend account for every wallet that opens the
// Earn tab.

import type { SerializedSession } from "@blend-money/fe";

const SESSION_PREFIX = "aeras:blend:session:";
const ACCOUNT_PREFIX = "aeras:blend:account:";

function key(prefix: string, address: string): string {
  return `${prefix}${address.toLowerCase()}`;
}

export function loadBlendSession(address: string): SerializedSession | null {
  try {
    const raw = sessionStorage.getItem(key(SESSION_PREFIX, address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SerializedSession;
    if (parsed.address?.toLowerCase() !== address.toLowerCase()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBlendSession(
  address: string,
  session: SerializedSession,
): void {
  try {
    sessionStorage.setItem(key(SESSION_PREFIX, address), JSON.stringify(session));
  } catch {
    // Storage unavailable (private mode, quota): the next call signs in again.
  }
}

export function clearBlendSession(address: string): void {
  try {
    sessionStorage.removeItem(key(SESSION_PREFIX, address));
  } catch {
    // Nothing to clear.
  }
}

export function markBlendAccount(address: string): void {
  try {
    localStorage.setItem(key(ACCOUNT_PREFIX, address), "1");
  } catch {
    // The position read stays gated off until a sign-in that can persist.
  }
}

export function hasBlendAccount(address: string): boolean {
  try {
    return localStorage.getItem(key(ACCOUNT_PREFIX, address)) === "1";
  } catch {
    return false;
  }
}
