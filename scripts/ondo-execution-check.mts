// Ondo Perps execution-path verification. Everything the read-only hedge check
// does not cover: the SIWE session, the authenticated reads, and the exact
// order payload lib/ondo/orders.ts builds.
//
//   npx tsx scripts/ondo-execution-check.mts
//
// Runs against production with a burner keypair generated here and discarded at
// exit. The burner has no funds, so the two orders it submits are rejected for
// insufficient margin. That rejection is the point: it proves Ondo's validator
// accepted the payload shape, the builder code and the fee field, and got as
// far as the margin check. A schema error would come back as a different code.
//
// Nothing is signed with a real wallet, nothing is deposited and no position
// can open. The one thing this does that ondo-hedge-check.mts does not is
// create an account for a throwaway address, which Ondo does for any address
// that asks.
//
// It stops short of POST /v1/agreement. That accepts Ondo's terms on behalf of
// whoever holds the address, and consent is not something a check script gets
// to give.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  builderCodeBlock,
  builderCommissionEnabled,
  builderFeeUsd,
  assertFeeRateBps,
  OndoBuilderCodeError,
} from "../lib/ondo/builder";
import {
  ONDO_API_BASE_URL,
  ONDO_BUILDER_CODE,
  ONDO_BUILDER_FEE_BPS,
  ONDO_BUILDER_MAX_FEE_BPS,
  ONDO_CHALLENGE_TTL_SECONDS,
  ONDO_ENV,
  ONDO_JWT_TTL_SECONDS,
} from "../lib/ondo/constants";
import { hedgeRouteFor, resolveHedgeRoute } from "../lib/ondo/hedge";
import {
  buildCloseHedgeOrder,
  buildHedgeOrder,
  buildTradeOrder,
  hedgeClientOrderId,
} from "../lib/ondo/orders";
import { liveCollateralHealth } from "../lib/ondo/risk";
import { buildCatalog } from "../lib/ondo/markets";
import { computeOrderSize } from "../lib/ondo/sizing";
import {
  OndoApiError,
  ondoAccount,
  ondoBalance,
  ondoCompleteChallenge,
  ondoContracts,
  ondoGetChallenge,
  ondoHistory,
  ondoMarkets,
  ondoMaxOrderSize,
  ondoPlaceOrder,
  ondoPositions,
} from "../lib/ondo/server";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  pass  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

