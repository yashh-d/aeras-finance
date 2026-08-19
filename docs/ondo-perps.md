# Ondo Perps

Ondo Perps is an offchain perpetual futures exchange for tokenized equities, indices and
commodities. We use it for one thing in v1: letting a user who is long a tokenized stock open an
offsetting short without selling the stock.

The distinguishing feature versus every other perps venue is that it accepts **Ondo tokenized
equities as margin**, not just stablecoins. That is what makes a self-collateralized hedge
possible: convert the stock into its Ondo form, post it as collateral, short the underlying.

Everything below marked "live-verified" was read from the production API on 2026-08-10, not from
the prose docs. The prose docs are stale in several places and are called out where they disagree.

## Environments

| | Sandbox | Production |
|---|---|---|
| REST | `https://api.ondoperps-sandbox.xyz` | `https://api.ondoperps.xyz` |
| WebSocket | `wss://api.ondoperps-sandbox.xyz/ws` | `wss://api.ondoperps.xyz/ws` |
| Frontend | `https://app.ondoperps-sandbox.xyz` | `https://app.ondoperps.xyz` |
| Funds | Demo, no real money | Real deposits |

Endpoints are identical across both. Auth happens on Ethereum mainnet in both.

All responses are wrapped: `{ success, error?, error_code?, deprecated?, result }`. Unwrap `result`
and throw on `success === false`.

### Sandbox is not production with fake money

The two environments are configured differently, and every difference measured so far works against
a hedge that was tested only in sandbox. Verified 2026-08-10:

| | Sandbox | Production |
|---|---|---|
| `SPYon` address | `0x86C75385...` | `0xfedc5f4a...` |
| `QQQon` address | `0xA3D0376F...` | `0x0e397938...` |
| USDC deposit networks | arbitrum, bsc, ethereum, **solana** | arbitrum, ethereum |
| `SPY-USD.P` / `QQQ-USD.P` | **enabled** | disabled |
| Disabled contracts | BB, CBRS, NBIS, SMSN | HYPE, ONDO, SOL, QQQ, SPY |

Consequences worth stating plainly:

- **Collateral addresses differ.** A deposit built against a sandbox address and run in production
  sends tokens to a contract that does not exist on mainnet.
- **A sandbox hedge would route SPYx to `SPY-USD.P` and succeed.** The same code in production gets
  the order rejected. Sandbox teaches the wrong routing.
- **Sandbox suggests a Solana deposit path exists.** In production it does not, for any asset.

Never carry a token address or a market's enabled flag from one environment to the other. Read both
from `/v1/markets` in the environment being used. `scripts/ondo-hedge-check.mts` asserts against
production and diffs sandbox, so a change on either side surfaces as a failed check.

## Getting access

**The API is self-serve. The frontend is not.** This was recorded backwards here until 2026-08-17,
on the assumption that a walled-off login meant a walled-off integration. It does not.

The integration guide opens by telling you to log in at `app.ondoperps-sandbox.xyz` and copy an
account ID. That host is a Vercel deployment with Vercel SSO deployment protection enabled, wired to
Ondo Finance's corporate Okta tenant (`oktaondofinance.okta.com`), so it redirects to an Okta SAML
login for Ondo's internal Vercel team. There is no wallet login and no account to create. Still true,
verified 2026-08-10.

That step is skippable. `scripts/ondo-auth-check.mts` runs the whole SIWE handshake with a freshly
generated burner keypair, no invite code and no builder code, and it passes against **both**
environments. Verified 2026-08-17:

- `get_challenge` answers 200 to any address.
- `complete_challenge` accepts the signature and returns a JWT.
- `GET /v1/account` returns an `accountID` with `accountState: "open"`.
- `disablePerps`, `disableTransfers` and `disableAPIKeyCreation` are all **false** on a brand new
  account, in production as well as sandbox.
- Balance, positions, open orders, `max_order_size` and deposits all read fine with
  `termsVersion: 0`, so `POST /v1/agreement` does not gate reads.

So the account ID is not something to ask Ondo for; it is one signature away. API key management is
not something to have switched on; it is already on. The invite code gates `app.ondoperps.xyz`, the
consumer frontend, which we do not use.

