# Ondo Perps

Ondo Perps is an offchain perpetual futures exchange for tokenized equities, indices and
commodities. We use it for one thing in v1: letting a user who is long a tokenized stock open an
offsetting short without selling the stock.

The distinguishing feature versus every other perps venue is that it accepts **Ondo tokenized
equities as margin**, not just stablecoins. That is what makes a self-collateralized hedge
possible: convert the stock into its Ondo form, post it as collateral, short the underlying.

Everything below marked "live-verified" was read from the production API, not from the prose docs.
The prose docs are stale in several places and are called out where they disagree. Readings are
dated: 2026-08-10 for the first pass, 2026-08-25 where they were re-taken. Several changed.

**What changed on 2026-08-25.** Re-verified against the live API while wiring up the builder code:

- **`SPY-USD.P` and `QQQ-USD.P` are enabled.** They carried `disabled: true` in production on
  2026-08-10, which is the single fact that forced SPY and QQQ hedges through the index perps and
  the reason `lib/lighter` became the hedge venue. Both are now live, open, and priced at ETF level.
  Nothing announced the change, which is the lesson: the enabled set is state, not configuration.
- **Collateral gained CRCLon, SPCXon and SNDKon.** Still Ethereum-only, still no Solana path.
- **Fees fell** to 1 bp maker and 2.5 bps taker, from 1.5 and 3.5.
- **The builder code arrived**: `aeras`. It is now configuration, not a blocker.
- **Guide v1.0.5 removed the JWT-embedded builder code.** It goes on every order instead.
- 52 perps markets, 50 enabled, up from 40 and 35.

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
a hedge that was tested only in sandbox. The divergence has widened, not closed:

| | Sandbox (2026-08-25) | Production (2026-08-25) |
|---|---|---|
| Equity collateral symbols | `SPY`, `QQQ`, `GLD`, `SLV`, `CRCL`, `SPCX`, `SNDK` | `SPYon`, `QQQon`, `GLDon`, `SLVon`, `CRCLon`, `SPCXon`, `SNDKon` |
| `SPYon` / `QQQon` | **absent from `tokenConfig`** | present, Ethereum only |
| USDC deposit networks | arbitrum, bsc, ethereum, **solana** | arbitrum, ethereum |
| Disabled contracts | 19, including ARM, AVGO, BABA, TSM | 2: CXMT, IBM |

Consequences worth stating plainly:

- **The self-collateralized hedge cannot be exercised in sandbox at all.** The margin asset it
  depends on is not in sandbox's token config under the name production uses. A `provision_address`
  call with `SPYon` gets `invalid_symbol` there. On 2026-08-10 the same asset existed at a
  *different address*, which was already a trap; now it is a different symbol.
- **The disabled sets are unrelated.** Sandbox disables 19 contracts production does not. In
  August 2026 the direction reversed: production disabled SPY and QQQ while sandbox left them
  enabled, and now production disables almost nothing.
- **Sandbox suggests a Solana deposit path exists.** In production it does not, for any asset.

Never carry a token address, a symbol, or a market's enabled flag from one environment to the other.
Read all three from `/v1/markets` in the environment being used. `scripts/ondo-hedge-check.mts`
asserts against production and diffs sandbox, so a change on either side surfaces as a failed check.

This is why `ONDO_PERPS_ENV` defaults to **production**. It defaulted to sandbox until 2026-08-25,
on the theory that nothing could be traded before a builder code arrived. Both halves of that have
stopped being true.

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

### What the onboarding email was actually for

One thing: the **builder code**. It arrived on 2026-08-25 and it is **`aeras`**. Nothing else in the
onboarding flow lacked an API path.

| Item | Status |
|---|---|
| Public URL | `https://aeras.finance`, verified serving the app 2026-08-17. `aeras-finance.vercel.app` is the same deployment. Needed for the email and for a browser WebSocket, not for REST. |
| Account ID | Self-serve via `GET /v1/account`. Do not ask for it. |
| API keys | Already enabled. Do not ask for them. |
| Fee rate | Set per order, not centrally. See below. |
| Builder code | `aeras`. Configured as `ONDO_BUILDER_CODE`, defaulting to that value in `lib/ondo/constants.ts`. |

CORS allowlisting is only needed for browser-direct calls. We proxy through Next.js route handlers,
so it does not apply to our REST traffic. It would apply to a browser WebSocket connection, which is
the one place the allowlisted URL would actually bite.

## The builder code, and every silent way it earns nothing

This is the revenue side of the integration and **all four of its failure modes are silent**. There
is no error anywhere for any of them. `lib/ondo/builder.ts` exists solely to close them off, and
`scripts/ondo-execution-check.mts` asserts each one.

