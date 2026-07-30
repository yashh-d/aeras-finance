import { NextResponse } from "next/server";

import { KAMINO_XSTOCKS_MARKET } from "@/lib/kamino/reserves";

export const dynamic = "force-dynamic";

// Kamino's data API returns a user's obligations for a market. We proxy it to
// keep the browser off Kamino directly (stable User-Agent, no CORS) and to trim
// the very large payload down to what the position card needs.
const DATA_BASE = "https://api.kamino.finance/kamino-market";
const UPSTREAM_TIMEOUT_MS = 8000;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Shape we return to the client: one obligation's essentials, or null.
export interface KaminoObligationSummary {
  obligationAddress: string;
  // Per-collateral deposits in this obligation (atomic amounts as strings).
  deposits: { reserve: string; depositedAmount: string }[];
  // USD figures and ratios Kamino already computed. Strings to preserve
  // precision; the client parses for display.
  totalDepositUsd: string;
  totalBorrowUsd: string;
  loanToValue: string;
  liquidationLtv: string;
}

interface RawObligation {
  obligationAddress?: string;
  state?: {
    deposits?: { depositReserve?: string; depositedAmount?: string }[];
  };
  refreshedStats?: {
    userTotalDeposit?: string;
    userTotalBorrow?: string;
    loanToValue?: string;
    liquidationLtv?: string;
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  if (!wallet || !BASE58_RE.test(wallet)) {
    return NextResponse.json(
      { error: "A valid wallet address is required" },
      { status: 400 },
    );
  }

  const url = `${DATA_BASE}/${KAMINO_XSTOCKS_MARKET}/users/${wallet}/obligations`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "aeras-finance/0.1" },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Kamino obligations failed: ${res.status}` },
        { status: 502 },
      );
    }
    const raw = (await res.json()) as RawObligation[];
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ obligation: null });
    }
    // v1 obligations in the xStocks Market are Vanilla single-collateral loans.
    // Return the first (and only) obligation with a live balance; fall back to
    // the first if none has debt yet (deposit-only state).
    const withBalance =
      raw.find((o) => (o.state?.deposits?.length ?? 0) > 0) ?? raw[0];
    const summary: KaminoObligationSummary = {
      obligationAddress: withBalance.obligationAddress ?? "",
      deposits: (withBalance.state?.deposits ?? [])
        .filter((d) => d.depositReserve && d.depositedAmount)
        .map((d) => ({
          reserve: d.depositReserve as string,
          depositedAmount: d.depositedAmount as string,
        })),
      totalDepositUsd: withBalance.refreshedStats?.userTotalDeposit ?? "0",
      totalBorrowUsd: withBalance.refreshedStats?.userTotalBorrow ?? "0",
      loanToValue: withBalance.refreshedStats?.loanToValue ?? "0",
      liquidationLtv: withBalance.refreshedStats?.liquidationLtv ?? "0",
    };
    return NextResponse.json({ obligation: summary });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
