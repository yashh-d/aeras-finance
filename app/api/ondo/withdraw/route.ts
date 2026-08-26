import { NextResponse } from "next/server";

import { creditableCollateral } from "@/lib/ondo/collateral";
import { buildCatalog, collateralAssets } from "@/lib/ondo/markets";
import { liveCollateralHealth } from "@/lib/ondo/risk";
import {
  OndoApiError,
  ondoAccount,
  ondoAddressBook,
  ondoBalance,
  ondoContracts,
  ondoDeposits,
  ondoMarkets,
  ondoPositions,
  ondoWithdraw,
  ondoWithdrawalLimits,
  ondoWithdrawals,
} from "@/lib/ondo/server";
import { OndoSessionMissing, requireOndoSession } from "@/lib/ondo/session";
import {
  buildWithdrawalView,
  describeWithdrawalError,
  planWithdrawal,
  toWithdrawRequest,
} from "@/lib/ondo/withdraw";

export const dynamic = "force-dynamic";

// GET: everything needed to offer a withdrawal.
//
// Seven upstream reads, because Ondo splits them and because the thing being
// answered ("how much of this asset can leave right now") is not any single
// endpoint's job. In particular there is no per-asset balance anywhere in
// Ondo's API, so the quantity is reconstructed in lib/ondo/withdraw.ts from the
// deposit and withdrawal ledgers and cross-checked against the credited margin
// value. That module carries the reasoning; this route only assembles inputs.
export async function GET() {
  const session = await session_();
  if (session instanceof NextResponse) return session;

  try {
    const [account, balance, positions, deposits, withdrawals, book, markets, contracts] =
      await Promise.all([
        ondoAccount(session.token),
        ondoBalance(session.token),
        ondoPositions(session.token),
        ondoDeposits(session.token).catch(() => []),
        ondoWithdrawals(session.token).catch(() => []),
        ondoAddressBook(session.token).catch(() => ({ addressBook: [] })),
        ondoMarkets(),
        ondoContracts(),
      ]);

    // Never fatal. A missing limit costs a pre-check, not the withdrawal: Ondo
    // enforces it upstream either way and answers `withdrawal_limit_exceeded`.
    const limits = await ondoWithdrawalLimits(session.token).catch(() => null);

    const collateral = creditableCollateral(
      collateralAssets(markets),
      buildCatalog(markets, contracts),
    );

    const view = buildWithdrawalView({
      ownAddress: session.address,
      collateral,
      deposits,
      withdrawals,
      positions: positions.filter((p) => Number(p.netQuantity) > 0),
      balance,
      health: liveCollateralHealth(balance),
      addressBook: (book.addressBook ?? []).map((e) => e.withdrawalAddress),
      cooldownPeriodSecs: account.cooldownPeriodSecs ?? 0,
      withdrawalFeeUsd: Number(account.withdrawalFeeUSD) || 0,
      limits,
    });

    return NextResponse.json(view);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

// POST: submit one withdrawal.
//
// The destination is not a parameter. It is the session's own wallet, resolved
// here and again inside planWithdrawal, and there is no body field that can
// move it. See app/api/ondo/address-book/challenge for the full argument.
//
// The view is rebuilt from live reads rather than trusting anything the browser
// computed, for the same reason app/api/ondo/orders recomputes size from a
// fresh preview: a tab left open overnight must not be able to withdraw against
// a balance that has since been spent backing a position.
export async function POST(request: Request) {
  const session = await session_();
  if (session instanceof NextResponse) return session;

  let payload: { symbol?: unknown; amount?: unknown; customerWithdrawalId?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { symbol, amount, customerWithdrawalId } = payload;
  if (typeof symbol !== "string" || symbol.length === 0) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  if (typeof amount !== "string" || amount.length === 0) {
    return NextResponse.json({ error: "amount is required" }, { status: 400 });
  }
  // The idempotency key comes from the client and is reused across retries of
  // the same attempt. Minting it here instead would make every retry a fresh
  // key, which is precisely how a network timeout becomes two withdrawals.
  if (typeof customerWithdrawalId !== "string" || customerWithdrawalId.length === 0) {
    return NextResponse.json(
      { error: "customerWithdrawalId is required" },
      { status: 400 },
    );
  }

  try {
    const [account, balance, positions, deposits, withdrawals, book, markets, contracts] =
      await Promise.all([
        ondoAccount(session.token),
        ondoBalance(session.token),
        ondoPositions(session.token),
        ondoDeposits(session.token).catch(() => []),
        ondoWithdrawals(session.token).catch(() => []),
        ondoAddressBook(session.token).catch(() => ({ addressBook: [] })),
        ondoMarkets(),
        ondoContracts(),
      ]);

    if (account.disabledFunctionality?.disableTransfers) {
      return NextResponse.json(
        {
          error:
            "Ondo has transfers disabled on this account, so withdrawals are blocked. Contact Ondo support.",
        },
        { status: 409 },
      );
    }

    const limits = await ondoWithdrawalLimits(session.token).catch(() => null);

    const collateral = creditableCollateral(
      collateralAssets(markets),
      buildCatalog(markets, contracts),
    );

    const view = buildWithdrawalView({
      ownAddress: session.address,
      collateral,
      deposits,
      withdrawals,
      positions: positions.filter((p) => Number(p.netQuantity) > 0),
      balance,
      health: liveCollateralHealth(balance),
      addressBook: (book.addressBook ?? []).map((e) => e.withdrawalAddress),
      cooldownPeriodSecs: account.cooldownPeriodSecs ?? 0,
      withdrawalFeeUsd: Number(account.withdrawalFeeUSD) || 0,
      limits,
    });

    const plan = planWithdrawal({ view, symbol, amount, customerWithdrawalId });
    if (plan.kind === "blocked") {
      return NextResponse.json({ error: plan.reason, reason: "blocked" }, { status: 409 });
    }

    const result = await ondoWithdraw(session.token, toWithdrawRequest(plan));

    return NextResponse.json({
      ...result,
      symbol: plan.symbol,
      amount: plan.amount,
      address: plan.address,
      network: plan.network,
      valueUsd: plan.valueUsd,
    });
  } catch (err) {
    // Ondo's withdrawal refusals are the one place in this integration where
    // the upstream message is not the best thing to show: several name an
    // internal concept or omit the remedy entirely, and a user watching a
    // withdrawal fail needs to know whether their money is stuck or the request
    // was simply wrong.
    if (err instanceof OndoApiError) {
      return NextResponse.json(
        {
          error: describeWithdrawalError(err.code, err.message),
          code: err.code,
        },
        { status: err.status === 400 ? 409 : 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

async function session_() {
  try {
    return await requireOndoSession();
  } catch (err) {
    if (err instanceof OndoSessionMissing) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
