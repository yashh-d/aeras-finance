import "server-only";

import { PrivyClient, verifyAccessToken, type User } from "@privy-io/node";
import { createRemoteJWKSet } from "jose";

// Server-side Privy identity verification. Never trust a client-supplied email
// or wallet: verify the access token against Privy's JWKS, then fetch the
// canonical user by DID and read the linked email + embedded Solana wallet.

let cachedClient: PrivyClient | null = null;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function appId(): string {
  const v = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!v) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not set.");
  return v;
}

function appSecret(): string {
  const v = process.env.PRIVY_APP_SECRET;
  if (!v) throw new Error("PRIVY_APP_SECRET is not set.");
  return v;
}

function getClient(): PrivyClient {
  if (!cachedClient) {
    cachedClient = new PrivyClient({ appId: appId(), appSecret: appSecret() });
  }
  return cachedClient;
}

function getJwks() {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(
      new URL(`https://auth.privy.io/api/v1/apps/${appId()}/jwks.json`),
    );
  }
  return cachedJwks;
}

export type PrivyIdentity = {
  privyDid: string;
  email: string | null;
  walletAddress: string | null;
};

function extractEmail(user: User): string | null {
  for (const acct of user.linked_accounts ?? []) {
    if (acct.type === "email" && acct.address) {
      return acct.address.toLowerCase();
    }
    if (acct.type === "google_oauth" && acct.email) {
      return acct.email.toLowerCase();
    }
  }
  return null;
}

function extractWallet(user: User): string | null {
  // Prefer the Privy embedded Solana wallet; fall back to any Solana wallet.
  let fallback: string | null = null;
  for (const acct of user.linked_accounts ?? []) {
    if (acct.type !== "wallet" || acct.chain_type !== "solana") continue;
    if (acct.wallet_client_type === "privy") return acct.address;
    fallback ??= acct.address;
  }
  return fallback;
}

function tokenFromHeader(request: Request): string | null {
  const h =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// Verify the Privy access token from the Authorization header, then fetch the
// full user record. Returns null on a missing or invalid token.
export async function authenticate(
  request: Request,
): Promise<PrivyIdentity | null> {
  const token = tokenFromHeader(request);
  if (!token) return null;

  let userId: string;
  try {
    const verified = await verifyAccessToken({
      access_token: token,
      app_id: appId(),
      verification_key: getJwks(),
    });
    userId = verified.user_id;
  } catch {
    return null;
  }

  const user = await getClient().users()._get(userId);
  return {
    privyDid: user.id,
    email: extractEmail(user),
    walletAddress: extractWallet(user),
  };
}