1. **The JWT flow is gone.** Until guide v1.0.4 the code could be passed at `get_challenge` and
   baked into the JWT, which applied it to every subsequent order automatically. That was the
   recommended path and it is what this document said to do. **Guide v1.0.5 removed it**, and the
   field is gone from `LoginGetChallengeRequest` in the live OpenAPI spec, which now carries only
   `walletAddress` and `chainId`. Code written against the old advice authenticates fine and earns
   nothing. Every order and every position-level stop order must name the code itself.
2. **An unknown code is accepted.** Ondo does not validate that the code exists when the order is
   placed. A typo or an unset env var costs every fill from then on.
3. **A missing `feeRateBpsFractional` is a free fill, not a default one.** There is no centrally
   configured rate per builder code; the guide states this twice. Attribution without a rate earns
   zero.
4. **A rate above the 10 bps cap is not rejected at request validation.** Measured 2026-08-25: a
   25 bps rate passed schema checks and reached the margin check like any valid order. Where the cap
   is enforced instead, if it is, is not documented. Ours refuses above 10.

Two more details on the field itself:

- `feeRateBps`, the integer form, is **deprecated**, and `deprecated_field` is a live rejection code
  on `POST /v1/perps/orders`. Only `feeRateBpsFractional` is ever sent from this codebase.
- **TP/SL attached to an order inherit its builder code. A position-level stop order does not.**
  `POST /v1/perps/stop_order` needs its own `builderCode` block or the eventual triggered close
  earns nothing. This asymmetry is easy to miss.

The rate is `ONDO_BUILDER_FEE_BPS`, **defaulting to 0**: orders carry the code for attribution and
charge the user nothing until a rate is set. It is on top of Ondo's own 2.5 bps taker fee, and both
are charged against the USDC balance, so on a self-collateralized hedge both accrue as debt against
the 30% auto-exchange threshold.

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
| CRCLon | **ethereum only** | added between 2026-08-10 and 2026-08-25 | 18 |
| SPCXon | **ethereum only** | added between 2026-08-10 and 2026-08-25 | 18 |
| SNDKon | **ethereum only** | added between 2026-08-10 and 2026-08-25 | 18 |

### A deposit address is not a collateral check

**Measured 2026-08-25: `POST /v1/provision_address` returns a valid, real deposit address for
TSLAon**, which is not accepted collateral. It only rejects a symbol Ondo has never heard of
(`NOTAREALTOKEN` gets `invalid_symbol`). Ondo's own funding doc says the quiet part directly, about
the cap rather than the asset: holdings above a cap "can be deposited and withdrawn but do not
contribute additional margin". Deposit and credit are separate.

So the gate is `tokenConfig`, and `lib/ondo/collateral.ts` is where it lives. A user who bridges
TSLAon into that perfectly valid address gets a credited balance of zero.

### Only some collateral can be valued before it lands

Ondo prices deposited collateral at "the mark price for the corresponding market on the exchange".
**GLDon and SLVon have no corresponding market.** Ondo lists `XAU-USD.P` and `XAG-USD.P`, spot
metals, not the GLD and SLV ETFs. They are depositable, and `creditedMargin()` returns null for them
rather than guessing, so their credited value is only knowable from the balance after they land.

Denominations do not line up either, and should never be assumed:

| Asset | Implied price | Against | Reads as |
|---|---|---|---|
| SLVon | ~$62.87 | XAG $69.23/oz | ~0.9 oz, a real SLV share |
| GLDon | ~$2,090 | XAU $4,643/oz | ~0.45 oz, **not** a GLD share (~0.09 oz) |
| SNDKon | ~$740 delivered | SNDK marks $1,489 | routes at ~half its mark |

**SNDKon is the live example of why the funding path guards on value.** A $200 USDC route delivers
about $95 of SNDKon. `lib/ondo/fund.ts` refuses past `MAX_FUNDING_LOSS_BPS` (10%), measured against
Ondo's own mark rather than the bridge's USD estimate. The other six route at 0.6% to 6.2%.

### Ondo's docs and Ondo's API disagree about which assets are collateral

The `tokenizedcollateral` overview says **"Supported assets at launch: QQQon and SPYon"**, and
`funding-your-account.md` publishes a haircut and cap for USDC, SPYon and QQQon only. The live
`tokenConfig` carries eight assets.

Every previous disagreement of this shape resolved in the API's favour, and "at launch" is a
point-in-time statement rather than a current list, so the API is probably ahead again. Probably is
not good enough to bridge someone's money on, so the gap is recorded rather than flattened. Each
asset carries a `documented` flag:

| | Assets | Haircut and cap |
|---|---|---|
| `documented: true` | USDC, SPYon, QQQon | Published by Ondo |
| `documented: false` | GLDon, SLVon, CRCLon, SPCXon, SNDKon | **Inferred.** 10% and no cap, assumed from the equity assets |

A funding plan for an undocumented asset carries `collateralUndocumented: true` and the caller has to
surface it. Settling this needs Ondo to confirm, or a small live deposit that shows up in the margin
balance.

### The collateral set is discovered, not hardcoded