### What the onboarding email is actually for

One thing: the **builder code**. It attributes routed fills to us and it is the only item in the
onboarding flow with no API path. Without it the integration works end to end and earns nothing.

| Item | Status |
|---|---|
| Public URL | `https://aeras.finance`, verified serving the app 2026-08-17. `aeras-finance.vercel.app` is the same deployment. Needed for the email and for a browser WebSocket, not for REST. |
| Account ID | Self-serve via `GET /v1/account`. Do not ask for it. |
| API keys | Already enabled. Do not ask for them. |
| Fee in bps | Integer, capped at 10. Can be omitted from the email and passed per order as `builderCode.feeRateBps`, so it does not have to be decided up front. |
| Builder code | **The only blocker, and it blocks revenue, not development.** |

A wrong builder code does not fail loudly. An unknown one is accepted at `get_challenge` with a 200
and baked into the JWT, so `ONDO_BUILDER_CODE` being empty or stale surfaces as missing attribution
rather than an error. Guard it on our side before sending orders.

Nothing in this repo is blocked on the above. Every read path used by the hedge slice is
unauthenticated, and now the authenticated ones are reachable too.

The builder code is what attributes routed fills back to us. Fees land in our own Ondo Perps margin
account. It can be attached either at auth time on `get_challenge` (recommended: it is then baked
into the JWT and applied to every subsequent order automatically) or per order in the request body.
The integration guide warns the field name may change before v1.

CORS allowlisting is only needed for browser-direct calls. We proxy through Next.js route handlers,
so it does not apply to our REST traffic. It would apply to a browser WebSocket connection, which is
the one place the allowlisted URL would actually bite.

## Collateral: the binding constraint

This is the single most important section. **Live-verified** from `tokenConfig` on
`GET /v1/markets`:

| Symbol | Networks | Contract | Decimals |
|---|---|---|---|
| USDC | ethereum, arbitrum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (eth) | 6 |
| SPYon | **ethereum only** | `0xfedc5f4a6c38211c1338aa411018dfaf26612c08` | 18 |
| QQQon | **ethereum only** | `0x0e397938c1aa0680954093495b70a9f5e2249aba` | 18 |
| GLDon | **ethereum only** | `0x423d42e505e64f99b6e277eb7ed324cc5606f139` | 18 |
| SLVon | **ethereum only** | `0xf3e4872e6a4cf365888d93b6146a2baa7348f1a4` | 18 |

Consequences, all load-bearing:

- **There is no Solana deposit path.** Not for the equity tokens, and not even for USDC. The
  `provision_address` request schema advertises an enum of `ethereum | solana | avalanche`, and the
  integration guide comment says "also supports: solana, avalanche". Both are wrong against the
  live token config. Do not design around a Solana deposit.
- **TSLAon and NVDAon are not accepted collateral**, even though `TSLA-USD.P` and `NVDA-USD.P` are
  live tradeable markets. Only SPY and QQQ of our four Jupiter Lend underlyings can self-collateralize.
- `funding-your-account.md` lists only USDC, SPYon and QQQon. It is missing GLDon and SLVon, which
  pair with the live `XAU-USD.P` and `XAG-USD.P` markets.
- The SPYon and QQQon addresses match `lib/trustware/equivalents.ts` exactly, so the existing
  registry already holds the correct destination tokens on the correct chain.

**Per-account collateral caps:** 146 SPYon, 166 QQQon. Quantity above the cap is credited zero
margin. Compute the USD ceiling from the live mark price at runtime rather than hardcoding it.

**Haircut:** 10% on SPYon and QQQon, 0% on USDC.

```
credited margin (per asset) = quantity x mark price x (1 - haircut)
Non-USDC Margin Value       = sum over assets, each capped at its collateral cap
margin balance              = USDC balance + Non-USDC Margin Value + unrealized PnL + funding
```

The USDC balance may be negative. That is the debt mechanism, described below.

Deposits work by provisioning an address that is permanently bound to the account. Any transfer of
a supported asset to that address is credited. There is no bridge contract and no smart-contract
deposit call, just an ERC-20 transfer.

## Markets

