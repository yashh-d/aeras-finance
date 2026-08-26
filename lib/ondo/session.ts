import "server-only";

import { cookies } from "next/headers";

import { ONDO_JWT_TTL_SECONDS, ONDO_SESSION_COOKIE } from "./constants";

// Where the Ondo JWT lives between requests.
//
// It is held in an httpOnly cookie rather than returned to the browser, for the
// same reason the Privy app secret never leaves the server: this token
// authorises trading on the user's Ondo account for a full 24 hours, and unlike
// a transaction signature it is not scoped to one action. Page JavaScript never
// needs to read it, so it never gets to.
//
// Nothing here is a substitute for Ondo's own authorisation. The token is bound
// to the wallet address that signed the challenge, so a cookie replayed
// elsewhere still only reaches the account it was minted for.

export interface OndoSession {
  token: string;
  // The address that signed the challenge. Stored alongside so a session can be
  // matched against the wallet currently connected in the browser: switching
  // Privy accounts must not silently keep trading through the previous one.
  address: string;
}

// The cookie is capped to the token's own lifetime. Ondo mints JWTs with
// exp - iat of exactly 86400 seconds, so a longer cookie would present an
// expired token as a live session and turn every call into an opaque 401.
export async function setOndoSession(session: OndoSession): Promise<void> {
  const store = await cookies();

  store.set(ONDO_SESSION_COOKIE, encode(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONDO_JWT_TTL_SECONDS,
  });
}

export async function readOndoSession(): Promise<OndoSession | null> {
  const store = await cookies();
  const raw = store.get(ONDO_SESSION_COOKIE)?.value;
  return raw ? decode(raw) : null;
}

export async function clearOndoSession(): Promise<void> {
  const store = await cookies();
  store.delete(ONDO_SESSION_COOKIE);
}

// Routes that cannot do anything useful without a session say so with a 401
// rather than calling Ondo with an empty bearer token and surfacing whatever
// Ondo says about it.
export class OndoSessionMissing extends Error {
  constructor() {
    super("No Ondo session. Sign in to Ondo Perps first.");
    this.name = "OndoSessionMissing";
  }
}

export async function requireOndoSession(): Promise<OndoSession> {
  const session = await readOndoSession();
  if (!session) throw new OndoSessionMissing();
  return session;
}

// Base64url rather than JSON in the cookie value, so an address containing a
// separator cannot forge a second field. The contents are not secret from the
// server and are not meant to be tamper-proof: the token inside is signed by
// Ondo and is the only thing that authorises anything.
function encode(session: OndoSession): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function decode(raw: string): OndoSession | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as OndoSession).token === "string" &&
      typeof (parsed as OndoSession).address === "string"
    ) {
      return parsed as OndoSession;
    }
  } catch {
    // A malformed cookie is treated as no session at all. It is recoverable by
    // signing in again, which is better than a 500 on every read.
  }
  return null;
}