Ondo added CRCLon, SPCXon and SNDKon between 2026-08-10 and 2026-08-25 and did not update
`funding-your-account.md`, which still lists three assets. A hardcoded list would have refused
collateral a user holds. `creditableCollateral()` reads `tokenConfig` and derives each asset's
pricing market by the `{TICKER}on` to `{TICKER}-USD.P` rule, verified against the live catalog, so a
collateral type Ondo adds tomorrow works without a code change. The registry supplies only what the
API does not return: haircut, cap, and a label. Anything Ondo lists that the registry has not seen
is surfaced as `known: false`, not silently accepted.

Haircuts and caps are published for **USDC, SPYon and QQQon only**. The other five are assumed to
carry the standard 10% equity haircut with no cap, which is a guess this repo makes visible rather
than hides. Confirm with Ondo before sizing anything against it.

Consequences, all load-bearing:

- **There is no Solana deposit path.** Not for the equity tokens, and not even for USDC. The
  `provision_address` request schema advertises an enum of `ethereum | solana | avalanche`, and the
  integration guide comment says "also supports: solana, avalanche". Both are wrong against the
  live token config. Do not design around a Solana deposit. This is the one place Lighter is
  structurally better: it takes USDC from Solana natively, so it needs no Ethereum leg at all.
- **TSLAon and NVDAon are still not accepted collateral**, even though `TSLA-USD.P` and
  `NVDA-USD.P` are live tradeable markets. The collateral list grew in August 2026 and those two
  were not in the growth.
- **The collateral list is what gates the hedge, not the market list.** Every one of the ten curated
  xStocks has a live perp market. Only SPYx, QQQx, CRCLx and GLDx can post the stock as its own
  margin, and that set is read from `tokenConfig` rather than hardcoded.
- `funding-your-account.md` lists only USDC, SPYon and QQQon. It is three assets short.
- The SPYon and QQQon addresses match `lib/trustware/equivalents.ts` exactly, so the existing
  registry already holds the correct destination tokens on the correct chain. **CRCL and GLD are
  not in that registry**, because it only carries the four underlyings with Jupiter Lend borrow
  vaults. Their hedges resolve and size correctly but cannot be funded until the registry catches
  up.

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

52 contracts, 50 enabled in production. **Live-verified 2026-08-25:**

| Market | Enabled | baseIncrement | maxLeverage | MMR | maxPositionBaseSize | Tag |
|---|---|---|---|---|---|---|
| `SPY-USD.P` | **yes, since 2026-08-25** | 0.01 | 20 | 0.025 | 90 (~$69k) | ETF |
| `QQQ-USD.P` | **yes, since 2026-08-25** | 0.01 | 20 | 0.025 | 100 (~$71k) | ETF |
| `US500-USD.P` | yes | 0.001 | 25 | 0.02 | 50 (~$384k) | Index |
| `US100-USD.P` | yes | 0.0001 | 25 | 0.02 | 1.5 (~$44k) | Index |
| `TSLA-USD.P` | yes | 0.01 | 10 | 0.05 | 100 | Stock |
| `NVDA-USD.P` | yes | 0.01 | 10 | 0.05 | 100 | Stock |
| `AAPL-USD.P` | yes | 0.01 | 20 | 0.025 | 100 | Stock |

**The enabled set is state, not configuration.** On 2026-08-10 production disabled `SPY-USD.P`,
`QQQ-USD.P`, `HYPE-USD.P`, `ONDO-USD.P` and `SOL-USD.P`. On 2026-08-25 it disables `CXMT-USD.P` and
`IBM-USD.P` and nothing else. Every one of those five is back. Nothing announced it, and there is no
changelog for it.

That reversal is why `lib/ondo/hedge.ts` carries **two markets per route**: the exact perp and an
index proxy, resolved against the live catalog at request time. Hardcoding either is wrong. A
disabled market still resolves by name and then rejects every order, so **filter on `tradeable`,
never on "the symbol exists"**.

Every one of the ten curated xStocks now has an exact single-name market. SPYx and QQQx, which
previously had to route through the index perps, are also the two that self-collateralize, so the
awkward case has disappeared for now. `US500-USD.P` and `US100-USD.P` remain as the fallback and
are still asserted live by the check script.

`markets.md` claims 20x on US500 and US100; the live `marginInfo` says 25x. Trust the live value.

Fees are `makerFee: 0.0001` / `takerFee: 0.00025` (1 / 2.5 bps) uniformly, down from 1.5 / 3.5 bps
on 2026-08-10.

Note the ETF markets are capped in **shares**, so their USD ceilings (~$69k SPY, ~$71k QQQ) are
lower than the S&P index proxy's ~$384k despite the larger base-unit number. For a large SPY
holding the proxy still carries more size than the exact market does.

## Order sizing

The highest-risk piece of arithmetic in the integration.

- `size` is denominated in **base units**, never USD notional. For `US500-USD.P` a base unit is one
  index point.