40 contracts, 35 enabled in production. **Live-verified:**

| Market | Enabled | baseIncrement | maxLeverage | MMR | maxPositionBaseSize | Tag |
|---|---|---|---|---|---|---|
| `SPY-USD.P` | **no, `disabled: true`** | 0.01 | 20 | 0.025 | 90 | ETF |
| `QQQ-USD.P` | **no, `disabled: true`** | 0.01 | 20 | 0.025 | 100 | ETF |
| `US500-USD.P` | yes | 0.001 | 25 | 0.02 | 50 | Index |
| `US100-USD.P` | yes | 0.0001 | 25 | 0.02 | 1.5 | Index |
| `TSLA-USD.P` | yes | 0.01 | 10 | 0.05 | 100 | Stock |
| `NVDA-USD.P` | yes | 0.01 | 10 | 0.05 | 100 | Stock |
| `AAPL-USD.P` | yes | 0.01 | 20 | 0.025 | 100 | Stock |

Production disables five contracts: `SPY-USD.P`, `QQQ-USD.P`, `HYPE-USD.P`, `ONDO-USD.P` and
`SOL-USD.P`. Only the first two matter to us, and they are the two that would otherwise be the exact
hedge for our largest ETF holdings. They resolve as symbols but reject orders, so filtering by "does
the symbol exist" is not enough. **Filter on `disabled !== true`.**

The disabled set is not stable and is not the same in sandbox. Do not hardcode it; read it.

So S&P 500 and Nasdaq 100 exposure is reachable only through the index perps, which introduces two
problems covered below: price-scale mismatch and basis risk.

Full enabled set: AAPL, AMD, AMZN, BB, BRENT, BTC, CBRS, COIN, CRCL, DRAM, ETH, EWY, GOOGL, HOOD,
INTC, META, MRVL, MSFT, MSTR, MU, NBIS, NFLX, NVDA, ORCL, PLTR, SKHY, SMSN, SNDK, SPCX, TSLA,
US100, US500, WTI, XAG, XAU. Eight of our ten curated xStocks have an exact single-name match
(AAPL, TSLA, NVDA, META, GOOGL, COIN, CRCL, MSTR). The two that do not, SPYx and QQQx, are exactly
the two that can self-collateralize.

`markets.md` claims 20x on US500 and US100; the live `marginInfo` says 25x. Trust the live value.

Fees are `makerFee: 0.00015` / `takerFee: 0.00035` (1.5 / 3.5 bps) uniformly.

## Order sizing

The highest-risk piece of arithmetic in the integration.

- `size` is denominated in **base units**, never USD notional. For `US500-USD.P` a base unit is one
  index point.
- `quoteSize` is USD-denominated but is **restricted to market buys only**. A hedge is a sell, so
  `quoteSize` is unavailable to us. We must compute base size ourselves.
- The index perps are priced at **index level, not ETF level**, and the multiple is different for
  each one. `US500-USD.P` marks around 7,751 against SPY's 772, a factor of 10.0. `US100-USD.P`
  marks around 29,639 against QQQ's 720, a factor of 41.2.

So sizing a hedge by share count is wrong by 10x on SPY and 41x on QQQ. There is no fixed factor to
apply, which is the point: always go through USD notional.

```
targetNotionalUsd = spyonQuantity x spyMarkPrice x hedgeRatio
size              = roundDownTo(targetNotionalUsd / indexMarkPrice, baseIncrement)
```

Round **down** to `baseIncrement` so the hedge never exceeds the exposure. Note `baseIncrement` for
`US100-USD.P` is 0.0001, which is 4 decimal places, versus 0.001 for `US500-USD.P`.

**`maxPositionBaseSize` on `US100-USD.P` is 1.5**, roughly $44k at current index levels. That is a
hard ceiling on Nasdaq hedge size and it is an order of magnitude tighter than `US500-USD.P`
(50 base units, roughly $388k). It is not documented whether this is per order or per position.
Confirm with Ondo before relying on it.

