# Rysk V12

Rysk V12 is an RFQ options protocol. We use it for one thing: letting a user who holds a crypto
major sell an option against it and collect the premium. Two products, both short volatility:

- **Covered call.** Lock the underlying, receive premium, give up the upside above the strike.
- **Cash-secured put.** Lock stables, receive premium, agree to buy the underlying at the strike.

Options are European and **physically settled**, so a position cannot be closed before expiry and
assignment moves the collateral itself rather than paying a cash difference.

Everything below marked live-verified was read from the production API on 2026-08-16, not from
prose docs. There are no prose docs for the taker side. See "No taker documentation" below.

## This is not xStocks

Rysk lists BTC, ETH, SOL, HYPE, PUMP, PURR and XAUT. It does **not** list tokenized equities, and
there is no path to writing an option against an xStock here. This is a different asset class from
the rest of the product and the UI says so. It was shipped anyway as a deliberate scope decision,
not an oversight.

## The taker sells

This is the single most important fact about the integration, and it inverts the usual reading of
an order book.

On Rysk the **market maker quotes and buys**. The **taker sells** and receives the premium. Our
user is the taker. So:

- The price we transact at is the maker's **bid**, never the ask. `lib/rysk/strategy.ts` derives
  every number from `bid` for this reason.
- A request to trade carries `isTakerBuy: false`.
- The premium arrives in the strike asset, which is a stable.