- `quoteSize` is USD-denominated but is **restricted to market buys only**. A hedge is a sell, so
  `quoteSize` is unavailable to us. We must compute base size ourselves.
- The index perps are priced at **index level, not ETF level**, and the multiple is different for
  each one. `US500-USD.P` marks around 7,673 against SPY's 765, a factor of 10.0. `US100-USD.P`
  marks around 29,204 against QQQ's 710, a factor of 41.2.

So sizing a hedge by share count is wrong by 10x on SPY and 41x on QQQ. There is no fixed factor to
apply, which is the point: always go through USD notional.

Now that the exact ETF markets are live, share count and USD notional happen to agree on the SPYx
and QQQx routes, and a share-count implementation would look correct in testing. It would be wrong
again the moment those markets are disabled and the route falls back to the proxy, which is exactly
what the state of the world was two weeks ago. **One code path, sized by notional, for both.**

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

**Both halves of that `min` are real triggers, and they bind in opposite regimes.** Below roughly
$333k of credited collateral the LTV threshold is reached first; above it the flat $100,000 ceiling
is. The difference is not academic: a $2m hedge fully collateralized by SPYon trips auto-exchange at
a **+5% move**, where the LTV branch alone puts it at +37%. Sizing a large hedge against LTV only
would misplace the trigger by 7x for exactly the positions with the most at stake.
`autoExchangePriceMove` takes the nearer of the two, and `autoExchangeTrigger` says which fired.

### Auto-exchange costs 2.5% more on a weekend

If auto-exchange fires between Friday 20:00 ET and Sunday 20:00 ET, or on a US market holiday, a
**closed-market settlement fee of 2.5% of the debt repaid** applies. It is funded by selling that
much more collateral, not charged separately: clearing $1,000 of debt sells $1,025.

For a hedge this is worse than it sounds. A hedge is a short, so it accrues debt precisely when the
market rallies, and the weekend is exactly when the collateral cannot be sold into an open market.
The expensive case and the likely case are the same case. `autoExchangeCostUsd` models it.

### Auto-exchange leaves a positive USDC balance, and positions open

Worth understanding before showing a user their post-trigger state. Auto-exchange clears *net* debt,
so when unrealized losses are contributing it pushes the USDC balance **positive** enough to offset
them rather than back to zero. Positions stay open throughout; auto-exchange is not liquidation and
does not close anything. New orders and withdrawals are blocked while it runs. Users can also
trigger it manually from Ondo's own UI to clear debt proactively.

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

Over the weekend, perp feeds freeze at 16:00 ET Friday and an internal oracle takes over, seeded
from the Friday close and adjusted by impact price difference. Weekend price discovery is bounded to
`Friday close x (1 +/- 1/maxLeverage)`.

**Collateral is not subject to that freeze.** Ondo's weekend-mechanics page states tokenized equity
collateral is marked to market continuously through weekends and holidays, with no price freeze, no
queue and no Monday reconciliation, and that liquidations fire on real-time perp PnL against
real-time collateral marks. So over a weekend the two legs of a self-collateralized hedge are priced
by different mechanisms: the short against a bounded internal oracle, the collateral backing it
continuously. Do not describe the account as frozen over a weekend.

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

1. `POST /v1/auth/erc-4361/login/get_challenge` with `{ walletAddress, chainId: '1' }`.
   Returns `{ id, message }`.
2. `personal_sign` the `message` with the user's EVM wallet, hex-encoded.
3. `POST /v1/auth/erc-4361/login/complete_challenge` with `{ id, signature }`. Returns `{ token }`.
4. `POST /v1/agreement` with `{ termsVersion: 1, privacyVersion: 1 }`, **only when the user
   actually accepts.** See below.

Then `Authorization: Bearer {token}` on everything.

**`builderCode` is no longer accepted at step 1.** It used to be, and passing it there baked it into
the JWT so it applied to every order automatically. Guide v1.0.5 removed the flow and
`LoginGetChallengeRequest` in the live spec now carries only `walletAddress` and `chainId`. Put the
code on each order instead.

Two lifetimes, both measured 2026-08-25 and both load-bearing:

- **The challenge expires 5 minutes after it is issued**, stated inline in the message as
  `Expiration Time`. A user who leaves the signing prompt open past that produces a perfectly valid
  signature over a dead challenge. The fix is a fresh challenge, not a retry.
- **The JWT lives exactly 24 hours** (`exp - iat` = 86400). Our session cookie is capped to the
  same, so it can never present an expired token as a live session.

Step 4 is consent, not configuration. A fresh account sits at `termsVersion: 0`, and balance,
positions, orders, `max_order_size` and deposits **all read fine there**, so nothing forces the call
into the login path. It belongs behind an explicit control with the documents linked.
`POST /v1/agreement` is in the integration guide but **not in the OpenAPI spec**, so treat the
version numbers as something to re-check rather than as a stable contract.