Use `GET /v1/perps/max_order_size?market=...` to bound the order. It returns
`percent100 / percent75 / percent50 / percent25`, each `{ maxBidBaseSize, maxAskBaseSize }`, in base
units. For a short, read `maxAskBaseSize`. There is no side parameter. The optional `buffer` param
(decimal 0 to 1, default 0.9) scales the result down to absorb drift between quoting and placing.

## Margin, LTV and auto-exchange

Margin is **cross only**. There is no isolated mode. The whole margin balance, USDC plus credited
tokenized collateral, backs every open position at once. A practical consequence worth exploiting:
SPYon or QQQon collateral can back a short on *any* market, including TSLA and NVDA whose own tokens
are not eligible collateral.

Leverage is set per market via `POST /v1/perps/leverage` but collateral stays pooled.

When fees, funding or realized losses exceed the USDC balance, the balance goes negative and becomes
**USDC Debt**:

```
USDC Debt = margin balance - Non-USDC Margin Value
LTV       = abs(USDC Debt) / Non-USDC Margin Value
```

Max debt is `min(Non-USDC Margin Value x 30%, $100,000)`. At **30% LTV the exchange auto-exchanges**,
selling enough collateral to clear the debt entirely. These are stated as beta parameters.

### What this means for a self-collateralized hedge

Post `q` SPYon as the only collateral, no USDC, and short notional `r x q x p0` where `r` is the
hedge ratio. If the price moves up by `x`, collateral appreciates but the short loses, and the loss
becomes debt:

```
LTV(x) = r x / (0.9 (1 + x))
```

Setting that to 0.30 gives the rally that triggers auto-exchange:

| Hedge ratio | Auto-exchange at |
|---|---|
| 100% | +37% |
| 75% | +56% |
| 50% | +117% |

A downward move is safe: the short gains, no debt accrues, LTV stays 0. That is the direction the
hedge exists to protect, so the risk profile is the right way round. But a fully-hedged position is
**not set-and-forget**: a sustained rally erodes it, and fees and funding shift the thresholds
slightly worse than the table. Surface the trigger price in the UI.

### The API does not expose any of this

`GET /v1/perps/balance` returns `walletBalance`, `realizedPnl`, `unrealizedPnl`, `marginBalance`,
`usedMargin`, `availableMargin`, `withdrawableMargin`, `maintenanceMarginRequirement`,
`totalMaintenanceMargin`, `marginRatio`, `leverage`, `underLiquidation`, `totalFundingPayments`,
`totalTradingFees`, `totalPnL`, and optional `netInvested`. All strings, all USDC-denominated.

There is **no `ltv`, `usdcDebt`, `nonUsdcMarginValue`, `collateralValue` or `haircut` field**, on
that endpoint or on `GET /v1/account`. The haircut and LTV model exists only as prose. **We must
compute LTV client-side** from collateral quantity, mark price, and the hardcoded 10% haircut. That
means the haircut is a magic number in our code that will silently go stale if Ondo changes it.
Re-verify it periodically.

Two separate risk systems are in play and must not be conflated:

- `marginRatio = maintenance margin / margin balance`. Hits 100% and the **position** is liquidated.
  Returns 9999 when margin balance is zero or negative.
- `LTV` at 30% and the **collateral** is auto-sold. Not reported by the API.

Consume the server-computed `liquidationPrice` and `bankruptcyPrice` from the positions endpoint
rather than deriving them. There is no documented closed-form formula.

## Trading schedule

`markets.md` says markets are "open 24/7". **This is contradicted by the live API**, which carries an
undocumented `schedule` object per market: `{ timezone: "America/New_York", openHours[7], holidays[] }`,
plus a live `isClosed` boolean.

Two distinct calendars:

- **Equities and ETFs:** open Sunday 20:00 ET, close Friday 20:00 ET, Saturday closed.
- **Indices and commodities:** open Sunday 18:00 ET, close Friday 17:00 ET, with a **daily 17:00 to
  18:00 ET break**.

Our hedge leg (`US500-USD.P` / `US100-USD.P`) and the equity legs therefore run on *different*
schedules. There are windows where one is open and the other is closed. Always read live `isClosed`
before submitting rather than computing from the calendar. Holidays are listed through 2027-01-01
and include half-days.

