// Browser-side reads of the Lighter catalog, through our own proxy route.
// Mirrors lib/trustware/client.ts: nothing in the browser talks to Lighter
// directly.

import type { LighterCatalog } from "./markets";
import type {
  LighterAccount,
  LighterAccountDetail,
  LighterApiKey,
} from "./types";

export async function fetchLighterCatalog(): Promise<LighterCatalog> {
  const res = await fetch("/api/lighter/markets", { cache: "no-store" });
  const body = (await res.json()) as LighterCatalog & { error?: string };

  if (!res.ok) {
    throw new Error(body.error ?? `Lighter catalog failed: ${res.status}`);
  }
  return { markets: body.markets, fetchedAt: body.fetchedAt };
}

export interface LighterAccountState {
  // Null until a deposit provisions the account.
  account: LighterAccount | null;
  apiKeys: LighterApiKey[];
  nextNonce: number;
  // Where USDC margin is sent. Derived from the L1 address, so it is the same
  // address before and after the account exists, and topping up an open account
  // uses it exactly as opening one does.
  depositAddress?: string;
  // Open positions and live margin. Absent until an account exists, for the same
  // reason as the account itself.
  detail?: LighterAccountDetail;
}

// One call for everything onboarding needs to decide what to do next. Collapsed
// into a single round trip because the three reads are useless apart and would
// otherwise race: an account read landing before a key read, with a registration
// in between, describes a state that never existed.
//
// Coalesced across callers as well. The wallet panel, the hedge tab and a
// running one-click flow all read this state, and a page load fires them
// within the same second. One shared in-flight promise plus a four-second
// result cache turns that burst into one request; the server route holds its
// own eight-second cache above this, and the two layers together are what
// keep Lighter's per-IP rate limit unreached. The credit poll during a run
// asks every fifteen seconds, comfortably past both TTLs, so it still sees
// fresh state.
const ACCOUNT_STATE_TTL_MS = 4_000;
const accountStateCache = new Map<
  string,
  { at: number; state: LighterAccountState }
>();
const accountStateInFlight = new Map<string, Promise<LighterAccountState>>();

export function fetchLighterAccountState(
  l1Address: string,
): Promise<LighterAccountState> {
  const cached = accountStateCache.get(l1Address);
  if (cached && Date.now() - cached.at < ACCOUNT_STATE_TTL_MS) {
    return Promise.resolve(cached.state);
  }
  const inFlight = accountStateInFlight.get(l1Address);
  if (inFlight) return inFlight;

  const request = (async () => {
    const res = await fetch(
      `/api/lighter/account?l1Address=${encodeURIComponent(l1Address)}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as LighterAccountState & { error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? `Lighter account read failed: ${res.status}`);
    }
    accountStateCache.set(l1Address, { at: Date.now(), state: body });
    return body;
  })().finally(() => {
    accountStateInFlight.delete(l1Address);
  });

  accountStateInFlight.set(l1Address, request);
  return request;
}

// Signing happens in the browser, submitting does not. Lighter geo-blocks
// sendTx, so the transaction is relayed by our own server, which runs in a
// permitted region. The signature is made against the user's own key either
// way: the relay carries the bytes, it cannot alter them without invalidating
// them.
export async function submitLighterTx(
  txType: number,
  txInfo: string,
): Promise<string> {
  const res = await fetch("/api/lighter/tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txType, txInfo }),
  });
  const body = (await res.json()) as { txHash?: string; error?: string };

  if (!res.ok || !body.txHash) {
    throw new Error(body.error ?? `Lighter transaction failed: ${res.status}`);
  }
  return body.txHash;
}