There is also an API-key scheme for server-side use, described below. It is per-builder rather than
per-user, so it does not replace SIWE for anything a user does.

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
| Position-level stop | `GET`/`POST`/`DELETE /v1/perps/stop_order` |
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
| `takeProfit`, `stopLoss` | object with required `triggerPrice`. Inherit the order's `builderCode`. |
| `builderCode` | `{ code, feeRateBpsFractional }`. Fractional bps, capped at 10. `feeRateBps` is deprecated. |

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
4. Short the resolved market, sized by USD notional. `SPY-USD.P` and `QQQ-USD.P` while they are
   enabled, `US500-USD.P` and `US100-USD.P` when they are not.

Reuse from the existing Trustware layer: `lib/trustware/equivalents.ts` already holds both Ethereum
contract addresses, `lib/trustware/execute.ts` already signs Solana-source routes via
`useSignSolanaTxBase64`, and `lib/privy/evm.ts` already exposes the EIP-1193 provider that SIWE
needs. The EVM embedded wallet is the SIWE signer and the deposit owner, so one address covers auth
and custody.

Ondo is a **second venue alongside Lighter**, not a replacement for it. The two have opposite
strengths and both are worth keeping: Ondo pays builder commission and lets the stock margin its own
hedge, and Lighter takes USDC from Solana natively with no Ethereum leg and charges nothing.

### What is built

The execution core, as of 2026-08-25. No UI consumes it yet.

| File | Does |
|---|---|
| `lib/ondo/constants.ts` | Environment, builder code and fee rate, session and challenge lifetimes |
| `lib/ondo/builder.ts` | Builds and guards the `builderCode` block. The whole revenue path |
| `lib/ondo/collateral.ts` | What Ondo credits as margin, discovered live, and what it is worth |
| `lib/ondo/fund.ts` | Converts a Solana holding into margin, delivered to the deposit address |
| `lib/ondo/hedge.ts` | Route table, exact market with proxy fallback, resolved live |
| `lib/ondo/sizing.ts`, `risk.ts`, `preview.ts` | Order sizing, LTV and auto-exchange, unchanged shape |
| `lib/ondo/orders.ts` | The only place a market order is constructed |
| `lib/ondo/server.ts` | Every upstream call, authenticated and not |
| `lib/ondo/session.ts` | The JWT, in an httpOnly cookie, server side only |
| `lib/ondo/auth.ts` | Browser-side SIWE through the Privy embedded EVM wallet |
| `lib/ondo/client.ts` | Browser reads and writes, through our own routes |
| `lib/ondo/exposure.ts` | Holdings joined to Ondo positions, coverage, and the auto-exchange trigger |
| `lib/ondo/use-ondo-hedge.ts` | The hook the hedge surface renders from, plus the four-state session flow |
| `components/OndoHedgeSection.tsx` | The Ondo venue on the hedge tab |
| `lib/ondo/use-perps.ts` | Markets, positions and margin for the perps tab |
| `components/PerpsPanel.tsx` | The perps tab: market picker, chart, ticket, positions |
| `app/api/ondo/*` | `markets`, `auth/challenge`, `auth/session`, `account`, `agreement`, `orders`, `deposit-address`, `leverage`, `history` |

### Adding margin, in one click

Ondo credits two things, both on Ethereum: USDC, and its own tokenized equities. The user holds
neither. They hold USDC on Solana, or SPYx, or USDC on BNB Chain. `lib/ondo/margin-sources.ts` is
the map between the two, and `components/OndoMarginCard.tsx` on the perps tab is the one click.

| The user holds | Becomes | Notes |
|---|---|---|
| USDC, any chain | USDC on Ethereum | No haircut, no cap. The best margin on the venue, so it ranks first. |
| SPYx / QQQx / CRCLx / GLDx | the matching `...on` token | Credited at mark less the haircut. The stock pays for its own position. |
| AAPLx, TSLAx, NVDAx, METAx… | nothing | Ondo credits no collateral token for these, though their markets are live. Not offered at all. |
| SPYon on Ethereum or BNB | SPYon on Ethereum | Already the right asset, wrong chain. |

Which collateral a holding becomes is read through the hedge route table rather than by stripping
suffixes, so there is one place in the repo that decides SPY has a collateral token and AAPL does
not.

**Only Solana sources can be signed today.** They need one signature, no gas and no chain switch,
because the bridge delivers straight to the Ondo deposit address. An EVM source needs an allowance
and a chain switch, which `lib/trustware/execute.ts` owns and `lib/ondo/fund.ts` does not yet call.
Those sources are listed and labelled rather than dropped: telling someone they have nothing when
their money is one chain away is the wrong answer.

Pricing and committing are separate steps. Pressing Add prices the route and returns the bridge fee,
what actually lands, and what it credits after the haircut. Only then is there something to sign,
because $1,000 of SPYon being $900 of margin is the kind of thing that should not be a surprise
after the signature.

