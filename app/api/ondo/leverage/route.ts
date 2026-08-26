import { NextResponse } from "next/server";

import { buildCatalog, findMarket } from "@/lib/ondo/markets";
import { ondoContracts, ondoMarkets, ondoSetLeverage } from "@/lib/ondo/server";
import { OndoSessionMissing, requireOndoSession } from "@/lib/ondo/session";

export const dynamic = "force-dynamic";

// Sets leverage for one market.
//
// Leverage is per market, but collateral is not: margin is cross only and there
// is no isolated mode, so this changes how much margin a position reserves
// rather than which collateral stands behind it. Every open position shares one
// margin balance regardless.
//
// The market's own maximum is checked here rather than left to Ondo, because
// the ceiling varies a lot (25x on the index perps, 20x on SPY and AAPL, 10x on
// TSLA and NVDA) and a rejection after the user has committed reads as a
// failure rather than as a limit.
export async function POST(request: Request) {
  let session;
  try {
    session = await requireOndoSession();
  } catch (err) {
    if (err instanceof OndoSessionMissing) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  let payload: { market?: unknown; leverage?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { market, leverage } = payload;

  if (typeof market !== "string" || market.length === 0) {
    return NextResponse.json({ error: "market is required" }, { status: 400 });
  }
  // Ondo takes a positive integer. A fractional value is rejected upstream, so
  // it is refused here where the reason can be stated.
  if (typeof leverage !== "number" || !Number.isInteger(leverage) || leverage < 1) {
    return NextResponse.json(
      { error: "leverage must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const [markets, contracts] = await Promise.all([ondoMarkets(), ondoContracts()]);
    const resolved = findMarket(buildCatalog(markets, contracts), market);

    if (!resolved) {
      return NextResponse.json(
        { error: `${market} is not an Ondo market` },
        { status: 404 },
      );
    }

    const max = Number(resolved.maxLeverage);
    if (leverage > max) {
      return NextResponse.json(
        { error: `${market} allows at most ${max}x`, reason: "above-max" },
        { status: 409 },
      );
    }

    await ondoSetLeverage(session.token, market, leverage);
    return NextResponse.json({ market, leverage });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
