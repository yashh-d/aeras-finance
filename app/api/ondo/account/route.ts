import { NextResponse } from "next/server";

import { liveCollateralHealth } from "@/lib/ondo/risk";
import {
  ondoAccount,
  ondoBalance,
  ondoPositions,
  ondoDeposits,
} from "@/lib/ondo/server";
import { OndoSessionMissing, requireOndoSession } from "@/lib/ondo/session";

export const dynamic = "force-dynamic";

// One read for everything the hedge surface needs about the user's Ondo
// account. Three upstream calls, because Ondo splits them, and no caller should
// have to know that.
//
// The collateral health block is computed here rather than upstream because
// Ondo does not return it. LTV is the number that decides whether the exchange
// sells the user's collateral out from under the hedge, and there is no field
// for it on any endpoint. See lib/ondo/risk.ts for how it is recovered.
export async function GET() {
  let session;
  try {
    session = await requireOndoSession();
  } catch (err) {
    if (err instanceof OndoSessionMissing) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  try {
    const [account, balance, positions, deposits] = await Promise.all([
      ondoAccount(session.token),
      ondoBalance(session.token),
      ondoPositions(session.token),
      // Never fatal: a missing deposit list costs a label, not a number.
      ondoDeposits(session.token).catch(() => []),
    ]);

    return NextResponse.json({
      address: session.address,
      account: {
        accountID: account.accountID,
        accountState: account.accountState,
        termsVersion: account.termsVersion,
        privacyVersion: account.privacyVersion,
        perpsEnabled: account.disabledFunctionality?.disablePerps === false,
        cooldownPeriodSecs: account.cooldownPeriodSecs,
      },
      balance,
      deposits,
      // Ondo returns a row per market the account has touched. Rows at zero
      // quantity are not open positions and are dropped here so a caller
      // counting them does not report six hedges against one holding.
      positions: positions.filter((p) => Number(p.netQuantity) > 0),
      collateralHealth: liveCollateralHealth(balance),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