### The perps tab

A second surface, added 2026-08-25, and the venue's revenue case: builder commission accrues on
volume, and a trade tab is where volume is. It differs from Hedge in what it assumes rather than in
what it can do. Hedge is organised around holdings, because the decision there is per holding.
Perps assumes no holding at all, so it is a market picker with a ticket beside it, over **every**
tradeable Ondo market rather than the ten an xStock routes to.

`action: "trade"` shares `app/api/ondo/orders/route.ts` with the hedge actions on purpose. Every
order Aeras sends is built by `lib/ondo/orders.ts` and submitted from that one route, which is the
only reason the builder code cannot be dropped from one path while another keeps it.

Sizing enters from the other end: `computeOrderSize` takes USD and returns base units, where
`computeHedgeSize` takes a holding and a ratio. Both round **down** to `baseIncrement`, for related
but distinct reasons: a hedge that rounds up becomes a net short, a trade that rounds up commits
money nobody asked to commit.

Closing a position is a reduce-only market order in the opposite direction, so an oversized close
stops at flat rather than opening the reverse position.

The hedge tab carries a **venue toggle**, Lighter and Ondo, added 2026-08-25.
`components/HedgePanel.tsx` keeps the Lighter body unchanged and renders the Ondo section beside it
rather than behind a shared abstraction. The venues differ in ways worth showing: Lighter takes USDC
margin and has its own candles, Ondo accepts the tokenized stock as margin and carries a second way a
hedge ends. A common component would have to suppress all of that to fit both.

Two things the Ondo section shows that the Lighter one has no concept of: what each holding would
credit as margin if posted, and the **auto-exchange trigger price**, which for a self-collateralized
hedge fires before liquidation and is the number that ends it. Neither is a chart: Ondo's candles are
on a different endpoint with a different symbol format and are not wired up, so the Ondo venue has no
chart or sparklines.