Over the weekend, feeds freeze at 16:00 ET Friday and an internal oracle takes over, seeded from the
Friday close and adjusted by impact price difference. Weekend price discovery is bounded to
`Friday close x (1 +/- 1/maxLeverage)`.

## Funding

Hourly, 24 times a day, applied on the first tick after each UTC hour boundary. Discrete, not
continuous. Positive rate means longs pay shorts, so a short hedge usually *earns* funding in a
contango market, but do not assume it.

```
payment = position size x oracle price x funding rate
```

60 per-minute premium samples are averaged then divided by 8 (`fundingIntervalDivisions`). Interest
is `0.0003 / 24` per hour. Capped at +/-1% per hour (`fundingRateCap`). If the largest gap between
consecutive samples exceeds 6 minutes, funding for that hour is zero. Funding continues while
markets are closed, using the internal oracle, and Ondo notes it "can be much larger" then; a 0.5x
dampening multiplier applies to equity perps.

Funding is charged against the USDC balance, so on a self-collateralized hedge with no USDC it
accrues as debt and pushes LTV up over time even with a flat price. This is a slow bleed toward the
30% auto-exchange threshold and needs monitoring.

## Auth

SIWE (ERC-4361) on Ethereum mainnet, producing a JWT. Mainnet is required for the signature
regardless of which chain the deposit later lands on.

1. `POST /v1/auth/erc-4361/login/get_challenge` with `{ walletAddress, chainId: '1', builderCode }`.
   Returns `{ id, message }`.
2. `personal_sign` the `message` with the user's EVM wallet, hex-encoded.
3. `POST /v1/auth/erc-4361/login/complete_challenge` with `{ id, signature }`. Returns `{ token }`.
4. First login only: `POST /v1/agreement` with `{ termsVersion: 1, privacyVersion: 1 }`.

Then `Authorization: Bearer {token}` on everything.

Passing `builderCode` at step 1 embeds it in the JWT so it applies to every order automatically.
It moved from `complete_challenge` to `get_challenge` in guide v1.0.3.

There is also an API-key scheme for server-side use: headers `ONDO-KEY-ID`, `ONDO-TIMESTAMP` (ms
epoch, must be within 30 seconds), and `ONDO-SIGN`, a hex SHA256-HMAC over
`timestamp + METHOD + requestPath + body` keyed by the secret. Note some doc pages say
`X-API-KEY-ID`; the authoritative page says `ONDO-KEY-ID`. Keys support up to 16 IPv4 whitelist
entries. This is per-builder, not per-user, so it does not replace SIWE for user actions.

## Endpoint reference

| Purpose | Endpoint |
|---|---|
| Challenge | `POST /v1/auth/erc-4361/login/get_challenge` |
| Complete | `POST /v1/auth/erc-4361/login/complete_challenge` |
| Accept terms | `POST /v1/agreement` |
| Account | `GET /v1/account` |
| Deposit address | `POST /v1/provision_address` |
| Deposits | `GET /v1/wallet/deposits` (the guide says `/v1/deposits`, which 404s) |
| Markets / contracts | `GET /v1/markets`, `GET /v1/perps/contracts` |
| Mark prices | `GET /v1/perps/mark_prices` |
| Balance | `GET /v1/perps/balance` |
| Max order size | `GET /v1/perps/max_order_size?market=&buffer=` |
| Place order | `POST /v1/perps/orders` |
| Get order | `GET /v1/perps/orders/{orderId}` |
| Open orders | `GET /v1/perps/orders?status=open` |
| Cancel | `DELETE /v1/perps/orders/{orderId}` |
| Cancel all | `DELETE /v1/perps/orders?market=` |
| Positions | `GET /v1/perps/positions` |
| Leverage | `GET`/`POST /v1/perps/leverage` |
| Funding rates | `GET /v1/perps/funding_rates`, `/funding_rate_history`, `/funding_fees` |
| Chart history | `GET /v1/perps/history?symbol=&resolution=&to=&countback=` (no auth) |

### Chart history takes a different symbol format, and fails silently

Every other endpoint takes `market`, which is hyphenated: `XAU-USD.P`. `GET /v1/perps/history`
takes `symbol`, which is not: `XAUUSD.P`. **Live-verified 2026-08-17** against production:

```
symbol=XAUUSD.P    {"s":"ok","t":[1787000400,1787001300],"o":[4416.41,4415.94], ...}
symbol=XAU-USD.P   {"s":"ok","t":[],"o":[],"h":[],"l":[],"c":[],"v":[]}
```

The hyphenated form returns `s: "ok"` with empty arrays. It is not an error, so a chart built with
the order-format symbol renders blank instead of throwing, and the bug looks like missing liquidity.
Same result on `NVDA-USD.P` versus `NVDAUSD.P`.

Do not derive the history symbol by string surgery on `market`. Every perps market carries a
`displayName` field, and `displayName + ".P"` is exactly the history symbol. Checked against all 40
markets, zero mismatches. Read it from `GET /v1/markets`.

Note also that this endpoint does not use the `{ success, result }` envelope. It returns a
TradingView-style UDF payload with `s`, `t`, `o`, `h`, `l`, `c`, `v` at the top level, so the shared
`parseResponse` unwrapper does not apply to it.

### Deposit addresses

`POST /v1/provision_address` takes `{ symbol, deposit_destination: { id, wallet: 'margin' }, network }`,
where `id` is the `accountID` from `GET /v1/account`. The address it returns is permanently bound to
the account, so provision once and cache it rather than calling on every deposit. `network` is
`ethereum` for every asset we care about; see the collateral section for why the `solana` enum value
is not real in production.

### Order request

Only `side` and `market` are required.

| Field | Notes |
|---|---|
| `side` | `buy` / `sell` |
| `market` | e.g. `US500-USD.P` |
| `size` | base units, aligned to `baseIncrement` |
| `quoteSize` | quote currency, **market buys only** |
| `price` | limit only, aligned to `quoteIncrement` |
| `type` | `limit` / `market`, defaults `limit` |
| `timeInForce` | `GTC` / `IOC`, defaults `GTC`, not settable on market orders |
| `postOnly`, `reduceOnly` | boolean |
| `clientOrderId` | alphanumeric plus `_` and `-`, max 64 |
| `takeProfit`, `stopLoss` | object with required `triggerPrice` |
| `builderCode` | `{ code, feeRateBps }`, integer bps, capped at 10 |

`type` defaults to **`limit`**, so a market order must set `type: 'market'` explicitly. Omitting
both `type` and `price` is an error, not an implicit market order.

Order status enum: `open`, `fullyfilled`, `canceled`, `pending`, `untriggered`. The `status` *query
filter* accepts only `open`, `canceled`, `fullyfilled`. Cancel accepts either the internal order ID
or `client:{clientOrderId}`.

### Position response

`market`, `direction` (`long` / `short` / `neutral`), `netQuantity` (**unsigned**, sign is carried by
`direction`), `averageEntryPrice`, `usedMargin`, `unrealizedPnl`, `markPrice`, `liquidationPrice`,
`bankruptcyPrice`, `maintenanceMargin`, `notionalValue`, `leverage`, `netFundingSinceNeutral`,
`returnOnEquity`. Optional stop/take trigger prices. There is no realized-PnL field on positions.

Timestamps in query params are UTC **milliseconds**. Paginated reads return
`pageInfo: { nextCursor, prevCursor }`.

## How this maps onto Aeras

The hedge flow, given everything above:

1. User holds SPYx or QQQx on Solana (spot, free balance).
2. Trustware converts it to SPYon or QQQon **on Ethereum**. This is the reverse direction of the
   existing borrow flow, which converts everything *into* Solana xStocks. Same registry tokens, new
   destination.
3. The Ondo tokens land at the provisioned deposit address and are credited as margin at 90% of mark.
4. Short `US500-USD.P` (for SPY) or `US100-USD.P` (for QQQ), sized by USD notional.

Reuse from the existing Trustware layer: `lib/trustware/equivalents.ts` already holds both Ethereum
contract addresses, `lib/trustware/execute.ts` already signs Solana-source routes via
`useSignSolanaTxBase64`, and `lib/privy/evm.ts` already exposes the EIP-1193 provider that SIWE
needs. The EVM embedded wallet is the SIWE signer and the deposit owner, so one address covers auth
and custody.

