import { NextResponse } from "next/server";

import {
  LIGHTER_API_KEY_INDEX,
  LIGHTER_DEFAULT_INTENT_CHAIN,
  LIGHTER_INTENT_CHAIN_IDS,
  type LighterIntentChain,
} from "@/lib/lighter/constants";
import {
  lighterAccountApiKeys,
  lighterAccountByL1Address,
  lighterAccountDetail,
  lighterIntentAddress,
  lighterNextNonce,
} from "@/lib/lighter/server";

export const dynamic = "force-dynamic";

// Everything the onboarding state machine and the hedge tab need to decide what
// the user has to do next: whether they have an account, which trading keys are
// registered against it, the next nonce for our key slot, where to deposit if
// they have no account yet, and what is currently open.
//
// Gathered here rather than in the browser so the upstream calls count once
// against Lighter's per-IP rate limit and describe one consistent moment.
//
// The caching below is what makes that claim true. Without it every GET fanned
// out four or five upstream calls, several hooks poll this route, and Lighter's
// per-IP limit turned the whole surface into 429s that we then relayed as 502s.
// Two caches with different lifetimes, because the data has two lifetimes:
//
//   - The deposit address is DERIVED from the L1 address per chain. It cannot
//     change, so it is cached for the life of the process and costs one
//     upstream call per (address, chain), ever.
//   - The account snapshot is live state and gets a short TTL: long enough to
//     coalesce a burst of polling hooks into one upstream read, short enough
//     that a registration or a fill shows up on the next poll. On an upstream
//     failure a stale snapshot is served rather than an error, because every
//     caller of this route degrades better on old truth than on no truth.
//
// Per-instance memory, which is exactly the scope the comment above needs: the
// rate limit being protected is per-IP, and each serverless instance is one IP.

const INTENT_ADDRESS_CACHE = new Map<string, string>();

interface Snapshot {
  at: number;
  body: Record<string, unknown>;
}
const SNAPSHOT_TTL_MS = 8_000;
const SNAPSHOT_CACHE = new Map<string, Snapshot>();

async function cachedIntentAddress(
  l1Address: string,
  chain: LighterIntentChain,
): Promise<string> {
  const key = `${l1Address}:${chain}`;
  const hit = INTENT_ADDRESS_CACHE.get(key);
  if (hit) return hit;
  const address = await lighterIntentAddress(l1Address, chain);
  INTENT_ADDRESS_CACHE.set(key, address);
  return address;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const l1Address = params.get("l1Address");

  if (!l1Address || !/^0x[0-9a-fA-F]{40}$/.test(l1Address)) {
    return NextResponse.json(
      { error: "A valid l1Address is required" },
      { status: 400 },
    );
  }

  // Which chain the deposit address should be issued on. Solana unless asked
  // otherwise, because that is the wallet the user already funds. The
  // borrow-funded hedge asks for a bridge chain's address at pay time.
  //
  // Checked against the table rather than passed through: this value picks the
  // address a user is then told to send real money to, and an unvalidated one
  // would let a caller request an address on a chain we cannot reach.
  const requested = params.get("intentChain");
  if (requested != null && !(requested in LIGHTER_INTENT_CHAIN_IDS)) {
    return NextResponse.json(
      { error: `Unsupported intent chain: ${requested}` },
      { status: 400 },
    );
  }
  const intentChain: LighterIntentChain =
    (requested as LighterIntentChain | null) ?? LIGHTER_DEFAULT_INTENT_CHAIN;

  const cacheKey = `${l1Address}:${intentChain}`;
  const cached = SNAPSHOT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) {
    return NextResponse.json(cached.body);
  }

  try {
    const account = await lighterAccountByL1Address(l1Address);

    // No account yet is the normal state before a first deposit, so answer with
    // somewhere to send funds rather than an error.
    let body: Record<string, unknown>;
    if (!account) {
      const depositAddress = await cachedIntentAddress(l1Address, intentChain);
      body = {
        account: null,
        apiKeys: [],
        nextNonce: 0,
        depositAddress,
        intentChain,
      };
    } else {
      // The deposit address comes back for an existing account too, not just a
      // new one. It is derived from the L1 address so it never changes, and a
      // user adding margin to an account they already have needs it just as
      // much as a user opening one.
      const [apiKeys, nextNonce, detail, depositAddress] = await Promise.all([
        lighterAccountApiKeys(account.index),
        lighterNextNonce(account.index, LIGHTER_API_KEY_INDEX),
        lighterAccountDetail(account.index),
        cachedIntentAddress(l1Address, intentChain),
      ]);
      body = {
        account,
        apiKeys,
        nextNonce,
        detail,
        depositAddress,
        // Echoed so a caller cannot mistake which chain the address is for.
        // The shapes differ (base58 on Solana, 0x on an EVM chain) and sending
        // to the wrong one loses the funds.
        intentChain,
      };
    }

    SNAPSHOT_CACHE.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    // Old truth beats no truth for every caller of this route: a hook showing
    // slightly stale margin degrades gracefully, one showing an error banner
    // does not. The staleness is marked so a caller that cares can tell.
    if (cached) {
      return NextResponse.json({ ...cached.body, stale: true });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
