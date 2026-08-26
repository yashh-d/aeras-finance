import { NextResponse } from "next/server";

import { ONDO_ENV } from "@/lib/ondo/constants";
import {
  buildCatalog,
  collateralAssets,
  findMarket,
  type OndoCatalog,
} from "@/lib/ondo/markets";
import {
  buildCloseHedgeOrder,
  buildHedgeOrder,
  buildTradeOrder,
  hedgeClientOrderId,
} from "@/lib/ondo/orders";
import { previewHedge } from "@/lib/ondo/preview";
import {
  ondoContracts,
  ondoMarkets,
  ondoMaxOrderSize,
  ondoPlaceOrder,
  ondoPositions,
} from "@/lib/ondo/server";
import { OndoSessionMissing, requireOndoSession } from "@/lib/ondo/session";
import { clampToMaxOrderSize, computeOrderSize } from "@/lib/ondo/sizing";

export const dynamic = "force-dynamic";

// Opening and closing a hedge.
//
// The size is computed here, not accepted from the browser. The panel previews
// with the same previewHedge this route calls, so preview and submission cannot
// disagree about what a hedge ratio means, and a stale catalog in a tab left
// open cannot size an order against yesterday's price. What the client sends is
// the intent: which holding, and how much of it to offset.
//
// Two clamps apply in order, and they answer different questions.
// computeHedgeSize bounds the order by the user's own exposure and the market's
// position cap. max_order_size then bounds it by what their margin can carry
// right now, which is live account state this route is the first thing to see.

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

  let payload: {
    action?: unknown;
    xstockSymbol?: unknown;
    quantity?: unknown;
    tokenPriceUsd?: unknown;
    hedgeRatio?: unknown;
    market?: unknown;
    size?: unknown;
    side?: unknown;
    notionalUsd?: unknown;
    reduceOnly?: unknown;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  try {
    if (payload.action === "close") {
      return await closeHedge(session.token, payload);
    }
    if (payload.action === "open") {
      return await openHedge(session.token, payload);
    }
    if (payload.action === "trade") {
      return await placeTrade(session.token, payload);
    }
    return NextResponse.json(
      { error: 'action must be "open", "close" or "trade"' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

async function openHedge(
  token: string,
  payload: {
    xstockSymbol?: unknown;
    quantity?: unknown;
    tokenPriceUsd?: unknown;
    hedgeRatio?: unknown;
  },
) {
  const { xstockSymbol, quantity, tokenPriceUsd, hedgeRatio } = payload;

  if (typeof xstockSymbol !== "string" || xstockSymbol.length === 0) {
    return NextResponse.json({ error: "xstockSymbol is required" }, { status: 400 });
  }
  if (!isDecimalString(quantity) || !isDecimalString(tokenPriceUsd)) {
    return NextResponse.json(
      { error: "quantity and tokenPriceUsd must be decimal strings" },
      { status: 400 },
    );
  }
  if (typeof hedgeRatio !== "number" || !(hedgeRatio > 0) || hedgeRatio > 1) {
    return NextResponse.json(
      { error: "hedgeRatio must be between 0 and 1" },
      { status: 400 },
    );
  }

  const catalog = await readCatalog();
  const preview = previewHedge({
    catalog,
    xstockSymbol,
    quantity,
    tokenPriceUsd,
    hedgeRatio,
  });

  if (!preview.ok) {
    return NextResponse.json(
      { error: `Hedge unavailable: ${preview.reason}`, reason: preview.reason },
      { status: 409 },
    );
  }

  // A market order cannot rest. Ondo will take a resting limit order into a
  // closed market, but a market order there has no book to fill against, so
  // this refuses rather than sending one and reporting whatever comes back.
  if (preview.marketClosed) {
    return NextResponse.json(
      {
        error: `${preview.market.market} is closed. Equity and index perps run different calendars, so one leg can be closed while the other trades.`,
        reason: "market-closed",
      },
      { status: 409 },
    );
  }

  // What Ondo says this account can actually sell right now. A short reads
  // maxAskBaseSize; there is no side parameter on the endpoint.
  const limits = await ondoMaxOrderSize(token, preview.market.market);
  const clamped = clampToMaxOrderSize(
    preview.size.size,
    limits.percent100.maxAskBaseSize,
    preview.market.baseIncrement,
  );

  if (Number(clamped.size) <= 0) {
    return NextResponse.json(
      {
        error:
          "Ondo reports no available margin for this short. Deposit collateral before hedging.",
        reason: "no-margin",
      },
      { status: 409 },
    );
  }

  const order = buildHedgeOrder({
    market: preview.market.market,
    size: clamped.size,
    clientOrderId: hedgeClientOrderId("open"),
  });

  const placed = await ondoPlaceOrder(token, order);

  return NextResponse.json({
    order: placed,
    market: preview.market.market,
    // The achieved figures, not the requested ones. Both clamps can bind, and a
    // caller that echoes the requested ratio back to the user is lying about
    // how much of the holding is covered.
    size: clamped.size,
    clampedByMargin: clamped.clamped,
    limitedBy: preview.size.limitedBy,
    effectiveRatio: preview.size.effectiveRatio,
    basisRisk: preview.basisRisk,
    builderCode: order.builderCode,
    environment: ONDO_ENV,
  });
}

async function closeHedge(
  token: string,
  payload: { market?: unknown; size?: unknown },
) {
  const { market, size } = payload;

  if (typeof market !== "string" || market.length === 0) {
    return NextResponse.json({ error: "market is required" }, { status: 400 });
  }

  // The size is read from the open position rather than taken on trust, so a
  // close cannot be sized against a position that has already moved. reduceOnly
  // on the order is the second line of defence, not the first.
  const positions = await ondoPositions(token);
  const open = positions.find(
    (p) => p.market === market && p.direction === "short" && Number(p.netQuantity) > 0,
  );

  if (!open) {
    return NextResponse.json(
      { error: `No open short on ${market}`, reason: "no-position" },
      { status: 409 },
    );
  }

  const requested = isDecimalString(size) ? Number(size) : Number(open.netQuantity);
  const closing = Math.min(requested, Number(open.netQuantity));

  if (!(closing > 0)) {
    return NextResponse.json({ error: "Nothing to close" }, { status: 400 });
  }

  const order = buildCloseHedgeOrder({
    market,
    size: closing === Number(open.netQuantity) ? open.netQuantity : String(closing),
    clientOrderId: hedgeClientOrderId("close"),
  });

  const placed = await ondoPlaceOrder(token, order);

  return NextResponse.json({
    order: placed,
    market,
    size: order.size,
    builderCode: order.builderCode,
    environment: ONDO_ENV,
  });
}

// A trade from the perps surface: either direction, sized in dollars, against
// any market Ondo lists rather than only the ones an xStock routes to.
//
// It shares this route with the hedge actions on purpose. Every order Aeras
// sends is built by lib/ondo/orders.ts and submitted from here, which is the
// only reason the builder code cannot be dropped from one path while the other
// keeps it.
async function placeTrade(
  token: string,
  payload: {
    market?: unknown;
    side?: unknown;
    notionalUsd?: unknown;
    reduceOnly?: unknown;
  },
) {
  const { market, side, notionalUsd, reduceOnly } = payload;

  if (typeof market !== "string" || market.length === 0) {
    return NextResponse.json({ error: "market is required" }, { status: 400 });
  }
  if (side !== "buy" && side !== "sell") {
    return NextResponse.json({ error: 'side must be "buy" or "sell"' }, { status: 400 });
  }
  if (!isDecimalString(notionalUsd)) {
    return NextResponse.json(
      { error: "notionalUsd must be a decimal string above zero" },
      { status: 400 },
    );
  }

  const catalog = await readCatalog();
  const resolved = findMarket(catalog.markets, market);

  if (!resolved) {
    return NextResponse.json(
      { error: `${market} is not an Ondo market`, reason: "market-missing" },
      { status: 409 },
    );
  }
  // A disabled market resolves by name and rejects every order, so this is
  // checked here rather than left to Ondo to explain.
  if (!resolved.tradeable) {
    return NextResponse.json(
      { error: `${market} is not tradeable`, reason: "market-disabled" },
      { status: 409 },
    );
  }
  if (resolved.isClosed) {
    return NextResponse.json(
      {
        error: `${market} is closed. Equities, indices and commodities run different calendars.`,
        reason: "market-closed",
      },
      { status: 409 },
    );
  }

  const sized = computeOrderSize({
    notionalUsd,
    marketPriceUsd: resolved.price,
    baseIncrement: resolved.baseIncrement,
    maxPositionBaseSize: resolved.maxPositionBaseSize,
  });

  if (sized.size === "0") {
    return NextResponse.json(
      {
        error:
          sized.limitedBy === "market-cap"
            ? `${market} caps a position at ${resolved.maxPositionBaseSize} base units.`
            : `That is below one increment of ${market} (${resolved.baseIncrement}).`,
        reason: "too-small",
      },
      { status: 409 },
    );
  }

  // What the account can actually take right now, which is live margin state
  // this route is the first thing to see. A buy reads the bid side, a sell the
  // ask side; the endpoint has no side parameter and returns both.
  const limits = await ondoMaxOrderSize(token, market);
  const allowed =
    side === "sell"
      ? limits.percent100.maxAskBaseSize
      : limits.percent100.maxBidBaseSize;

  const clamped = clampToMaxOrderSize(sized.size, allowed, resolved.baseIncrement);

  if (Number(clamped.size) <= 0) {
    return NextResponse.json(
      {
        error: "Ondo reports no available margin for this order. Post collateral first.",
        reason: "no-margin",
      },
      { status: 409 },
    );
  }

  const order = buildTradeOrder({
    market,
    side,
    size: clamped.size,
    reduceOnly: reduceOnly === true,
    clientOrderId: hedgeClientOrderId("trade"),
  });

  const placed = await ondoPlaceOrder(token, order);

  return NextResponse.json({
    order: placed,
    market,
    size: clamped.size,
    // The achieved notional after rounding and both clamps, not what was asked
    // for. A caller echoing the request back would misreport the position.
    notionalUsd: sized.notionalUsd,
    clampedByMargin: clamped.clamped,
    limitedBy: sized.limitedBy,
    builderCode: order.builderCode,
    environment: ONDO_ENV,
  });
}

async function readCatalog(): Promise<OndoCatalog> {
  const [markets, contracts] = await Promise.all([ondoMarkets(), ondoContracts()]);
  return {
    environment: ONDO_ENV,
    markets: buildCatalog(markets, contracts),
    collateral: collateralAssets(markets),
  };
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
}
