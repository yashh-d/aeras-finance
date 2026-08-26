import { NextResponse } from "next/server";

import {
  KAMINO_ALLOWED_KVAULTS,
  atomicToDecimalString,
  kaminoVaultByAddress,
  type KtxInstruction,
} from "@/lib/kamino/kvaults";

export const dynamic = "force-dynamic";

// Builds a K-Vault deposit or withdrawal. Same role as the klend KTX proxy:
// stable User-Agent, no CORS, and a vault allowlist so a caller cannot have us
// build a transaction into an uncurated vault.
//
// KTX takes HUMAN-READABLE amounts, not atomic units. Posting `amount: "1"` to
// a 6-decimal vault produces an on-chain arg of 1000000. Verified on 2026-08-05
// by decoding the returned instruction data. Callers pass atomic units, which
// is the repo convention and keeps float rounding out of the amount path, and
// the conversion happens here, once, at the boundary.
//
// This hits the `-instructions` endpoints, not `/deposit` and `/withdraw`,
// which return a fully built transaction. Two reasons, both about deposits
// landing. KTX bakes no ComputeBudget instructions into the transactions it
// builds -- verified 2026-08-26 by decoding one: an ATA create, the kvault
// instruction and two farm instructions, no unit limit and no unit price -- so
// every Kamino deposit went out at zero priority fee, and there is no request
// parameter to change that (its OpenAPI spec takes wallet, kvault, amount and
// memo, nothing else). And the blockhash was Kamino's, chosen before the
// round trip back to the browser and the signing prompt, so it arrived already
// part-spent. Taking the raw instructions lets the client attach a priority fee
// and a blockhash it fetched itself, moments before signing.
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
    const res = await fetch(`${KTX_BASE}/${action}-instructions`, {
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
      instructions?: KtxInstruction[];
      lutsByAddress?: Record<string, string[]>;
      message?: string;
      code?: string;
    };

    if (!res.ok || !payload.instructions?.length) {
      return NextResponse.json(
        {
          error: payload.message ?? `Kamino KTX failed: ${res.status}`,
          code: payload.code,
        },
        { status: res.status === 200 ? 502 : res.status },
      );
    }

    // Every instruction must be signable by this wallet and nobody else. KTX is
    // upstream and trusted, but a deposit is the one place where an unexpected
    // extra signer would be worth catching before it reaches a signing prompt.
    for (const ix of payload.instructions) {
      for (const account of ix.accounts) {
        const isSigner = account.role.endsWith("SIGNER");
        if (isSigner && account.address !== wallet) {
          return NextResponse.json(
            { error: "Kamino returned a transaction requiring another signer" },
            { status: 502 },
          );
        }
      }
    }

    return NextResponse.json({
      instructions: payload.instructions,
      lutsByAddress: payload.lutsByAddress ?? {},
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
