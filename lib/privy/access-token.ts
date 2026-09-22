"use client";

// Module-level access to the Privy access token.
//
// Privy v3 exposes getAccessToken only through the usePrivy() hook, so a plain
// async module cannot reach it. The Trustware conversion path is exactly that
// shape: a chain of non-React functions (lib/trustware/execute.ts,
// lib/lighter/margin-fund.ts and friends) that now have to authenticate their
// calls to our own proxy, because the proxy resolves the payout address from
// the caller's identity rather than taking it from the request body.
//
// Threading a token through all of them would add an argument to six call
// sites for a value none of them otherwise cares about, and every one of those
// signatures is reached from a different hook. So the provider registers the
// hook's getter once at mount and these modules read it.
//
// The token is never cached here. The getter is called fresh for each request
// and Privy keeps ownership of refresh and expiry, which matters because a
// conversion can sit in flight for minutes and its receipt call must not go
// out with a token that expired while the bridge was settling.

type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;

// Called once from lib/privy/provider.tsx. Idempotent: React may remount the
// registering component, and overwriting with an equivalent getter is fine.
export function registerAccessTokenGetter(fn: TokenGetter): void {
  getter = fn;
}

export function clearAccessTokenGetter(): void {
  getter = null;
}

// Throws rather than returning null. Every caller is about to make a request
// that cannot succeed without a token, and a readable error here beats a 401
// surfacing from a proxy several frames down.
export async function requirePrivyAccessToken(): Promise<string> {
  if (!getter) {
    throw new Error("You are not signed in. Reload the page and sign in again.");
  }
  const token = await getter();
  if (!token) {
    throw new Error("Your session expired. Sign in again to continue.");
  }
  return token;
}

// Authorization header for a fetch to one of our own API routes.
//
// Only ever send this to a same-origin path. It is a bearer credential for the
// user's Privy session, and attaching it to a third-party request would hand
// that party the session.
export async function privyAuthHeaders(): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await requirePrivyAccessToken()}` };
}
