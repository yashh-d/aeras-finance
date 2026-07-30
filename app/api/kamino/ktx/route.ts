import { NextResponse } from "next/server";

import {
  KAMINO_ALLOWED_RESERVES,
  KAMINO_XSTOCKS_MARKET,
} from "@/lib/kamino/reserves";

export const dynamic = "force-dynamic";

// Kamino's KTX transaction API builds an unsigned Solana transaction server-side
// and returns it base64-encoded. We proxy it so the browser never talks to
// Kamino directly: it keeps a stable User-Agent (Kamino 403s some clients),
// sidesteps CORS, and lets us enforce the market + reserve allowlist.
const KTX_BASE = "https://api.kamino.finance/ktx/klend";

// Only the operations v1 needs. deposit/borrow open a position; repay/withdraw
// unwind it.
const ALLOWED_ACTIONS = new Set(["deposit", "borrow", "repay", "withdraw"]);

const UPSTREAM_TIMEOUT_MS = 8000;

interface KtxRequestBody {
  action?: string;
  wallet?: string;
  reserve?: string;
  amount?: string;
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(request: Request) {
  let body: KtxRequestBody;
  try {
    body = (await request.json()) as KtxRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, wallet, reserve, amount } = body;

  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "Unsupported action" },
      { status: 400 },
    );
  }
  if (!wallet || !BASE58_RE.test(wallet)) {
    return NextResponse.json(
      { error: "A valid wallet address is required" },
      { status: 400 },
    );
  }
  if (!reserve || !KAMINO_ALLOWED_RESERVES.has(reserve)) {
    return NextResponse.json(
      { error: "Unsupported reserve for v1" },
      { status: 400 },
    );
  }
  // Amount is atomic units as a decimal string. Reject anything non-numeric so
  // we never forward junk upstream.
  if (!amount || !/^\d+$/.test(amount) || amount === "0") {
    return NextResponse.json(
      { error: "A positive integer amount (atomic units) is required" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${KTX_BASE}/${action}`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "aeras-finance/0.1",
      },
      body: JSON.stringify({
        wallet,
        market: KAMINO_XSTOCKS_MARKET,
        reserve,
        amount,
      }),
    });
    clearTimeout(timeout);

    const payload = (await res.json()) as {
      transaction?: string;
      message?: string;
      code?: string;
    };

    if (!res.ok || !payload.transaction) {
      // Surface Kamino's own reason (e.g. obligation-not-found) so the client
      // can decide whether to fall back to a deposit-first flow.
      return NextResponse.json(
        {
          error: payload.message ?? `Kamino KTX failed: ${res.status}`,
          code: payload.code,
        },
        { status: res.status === 200 ? 502 : res.status },
      );
    }

    return NextResponse.json({ transaction: payload.transaction });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
