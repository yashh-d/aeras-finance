import { NextResponse } from "next/server";

import {
  KAMINO_ALLOWED_KVAULTS,
  atomicToDecimalString,
  kaminoVaultByAddress,
} from "@/lib/kamino/kvaults";

export const dynamic = "force-dynamic";

// Builds an unsigned K-Vault deposit or withdrawal. Same role as the klend KTX
// proxy: stable User-Agent, no CORS, and a vault allowlist so a caller cannot
// have us build a transaction into an uncurated vault.
//
// KTX takes HUMAN-READABLE amounts, not atomic units. Posting `amount: "1"` to
// a 6-decimal vault produces an on-chain arg of 1000000. Verified on 2026-08-05
// by decoding the returned instruction data. Callers pass atomic units, which
// is the repo convention and keeps float rounding out of the amount path, and
// the conversion happens here, once, at the boundary.
const KTX_BASE = "https://api.kamino.finance/ktx/kvault";

const ALLOWED_ACTIONS = new Set(["deposit", "withdraw"]);

const UPSTREAM_TIMEOUT_MS = 8000;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface KtxRequestBody {
  action?: string;
  wallet?: string;
  vault?: string;
  amount?: string;
}

export async function POST(request: Request) {
  let body: KtxRequestBody;
  try {
    body = (await request.json()) as KtxRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, wallet, vault, amount } = body;

  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
  if (!wallet || !BASE58_RE.test(wallet)) {
    return NextResponse.json(
      { error: "A valid wallet address is required" },
      { status: 400 },
    );
  }
  if (!vault || !KAMINO_ALLOWED_KVAULTS.has(vault)) {
    return NextResponse.json(
      { error: "Unsupported vault for v1" },
      { status: 400 },
    );
  }
  if (!amount || !/^\d+$/.test(amount) || amount === "0") {
    return NextResponse.json(
      { error: "A positive integer amount (atomic units) is required" },
      { status: 400 },
    );
  }

  const meta = kaminoVaultByAddress(vault);
  if (!meta) {
    return NextResponse.json({ error: "Unknown vault" }, { status: 400 });
  }

  // Deposits are denominated in the underlying token; withdrawals are
  // denominated in shares. The two mints can carry different decimals, so the
  // scale has to follow the action.
  const decimals =
    action === "deposit" ? meta.tokenDecimals : meta.sharesDecimals;
  const uiAmount = atomicToDecimalString(amount, decimals);

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
      body: JSON.stringify({ wallet, kvault: vault, amount: uiAmount }),
    });
    clearTimeout(timeout);

    const payload = (await res.json()) as {
      transaction?: string;
      message?: string;
      code?: string;
    };

    if (!res.ok || !payload.transaction) {
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