Verified by `scripts/ondo-hedge-check.mts` (catalog, sizing, risk, sandbox divergence),
`scripts/ondo-execution-check.mts` (builder code, SIWE, authenticated reads, order payload) and
`scripts/ondo-collateral-check.mts` (the collateral universe, credited-margin math, the registry
against Ondo's live config, and a priced funding route for every asset). All three run against live
production and none needs a dev server.

Not built: charts on the Ondo venue, position-level stop orders, funding from an EVM source rather
than Solana, and unwinding a hedge back into Solana xStocks. Funding execution is written but gated
off until a live deposit confirms crediting. **The Ondo section has never been rendered in a
browser**; the arithmetic behind it is asserted by the check scripts, the layout is not.

### Open problems

- **Gas on the deposit leg. Resolved 2026-08-25, with one thing still unproven.** Trustware routes
  to Ethereum SPYon and delivers to any address, so `toAddress` is set to the provisioned deposit
  address and the bridge solver performs the destination-side delivery. The user signs once on
  Solana, never holds ETH, and never switches chains. The alternative, delivering into the embedded
  EVM wallet and transferring in, needs a mainnet ERC-20 transfer from a wallet with zero ETH, so a
  native-gas top-up leg and a second signature on the most expensive chain in the system.

  What is still unproven is whether Ondo credits a **bridge-delivered** transfer, where the sender
  is a solver contract rather than the user. Their funding doc says "any transfers to this address
  of a supported asset will be credited" and describes the address as permanent rather than
  per-transfer, which is strong but is not the same as having watched it work. Until one small live
  deposit confirms it, `NEXT_PUBLIC_ONDO_FUNDING_ENABLED` gates execution; planning, pricing and the
  loss guard all run regardless.
- **Round-trip cost.** Trustware's 75 bps integrator fee plus bridge cost, plus the 10% haircut on
  the credited value, plus 2.5 bps taker fee and whatever `ONDO_BUILDER_FEE_BPS` is set to. The
  haircut is not a loss, it is unusable margin, but it means $100 of stock supports less short than
  a naive reading suggests.
- **Basis risk, when the route falls back.** While `SPY-USD.P` and `QQQ-USD.P` are enabled there is
  none: the hedge is the same instrument as the holding. If they are disabled again the route drops
  to the index perps, which track a correlated index on a different trading calendar, and the UI has
  to say so. `previewHedge` reports this as `basisRisk`, computed from the market it actually
  resolved to rather than assumed per ticker. GLDx is a proxy either way: Ondo has no GLD market,
  only spot gold at roughly 11x the share price.
- **Exiting.** Unwinding means closing the short, withdrawing collateral, and bridging back to
  Solana. The first two are built (see Withdrawals below); the bridge home is not.

## Withdrawals

Built 2026-08-26 in `lib/ondo/withdraw.ts`, `app/api/ondo/withdraw`, `app/api/ondo/address-book`
and `components/OndoWithdrawCard.tsx`. Verified live by `scripts/ondo-withdraw-check.mts` (26
checks, green against production). **Assets land on Ethereum. Bringing them to Solana is a separate
bridge leg and is not built.**

Two steps, and only the first needs a signature:

1. `POST /v1/auth/erc-4361/address_book/get_challenge` → `personal_sign` →
   `.../complete_challenge`. A second SIWE flow: holding a valid session is deliberately not enough
   to register a payout address. Off-chain, free, once per address.
2. `POST /v1/withdraw`. **Ondo performs the Ethereum transfer and pays the gas**, which is why this
   leg works from a wallet holding zero ETH.

The withdrawal rules:

```
Withdrawable = max(0, min(Margin Balance - Used Margin, Wallet Balance))
```

Unrealized profit is never withdrawable, unrealized losses reduce the withdrawable amount dollar
for dollar, and a negative USDC balance blocks USDC withdrawals while reducing token withdrawals.
**The haircut does not reduce what you own**, only what it credits. Assets are withdrawn to the
chain they were deposited on, and you withdraw the asset you deposited: $100 of SPYon in does not
come out as $100 of USDC. Ondo's docs say token withdrawals carry no fee and USDC withdrawals may;
`GET /v1/account` returns a single account-level `withdrawalFeeUSD` (1 on 2026-08-26) and does not
say which assets it applies to, so the card shows it as conditional on a token withdrawal rather
than claiming zero.

**Five things measured here that the spec does not tell you:**

- **`withdrawableMargin` is not a token cap, and reading it as one inverts the common case.**
  `walletBalance` is the USDC balance, so an account holding only tokenized collateral has a
  `withdrawableMargin` of **zero** while Ondo's own docs say the full token quantity comes back.
  `withdrawableTokens` applies the documented carve-out first (no positions and no USDC debt means
  everything is withdrawable) and only lets the margin figure bind when there is something for it to
  bind against.
- **There is no per-asset balance endpoint anywhere in the API.** Not on `/v1/perps/balance`, which
  is pooled USD, and nowhere in the full path list. Held quantity is reconstructed from
  `GET /v1/wallet/deposits` minus `GET /v1/wallet/withdrawals`, and cross-checked against Ondo's own
  credited margin value (`marginBalance - walletBalance - unrealizedPnl`, divided back through mark
  and haircut). The smaller of the two is used. **Auto-exchange is why both are needed**: it sells
  collateral with no deposit or withdrawal record, so the ledger alone overstates the holding after
  it fires.
- **`withdrawal_exceeds_chain_deposits` is a real error code and is not in Ondo's published enum.**
  Found by attempting a withdrawal on a burner. It also fires **before** the address-book check, so
  `withdrawal_address_not_found` is only reachable on an account that has actually deposited. Treat
  the error set as open: `describeWithdrawalError` always falls through to the upstream message.
- **The address-book challenge accepts EVM chain ids only** (`"1" | "43114"`). A Solana chain id is
  rejected. That is the second independent reason a withdrawal cannot be pointed at a Solana
  address, the first being that no asset in the token config has a Solana network.
- **`cooldownPeriodSecs` on `GET /v1/account` is a withdrawal-address hold.** Zero on production on
  2026-08-26, but it is state rather than configuration, like the disabled flags, so it is read and
  surfaced rather than assumed.

**The destination is never caller-supplied.** `app/api/ondo/address-book/challenge` takes no request
body at all: the withdrawal address is the wallet that owns the session, read server-side from the
httpOnly cookie. This is the mirror of the guard in `lib/ondo/fund.ts`, where the deposit address
comes from Ondo rather than the caller. An address parameter here would let a compromised page
register an attacker's payout address and drain the account through it, and Ondo's own SIWE step is
not a sufficient defence because the user is approving a prompt that looks routine. The cost is
real and deliberate: **Aeras cannot withdraw to a Ledger or an exchange address.** Ondo's own app
can. Changing that should mean an explicit confirmation flow showing the address, not a new field.

**The gasless deposit trick does not mirror.** `fund.ts` avoids Ethereum gas entirely by pointing
Trustware at Ondo's deposit address. The reverse (pointing Ondo's withdrawal at a Trustware deposit
address, so the bridge picks it up with no wallet involved) does not work: `POST
/api/v1/routes/deposit-address` refuses the Ondo tokens with `Token is not supported for fromChain:
1 fromToken: 0xc9ee…`. Deposit-address routing is squid-only and squid does not carry SPCXon or
SPYon. Measured 2026-08-26.

**The bridge home, for when it is built.** `POST /api/v1/routes/quote` prices Ethereum SPCXon →
Solana SPCXx fine (0.136373 SPCXon → 0.1322 SPCXx, $18.07 out on 2026-08-26), and `/route` returns
one approval against LI.FI's diamond `0x1231DEB6…` plus a transaction. Both need ETH. Ethereum was
at **0.125 gwei** when measured, making approve plus bridge about **$0.14**, and a gas top-up leg
exists the same way the Morpho MON one does: Solana USDC → native ETH quotes at $5 → 0.002 ETH with
$0.09 of fees. So the missing leg is cheap at current gas and expensive at 2021 gas; size the
top-up against a live `eth_gasPrice`, not a constant.

