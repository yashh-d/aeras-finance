import { NextResponse } from "next/server";

import { LIGHTER_API_KEY_INDEX, LIGHTER_DEFAULT_INTENT_CHAIN } from "@/lib/lighter/constants";
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
// against Lighter's per-IP rate limit instead of once per user, and so the state
// they describe is consistent. Reading them separately from the page would let a
// registration or a fill land between two of them and produce a combination that
// never existed.
export async function GET(request: Request) {
  const l1Address = new URL(request.url).searchParams.get("l1Address");

  if (!l1Address || !/^0x[0-9a-fA-F]{40}$/.test(l1Address)) {
    return NextResponse.json(
      { error: "A valid l1Address is required" },
      { status: 400 },
    );
  }

  try {
    const account = await lighterAccountByL1Address(l1Address);

    // No account yet is the normal state before a first deposit, so answer with
    // somewhere to send funds rather than an error.
    if (!account) {
      const depositAddress = await lighterIntentAddress(
        l1Address,
        LIGHTER_DEFAULT_INTENT_CHAIN,
      );
      return NextResponse.json({
        account: null,
        apiKeys: [],
        nextNonce: 0,
        depositAddress,
      });
    }

    // The deposit address comes back for an existing account too, not just a
    // new one. It is derived from the L1 address so it never changes, and a user
    // adding margin to an account they already have needs it just as much as a
    // user opening one.
    const [apiKeys, nextNonce, detail, depositAddress] = await Promise.all([
      lighterAccountApiKeys(account.index),
      lighterNextNonce(account.index, LIGHTER_API_KEY_INDEX),
      lighterAccountDetail(account.index),
      lighterIntentAddress(l1Address, LIGHTER_DEFAULT_INTENT_CHAIN),
    ]);

    return NextResponse.json({
      account,
      apiKeys,
      nextNonce,
      detail,
      depositAddress,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