The [ryskV12-cli](https://github.com/rysk-finance/ryskV12-cli) repo is the **maker** client. It is
useful for the EIP-712 type definitions and contract addresses and misleading for everything else.
Do not model our flow on it.

## No taker documentation

Rysk publishes a maker integration guide and nothing for takers. The endpoint map below was
recovered from their own frontend bundle and then confirmed by request. Treat it as observed
behaviour that can change without notice, which is what `scripts/rysk-check.mts` is for.

| Endpoint | Method | Notes |
|---|---|---|
| `/api/assets` | GET | Tradeable tokens keyed by chain id. Only source of decimals, symbols and chain ids. |
| `/api/inventory` | GET | The strike ladder. Refers to tokens by bare address, carries no chain id. |
| `/api/products` | GET | Asset / strike-asset / collateral triples. |
| `/api/otokens` | GET | Deployed option tokens. |
| `/api/expiry-prices/{a}/{b}` | GET | Settlement prices. |
| `/api/taker-history` | GET | Past taker fills. |
| `/api/gas` | POST | Gas quote, part of the trade flow. |
| `/api/requests` | GET | **401.** Advertises `X-Chain-Id`, `X-Nonce`, `X-Signature`. |
| `wss://v12.rysk.finance/taker` | WS | Accepts connections unauthenticated, sends nothing unsolicited. |
| `/ping` | GET | Liveness. |

Base URL is `https://v12.rysk.finance`. Testnet is `wss://rip-testnet.rysk.finance/`.

**Their API sends no `Access-Control-Allow-Origin` header.** The browser cannot read it at all, so
`app/api/rysk/chain/route.ts` is mandatory rather than stylistic. It also joins the two upstream
calls, because inventory alone cannot name a token.

## Chains

Products are live on **Ethereum (1)** and **HyperEVM (999)**. Base appears in `/api/assets` but
every Base asset is flagged inactive and no product references one, so it is not modelled.

Nothing settles on Solana. This is the only part of the product where a position lives off Solana,
which is why it sits behind its own disclosure in the UI.

`/api/inventory` carries no chain id, so the chain a strike settles on is **derived by resolving
its token addresses** against `/api/assets`. That is only sound because no address appears on more
than one chain. The check script asserts it rather than trusting it.

## Data traps

Each of these was hit during the build and each is now encoded in `lib/rysk/constants.ts` and
asserted in `scripts/rysk-check.mts`.

### An absent ask is int64 max, not null

A missing ask arrives as `9223372036.854776`, which is `int64` max divided by 1e9. Rendering it
prints an ask of 9.2 billion next to a $40 bid. It arrives as a float that has already lost
precision, so `isMissingQuote` compares with a tolerance. A bid of `0` also means absent, and is
the common case.

### Contract quantities are e18 regardless of token decimals

WBTC is an 8 decimal token, but its `minTradeSize` is `5e16`, meaning **0.05 contracts**. Scaling a
size by the token's own decimals would size a trade twenty orders of magnitude wrong. `RYSK_CONTRACT_DECIMALS`
is named separately from any token scale for this reason. Underlying prices in `/api/assets` are
likewise 18 decimal USD, unrelated to the token's decimals.

### Four stables are missing from `/api/assets`

Stables back every put and price every strike, but they are not tradeable underlyings, so they
never appear in `/api/assets`. Without the `RYSK_STABLES` table a cash-secured put resolves to an
unknown collateral token and gets dropped.

Symbols for the HyperEVM pair were read from the contracts, not inferred, because the address
prefixes are misleading: `0xb8ce...` is **USD₮0** and `0xb883...` is **USDC**, which is the reverse
of what the prefixes suggest.

### Two expiry schedules, not one

Crypto expires **Friday 08:00 UTC**. XAUT does not: it tracks the **COMEX gold option calendar** and
expires **17:30 UTC on a weekday that moves month to month** (26 Aug 2026 is a Wednesday, 24 Sep
2026 a Thursday).

An early version of the check script asserted a single Friday-08:00 rule and failed, which is how
this was found. Nothing derives an expiry from these constants. The API timestamp is always
authoritative and the UI renders it directly.

### Indicative APY is modelled, not offered

`combination.apy` is present even when both bid and ask are absent, so it is model-derived and not
a rate anyone has committed to.

Where a bid does exist, Rysk's APY and a straight bid-derived yield disagree by a **constant factor
of 0.9206** (measured across all 11 quoted strikes on 2026-08-16, spread 0.0000). The basis for
that factor is not published. Both numbers are shown in the UI, labelled separately, rather than
picking one and implying it is authoritative.

### Collateral convention

A call is collateralised by the **underlying**; a put by the **strike asset**. Getting this
backwards would make a put lock one token instead of strike-worth of stable. Verified across all
401 products.

Calls can also be backed by a liquid staking token that redeems for the underlying: HYPE is
quotable against WHYPE, kHYPE, LHYPE and wstHYPE. That is Rysk's alternative collateral feature,
not four separate markets, which is why `RyskOption.collaterals` is a list.

### An empty ladder is not a market

XRP and ZEC are listed in `/api/inventory` with no combinations at all. They are dropped rather
than rendered as empty tabs.

## What is built

Slice 1 only: **read-only market data**.

```
lib/rysk/constants.ts   Fixed values, sentinels, stable registry
lib/rysk/types.ts       Wire shapes and normalized shapes
lib/rysk/server.ts      Server-only fetches
lib/rysk/catalog.ts     Joins /api/assets and /api/inventory into one chain
lib/rysk/strategy.ts    Seller economics: collateral, premium, yield, assignment
lib/rysk/client.ts      Browser read through our proxy
lib/rysk/use-chain.ts   Polling hook, 30s
app/api/rysk/chain/     The proxy route
components/RyskOptionsPanel.tsx   The Earn card
```

Polling is 30 seconds. Their own client polls inventory every 2 seconds, but we are a third party
reading an endpoint we were not given a rate limit for, and a strike ladder with modelled APYs is
not a live book.

A refresh failure keeps the last good catalog on screen. A ladder thirty seconds stale is still an
accurate picture of what Rysk lists; an empty panel would wrongly read as "no markets".

## What is not built, and why

**Execution is deliberately absent.** Nothing in `lib/rysk` can open a position.

The taker WebSocket accepts unauthenticated connections, but Rysk's own `/rfq` route is
feature-flagged off, and `/api/requests` returns 401 while advertising a signature header scheme we
have no documentation for. Building a trade path on a reverse-engineered signing scheme against
someone's live options protocol is how users lose money.

The next steps, in order:

1. **Contact Rysk.** Confirm the taker flow, the `X-Signature` scheme on `/api/requests`, and
   whether third-party takers are welcome. Blocking.
2. **Trustware to HyperEVM.** The proxy currently hardcodes `toChain must be solana-mainnet-beta`,
   so collateral cannot be routed to HyperEVM. All four funding legs quote live at 0.25%–0.44% on
   $1,000. Also needs HyperEVM added to Privy `supportedChains`.
3. **Taker WebSocket, EIP-712 `Confirmation` signing, ERC-20 approve to MarginPool.** Blocked on 1.
4. **Positions, expiry tracking, settlement.**

Note that step 3 conflicts with the rule in `CLAUDE.md` that EVM code stays confined to three
files. That rule will need revisiting before execution lands.

### EIP-712

Domain is `{ name: "rysk", version: "0.0.0", chainId, verifyingContract }`. Maker types are `Quote`
and `Transfer`; the taker type is `Confirmation`. HyperEVM addresses, from the CLI:

| Contract | Address |
|---|---|
| Rysk | `0x8c8bcb6d2c0e31c5789253ecc8431ca6209b4e35` |
| MarginPool | `0x24a44f1dc25540c62c1196FfC297dFC951C91aB4` |
| MMarket | `0x691a5fc3a81a144e36c6C4fBCa1fC82843c80d0d` |
| StrikeAsset | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` |

## Verification

```
npx tsx scripts/rysk-check.mts
```

No dev server, no credentials, no wallet. Every endpoint is unauthenticated and read-only. The
script asserts address-to-chain uniqueness, token coverage, the collateral convention, contract
scaling, the quote sentinels, both expiry schedules, and the seller economics. Run it before
trusting anything in this file.
