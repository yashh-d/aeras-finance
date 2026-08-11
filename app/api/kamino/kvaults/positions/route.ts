import { NextResponse } from "next/server";

import {
  KAMINO_ALLOWED_KVAULTS,
  RATIO_PRECISION,
  decimalToScaled,
  kaminoVaultByAddress,
  type KaminoPosition,
} from "@/lib/kamino/kvaults";

export const dynamic = "force-dynamic";

// A wallet's K-Vault share balances.
//
// This cannot be read from the wallet's token accounts the way Jupiter Lend's
// jlToken position is. A K-Vault deposit auto-stakes the shares into the
// vault's farm in the same transaction, so the share-token account reads zero
// while the position is live. Kamino's positions endpoint is the only source
// that counts staked shares. Verified on 2026-08-05 against a wallet holding
// 1308.142884 staked and 0 unstaked shares.
const DATA_BASE = "https://api.kamino.finance/kvaults/users";
const UPSTREAM_TIMEOUT_MS = 8000;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface RawPosition {
  vaultAddress?: string;
  // Human-readable share amounts, e.g. "1308.142884".
  totalShares?: string;
}

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet || !BASE58_RE.test(wallet)) {
    return NextResponse.json(
      { error: "A valid wallet address is required" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${DATA_BASE}/${wallet}/positions`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "aeras-finance/0.1" },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Kamino positions failed: ${res.status}` },
        { status: 502 },
      );
    }

    const raw = (await res.json()) as RawPosition[];
    // A wallet can hold positions in any of Kamino's 168 vaults. Keep only the
    // curated set, since a row we do not render is a row we cannot let anyone
    // act on.
    const positions: KaminoPosition[] = (Array.isArray(raw) ? raw : [])
      .filter((p) => p.vaultAddress && KAMINO_ALLOWED_KVAULTS.has(p.vaultAddress))
      .map((p) => {
        const meta = kaminoVaultByAddress(p.vaultAddress as string);
        return {
          vaultAddress: p.vaultAddress as string,
          totalSharesAtomic: decimalToScaled(
            p.totalShares ?? "0",
            meta?.sharesDecimals ?? RATIO_PRECISION,
          ),
        };
      })
      .filter((p) => p.totalSharesAtomic !== "0");

    return NextResponse.json({ positions });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