### Open problems

- **Gas on the deposit leg.** If Trustware delivers SPYon to the user's own EVM wallet, moving it to
  the deposit address is an ERC-20 transfer on Ethereum mainnet and the Privy embedded wallet will
  hold zero ETH. Setting Trustware's `toAddress` directly to the provisioned deposit address avoids
  the problem entirely, since the bridge solver does the destination-side delivery. Confirm with
  Ondo that bridge-delivered tokens are credited normally before relying on it, because a failed
  delivery would strand funds at an address the user does not control.
- **Round-trip cost.** Trustware's 75 bps integrator fee plus bridge cost, plus the 10% haircut on
  the credited value, plus 3.5 bps taker fee. The haircut is not a loss, it is unusable margin, but
  it means $100 of stock supports less short than a naive reading suggests.
- **Basis risk.** SPYx tracks the SPY ETF; the hedge instrument tracks the S&P 500 index. Highly
  correlated but not identical, and they trade on different schedules. Same for QQQ against Nasdaq
  100. The hedge is a proxy, and the UI should say so rather than implying it is exact.
- **Exiting.** Unwinding means closing the short, withdrawing collateral, and bridging back to
  Solana. That path is not designed yet and is a second full round trip of fees.

## Gotchas

- Prose docs disagree with the live API on: deposit networks, the collateral asset list, max
  leverage on the index perps, and 24/7 trading. Prefer `GET /v1/markets`.
- `disabled: true` markets resolve but reject orders. Filter on the flag.
- `size` is base units; `quoteSize` is buy-only. Shorts must be sized manually through mark price.
- Index perps are priced at index level, not ETF level.
- `type` defaults to `limit`.
- `netQuantity` is unsigned. Read `direction` for the sign.
- `history` takes `symbol` in the unhyphenated `XAUUSD.P` form and returns an empty `s: "ok"` for
  the hyphenated one. Use `displayName + ".P"`, and note it skips the response envelope.
- `GET /v1/deposits`, as printed in the integration guide, 404s. It is `GET /v1/wallet/deposits`.
- An unknown `builderCode` is accepted silently at `get_challenge`. Validate ours before sending
  orders, or fills go unattributed with no error anywhere.
- `cooldownPeriodSecs` is another undocumented sandbox/production divergence: 25 in sandbox, 0 in
  production. Read it from `GET /v1/account` rather than assuming either.
- LTV and the haircut are not returned by any endpoint and must be computed client-side.
- No rate limits are documented anywhere. The only hint is a "wait 2 seconds between polls" comment
  in the integration guide. Ask Ondo before writing a polling loop.
- WebFetch gets 403 from the live API. Use curl with a browser User-Agent when checking by hand.

## Out of scope for the first slice

- Limit orders, stop-loss and take-profit. Market orders only.
- The trade tab. Hedging first.
- GLDon and SLVon collateral, and the XAU / XAG / WTI / BRENT markets.
- USDC margin deposits on Arbitrum.
- Unwinding a hedge back into Solana xStocks.
- WebSocket price streaming. Poll `mark_prices` first, add the socket when the UI needs tick-level
  updates. The shape, for when it is picked up: connect to `ONDO_WS_URL`, send
  `{ op: 'subscribe', channel: 'markPricesPerps', markets: [...] }`, and ping every second. That
  ping interval is aggressive enough that it belongs in a hook with a real teardown, not in a
  component effect.
- API-key auth. SIWE covers user actions.

## References

- Docs index: https://docs.ondoperps.xyz/llms.txt
- API reference: https://ondoperps.mintlify.app/
- OpenAPI spec: https://docs.ondoperps.xyz/api-reference/rest-spec.json
- Builder onboarding: builders@ondoperps.xyz
- Live market and token config: `GET https://api.ondoperps.xyz/v1/markets`

This file is reconciled against Builder Integration Guide **v1.0.3** (2026-06-01), whose only
changelog entry is that `builderCode` moved from `complete_challenge` to `get_challenge`. Where the
guide and the live API disagree, the live reading is the one recorded here and the disagreement is
called out inline.