## Gotchas

- Prose docs disagree with the live API on: deposit networks, the collateral asset list, max
  leverage on the index perps, and 24/7 trading. Prefer `GET /v1/markets`.
- **`forbidden_country` on `get_challenge` blocks sign-in at the IP level, and it does not clear
  quickly.** Observed 2026-08-26: three burner accounts created in quick succession from one IP
  succeeded, then every subsequent `get_challenge` was refused with that code, still refused 20+
  minutes later. Measured properties:

  - It refuses **any** address, new or already registered, so it is not an account-creation limit.
  - Unauthenticated reads (`/v1/markets`, `/v1/perps/contracts`) keep working, so the market
    catalog still loads and only authenticated surfaces break.
  - It reaches the app, not just the scripts. `POST /api/ondo/auth/challenge` on a local dev server
    returns it, because the SIWE call is proxied server-side and therefore carries the dev
    machine's IP. Deployed on Vercel the egress IP is different.

  Whether the trigger is really geography or a fraud heuristic that borrows the code is **not
  established**. What is established is that repeated account creation preceded it. **Do not loop
  the check scripts**, and if sign-in starts failing, suspect this before suspecting the code.
- Ondo's published error enum for `/v1/withdraw` is **incomplete**.
  `withdrawal_exceeds_chain_deposits` is real and absent from the spec. Never treat the code list
  as closed.
- **Deposits and withdrawals use different status vocabularies and share no success word.** A
  deposit is `pending | confirmed`. A withdrawal is `complete | failure | pending | cancelled |
  unknown`. There is no such thing as a `complete` deposit, so filtering deposit history on that
  word silently drops every row, and since held quantity is reconstructed from that history the
  result is a user with collateral being told they have nothing to withdraw.
- `disabled: true` markets resolve but reject orders. Filter on the flag. **And the flag changes:**
  the five contracts production disabled in early August 2026, including SPY and QQQ, were all
  enabled again by the 25th.
- **The builder code no longer rides on the JWT.** Guide v1.0.5 removed the `get_challenge` flow.
  Orders written against the old advice authenticate fine and earn nothing.
- An over-cap builder fee rate is **not** rejected when the order is placed. 25 bps reached the
  margin check on 2026-08-25.
- Ondo checks margin **before** reduce-only. A reduce-only close on an account with no margin comes
  back `insufficient_margin`, not `reduce_only_no_open_position`, so error codes are not a reliable
  way to distinguish "no position" from "no funds".
- `size` is base units; `quoteSize` is buy-only. Shorts must be sized manually through mark price.
- Index perps are priced at index level, not ETF level.
- `type` defaults to `limit`.
- `netQuantity` is unsigned. Read `direction` for the sign.
- `history` takes `symbol` in the unhyphenated `XAUUSD.P` form and returns an empty `s: "ok"` for
  the hyphenated one. Use `displayName + ".P"`, and note it skips the response envelope.
- `GET /v1/deposits`, as printed in the integration guide, 404s. It is `GET /v1/wallet/deposits`.
- An unknown `builderCode` is accepted silently on an order. Validate ours before sending, or fills
  go unattributed with no error anywhere.
- `cooldownPeriodSecs` is another undocumented sandbox/production divergence: 25 in sandbox, 0 in
  production. Read it from `GET /v1/account` rather than assuming either.
- Ondo returns rejections as **HTTP 400 with a populated envelope**. Throwing on a non-ok status
  before parsing the body turns every named `error_code` into an opaque 400.
- LTV and the haircut are not returned by any endpoint and must be computed client-side.
- No rate limits are documented anywhere. The only hint is a "wait 2 seconds between polls" comment
  in the integration guide. Ask Ondo before writing a polling loop.
- WebFetch gets 403 from the live API. Use curl with a browser User-Agent when checking by hand.

## Still out of scope

- Limit orders, stop-loss and take-profit. Market orders only. Note that a position-level stop order
  needs its own `builderCode`, since it does not inherit one, so picking this up is also a revenue
  change rather than only a feature.
- SLVon collateral and the XAG / WTI / BRENT markets. GLDon is routed (GLDx against `XAU-USD.P`)
  because it is accepted collateral, but it cannot be funded until `lib/trustware/equivalents.ts`
  carries a GLD entry. Same for CRCLx.
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

This file is reconciled against Builder Integration Guide **v1.0.5** (2026-08-19). The two entries
since v1.0.3 both concern the builder code: v1.0.4 documented `feeRateBpsFractional` and
`builderCode` on position-level stop orders, and v1.0.5 removed the JWT-embedded flow entirely.
Where the guide and the live API disagree, the live reading is the one recorded here and the
disagreement is called out inline.