function note(label: string, value: string) {
  console.log(`        ${label}: ${value}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  console.log(`Ondo Perps execution check  (${ONDO_ENV} -> ${ONDO_API_BASE_URL})`);

  section("1. Builder code configuration");

  // The revenue side fails silently in both directions: an unknown code is
  // accepted with a 200 and earns nothing, and a missing fee rate is a free
  // fill rather than a default one. Nothing upstream will ever tell us.
  const block = builderCodeBlock();
  check("a builder code is configured", block !== undefined, ONDO_BUILDER_CODE || "empty");
  check("the code is the one Ondo issued to Aeras", block?.code === "aeras", block?.code ?? "none");
  note(
    "fee rate",
    ONDO_BUILDER_FEE_BPS > 0
      ? `${ONDO_BUILDER_FEE_BPS} bps, ${builderFeeUsd(10_000).toFixed(2)} USD on a $10k hedge`
      : "0 bps: orders are attributed to us but earn no commission",
  );
  check(
    "commission state matches the configured rate",
    builderCommissionEnabled() === ONDO_BUILDER_FEE_BPS > 0,
  );

  // Ondo does not enforce its own cap at request validation. Measured
  // 2026-08-25: 25 bps passed schema checks and reached the margin check like
  // any valid order. So this guard is the only thing between a misconfigured
  // env var and a rate Ondo may reject or ignore at settlement time.
  let capEnforced = false;
  try {
    assertFeeRateBps(ONDO_BUILDER_MAX_FEE_BPS + 0.1);
  } catch (err) {
    capEnforced = err instanceof OndoBuilderCodeError;
  }
  check(`rates above ${ONDO_BUILDER_MAX_FEE_BPS} bps are refused on our side`, capEnforced);

  check(
    "the deprecated integer fee field is never sent",
    block !== undefined && !("feeRateBps" in block),
    "feeRateBps is deprecated upstream and deprecated_field is a live rejection code",
  );

  section("2. SIWE handshake");

  const account = privateKeyToAccount(generatePrivateKey());
  note("burner address", account.address);

  const challenge = await ondoGetChallenge(account.address);
  check("get_challenge answers without an invite or builder code", Boolean(challenge.message));

  // The builder code used to ride on this call and get baked into the JWT.
  // Guide v1.0.5 removed that flow and the field is gone from the live request
  // schema, which is why lib/ondo/orders.ts attaches it per order instead.
  check(
    "the challenge is scoped to the matching frontend",
    challenge.message.includes(new URL(ONDO_API_BASE_URL).host.replace(/^api\./, "app.")),
  );

  // The message carries its own expiry. Five minutes is short enough that a
  // user who leaves the signing prompt open loses the challenge, so the client
  // re-issues rather than retrying a signature.
  const issued = /Issued At: (\S+)/.exec(challenge.message)?.[1];
  const expires = /Expiration Time: (\S+)/.exec(challenge.message)?.[1];
  const ttl =
    issued && expires ? (Date.parse(expires) - Date.parse(issued)) / 1000 : NaN;
  check(
    `the challenge expires after ${ONDO_CHALLENGE_TTL_SECONDS}s`,
    ttl === ONDO_CHALLENGE_TTL_SECONDS,
    `${ttl}s`,
  );

  const signature = await account.signMessage({ message: challenge.message });
  const { token } = await ondoCompleteChallenge(challenge.id, signature);
  check("complete_challenge returns a session token", token.length > 0);

  // The cookie in lib/ondo/session.ts is capped to this. A longer one would
  // present an expired token as a live session.
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
  ) as { exp?: number; iat?: number };
  const lifetime = (claims.exp ?? 0) - (claims.iat ?? 0);
  check(
    `the token lives ${ONDO_JWT_TTL_SECONDS}s, matching the session cookie`,
    lifetime === ONDO_JWT_TTL_SECONDS,
    `${lifetime}s`,
  );

  section("3. Authenticated reads, before any terms acceptance");

  const acct = await ondoAccount(token);
  check("account opens immediately", acct.accountState === "open", acct.accountID);
  check("perps are enabled on a fresh account", acct.disabledFunctionality?.disablePerps === false);
  check(
    "reads work at termsVersion 0",
    acct.termsVersion === 0,
    "so accepting terms stays an explicit user action rather than a login step",
  );

  const balance = await ondoBalance(token);
  const positions = await ondoPositions(token);
  check("balance and positions read", typeof balance.marginBalance === "string" && Array.isArray(positions));

  // The number Ondo does not return. On an empty account it is zero rather
  // than undefined, which is the safe reading: no collateral, nothing to sell.
  const health = liveCollateralHealth(balance);
  check("collateral health is derivable from the balance", health.ltv === 0,
    `non-USDC margin ${health.nonUsdcMarginValueUsd}, debt ${health.usdcDebtUsd}`);

  section("4. The order payload, as lib/ondo/orders.ts builds it");

  const [markets, contracts] = await Promise.all([ondoMarkets(), ondoContracts()]);
  const catalog = buildCatalog(markets, contracts);

  const route = hedgeRouteFor("SPYx");
  const resolved = route ? resolveHedgeRoute(route, catalog) : undefined;
  if (!resolved) {
    check("SPYx resolves to a tradeable market", false);
    return finish();
  }
  note("resolved market", `${resolved.market.market} (${resolved.match})`);

  const order = buildHedgeOrder({
    market: resolved.market.market,
    size: resolved.market.baseIncrement,
    clientOrderId: hedgeClientOrderId("open"),
  });

  // Three ways a market order goes wrong, all of them quiet. `type` defaults to
  // limit, so omitting it sends a limit order with no price. timeInForce is
  // rejected outright on market orders. quoteSize is the USD-denominated field
  // and it is buy-only, so a short has to be sized in base units first.
  check("the hedge is a market sell", order.type === "market" && order.side === "sell");
  check("no timeInForce is set on a market order", order.timeInForce === undefined);
  check("no price is set on a market order", order.price === undefined);
  check("the builder code rides on the order", order.builderCode?.code === ONDO_BUILDER_CODE);
  check(
    "the client order id identifies our flow",
    /^aeras-open-/.test(order.clientOrderId ?? ""),
    order.clientOrderId,
  );

  const close = buildCloseHedgeOrder({ market: resolved.market.market, size: "1" });
  check("closing is a reduce-only buy", close.side === "buy" && close.reduceOnly === true,
    "without reduceOnly an oversized close flips the user long the perp");
  check("the close carries the builder code too", close.builderCode?.code === ONDO_BUILDER_CODE,
    "a stop order does not inherit it from the opening order either");

  section("5. Ondo accepts the payload and stops at the margin check");

  // The burner has no margin, so this cannot open a position. What it proves is
  // that everything before the margin check passed: the market, the field
  // combination, the builder code and the fractional fee rate.
  const rejection = await expectRejection(() => ondoPlaceOrder(token, order));
  check(
    "the order reaches the margin check rather than a schema error",
    rejection?.code === "insufficient_margin",
    rejection ? `${rejection.code}` : "the order was NOT rejected, which should be impossible on an empty account",
  );

  // A close against nothing must never open anything. Which reason comes back
  // depends on the order Ondo runs its checks in, and on an empty account
  // margin is evaluated first: measured 2026-08-25, this answers
  // insufficient_margin rather than reduce_only_no_open_position. Both are
  // refusals, so the assertion is that it is refused for a known reason. An
  // unrecognised code here would mean the payload itself stopped parsing.
  const closeRejection = await expectRejection(() =>
    ondoPlaceOrder(token, buildCloseHedgeOrder({
      market: resolved.market.market,
      size: resolved.market.baseIncrement,
    })),
  );
  check(
    "a reduce-only close with no position is refused",
    closeRejection?.code === "reduce_only_no_open_position" ||
      closeRejection?.code === "insufficient_margin",
    closeRejection?.code ?? "not rejected, which should be impossible",
  );

  section("6. The perps trade path");

  // Sized in dollars rather than from a holding, and allowed either direction.
  const trade = buildTradeOrder({
    market: resolved.market.market,
    side: "buy",
    size: resolved.market.baseIncrement,
    clientOrderId: hedgeClientOrderId("trade"),
  });
  check("a trade carries the builder code too", trade.builderCode?.code === ONDO_BUILDER_CODE,
    "every order Aeras sends is built in lib/ondo/orders.ts for exactly this reason");
  check("a trade can be a buy", trade.side === "buy" && trade.type === "market");
  check("a trade is not reduce-only unless asked", trade.reduceOnly !== true);

  const closing = buildTradeOrder({
    market: resolved.market.market,
    side: "sell",
    size: resolved.market.baseIncrement,
    reduceOnly: true,
  });
  check("closing a long is a reduce-only sell",
    closing.side === "sell" && closing.reduceOnly === true);

  // Dollar sizing rounds down to the increment, the same direction the hedge
  // sizer rounds, so a trade is never larger than what was asked for.
  const sized = computeOrderSize({
    notionalUsd: "1000",
    marketPriceUsd: resolved.market.price,
    baseIncrement: resolved.market.baseIncrement,
    maxPositionBaseSize: resolved.market.maxPositionBaseSize,
  });
  check("dollar sizing never rounds up",
    Number(sized.notionalUsd) <= 1000,
    `$1,000 requested -> ${sized.size} base = $${Number(sized.notionalUsd).toFixed(2)}`);
  check("dollar sizing lands on the market increment",
    Number(sized.size) % Number(resolved.market.baseIncrement) < 1e-9,
    `increment ${resolved.market.baseIncrement}`);

  section("7. Chart history, and the symbol format that fails silently");

  // The trap: the hyphenated symbol every other endpoint takes returns s:"ok"
  // with empty arrays here, so a chart built from it renders blank and reads as
  // an illiquid market rather than as a bad request.
  const correct = await ondoHistory(
    `${resolved.market.displayName}.P`,
    "15",
    Math.floor(Date.now() / 1000),
    5,
  );
  check(
    "displayName + \".P\" returns candles",
    correct.s === "ok" && (correct.t?.length ?? 0) > 0,
    `${correct.t?.length ?? 0} bars for ${resolved.market.displayName}.P`,
  );

  const wrong = await ondoHistory(
    resolved.market.market,
    "15",
    Math.floor(Date.now() / 1000),
    5,
  );
  check(
    "the order symbol returns an empty series, not an error",
    wrong.s === "ok" && (wrong.t?.length ?? 0) === 0,
    `${resolved.market.market} -> s:"${wrong.s}", ${wrong.t?.length ?? 0} bars`,
  );

  section("8. Order sizing limits");

  const limits = await ondoMaxOrderSize(token, resolved.market.market);
  check(
    "max_order_size answers for an account with no margin",
    typeof limits.percent100.maxAskBaseSize === "string",
    `maxAsk ${limits.percent100.maxAskBaseSize}, maxBid ${limits.percent100.maxBidBaseSize}`,
  );
  check(
    "an unfunded account can short nothing",
    Number(limits.percent100.maxAskBaseSize) === 0,
    "so the order route refuses before sending rather than after",
  );

  finish();
}

// Ondo returns 400 with a named error_code in the envelope, so a rejection is
// read from the body rather than inferred from the status.
async function expectRejection(
  call: () => Promise<unknown>,
): Promise<OndoApiError | undefined> {
  try {
    await call();
    return undefined;
  } catch (err) {
    if (err instanceof OndoApiError) return err;
    throw err;
  }
}

function finish() {
  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
