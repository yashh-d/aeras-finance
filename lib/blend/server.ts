import "server-only";

import { BLEND_ACCOUNT_TYPE_ID, BLEND_API_BASE_URL } from "./constants";

// The one way route handlers call Blend's server API. Reads only: yield, the
// account by address, its balance. The key never leaves this side.
//
// Blend answers every call in one envelope, `{ status: "success", data }` or
// `{ status: "error", message }`, and one of its 404s is an operator action
// rather than an outage ("No vault config deployed for this account type"
// means the strategy is pending Provision in the portal), so the message is
// kept on the error.

const UPSTREAM_TIMEOUT_MS = 6_000;

export function blendAccountTypeId(): string {
  return process.env.BLEND_ACCOUNT_TYPE_ID ?? BLEND_ACCOUNT_TYPE_ID;
}

export async function blendServerGet<T>(path: string): Promise<T> {
  const key = process.env.BLEND_API_KEY;
  if (!key) throw new Error("BLEND_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(
      `${BLEND_API_BASE_URL}/extern/svr/${encodeURIComponent(blendAccountTypeId())}${path}`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: { "x-api-key": key, accept: "application/json" },
      },
    );
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => null)) as {
    status?: string;
    data?: T;
    message?: string;
  } | null;
  if (!res.ok || json?.status !== "success" || json.data === undefined) {
    throw new Error(
      `Blend ${path}: upstream ${res.status}${json?.message ? `: ${json.message}` : ""}`,
    );
  }
  return json.data;
}

export interface BlendServerAccount {
  accountId: string;
  safeAddress: string;
  chainsDeployed?: number[];
}

// The account behind an EOA. Creates the record when Blend has none, so call
// it only for an address that has signed in (see app/api/blend/position).
export function blendAccountByAddress(
  address: string,
): Promise<BlendServerAccount> {
  return blendServerGet<BlendServerAccount>(
    `/account?address=${encodeURIComponent(address)}`,
  );
}
