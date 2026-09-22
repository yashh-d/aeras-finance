# Uniswap liquidity pools: build plan

Uniswap v3 and v4 liquidity pools as the seventh Earn venue that settles off
Solana: the tokenized-stock pools on Robinhood Chain, the deepest pools on
Monad, and one USDC/WETH pool each on Ethereum and Base, funded in one press
from the user's Solana USDC through Trustware and the Privy embedded EVM
wallet, with fees claimable, a way out, and a way home. This file is the plan,
the record of what was verified while writing it (2026-09-21 and 2026-09-22),
and the operating rules for building it without the product owner in the loop.

Read CLAUDE.md first. Then `docs/shmonad-plan.md` and `lib/shmonad/`, because
this venue is that one's shape (a card under the Vaults table, Trustware legs
from Solana USDC, the embedded EVM wallet signing) pointed at a position that
is two tokens rather than one, and `lib/morpho/fund.ts`, whose funding
machinery every leg here reuses. Every decision below that is not stated is
"do what shMON did".

## Summary

- **What the user sees.** A "Liquidity pools" card in the Earn tab under the
  Vaults table, grouped by chain: five tokenized-stock and gold pools on
  Robinhood Chain quoted in USDG, five pools on Monad, USDC/WETH on Ethereum,
  WETH/USDC on Base. Each row shows the pair, the fee tier, TVL, 24h volume,
  the pool's 7-day fee APR, and the user's position. An expanded row shows the
  price, the range a new position would take, a deposit form in Solana USDC,
  and every open position in that pool with its value, its in-range state, its
  uncollected fees and its actions: Claim fees, Withdraw, Reopen (when out of
  range), Move to Solana.
- **The one click.** Enter USDC, press Deposit. The app delivers the two
  tokens the pool needs to the embedded EVM wallet on that chain (one or two
  Trustware legs from Solana, plus a gas leg when the wallet has none, plus an
  on-chain swap for a token no bridge delivers), then grants the approvals and
  mints the position through Uniswap's Liquidity Provisioning API, which
  returns the calldata. Every signature is silent because `showWalletUIs` is
  off. The position is an NFT in the embedded EVM wallet.
- **What it is not.** Not a Vaults column, not a Buy + Earn option, not a
  USDC deposit: an LP position holds two tokens, its value moves with both,
  it suffers impermanent loss against holding them, and its "APY" is a
  trailing fee rate that changes daily. The card says all of that in the
  numbers it shows and in one paragraph, and shows the pool's fee rate as
  "7d fee APR", never as "APY".

## Goals

1. A user holding only Solana USDC can open a concentrated position in any
   listed pool with one press and no wallet UI, on any of the four chains.
2. Every position the app opened is shown with its live value, range state
   and fees, and every exit the protocol offers is offered: claim, withdraw
   (to the wallet), reopen around the current price, and a route home for
   each token.
3. Pool figures come from the pool's own data (TVL and volume from Uniswap's
   indexer, price and liquidity from the chain), keyless, cached, with a
   stale-serve path.
4. `scripts/uniswap-check.mts` proves the registry against every chain, the
   metrics sources, every Trustware leg, and the LP API when a key is set;
   `lib/uniswap/math.test.ts` pins the tick, amount and fee math to figures
   read live and recorded here.

## Non-goals (do not build)

- Increasing an existing position (`/lp/increase`). A second deposit opens a
  second position around the current price. One deposit, one NFT.
- Hooked pools. Three of the Robinhood links (AI/NVDA, ETH/STANDARD,
  WETH/STATICS) carry third-party hooks, and their non-stable sides are
  memecoins. The LP API calls hook compatibility "the caller's
  responsibility"; nothing here takes it on.
- v2 pools, full-range positions as an option, a range picker, automated
  rebalancing. One band per pool, stated on the card; reopening is the user's
  press.
- A Vaults column, a Buy + Earn venue option, a Trader-mode tier descriptor
  (that grid's page wiring is not committed yet; a descriptor is the two-file
  follow-up `lib/trader/earn-venues.ts` documents).
- Gas sponsorship, Permit2 signatures as typed data (approvals run as
  transactions in this build; see D7), the Uniswap swap API (same-chain
  swaps go through Trustware, which the app already signs).
- The two dust Monad pools (WBTC/USDC at $45k, AUSD/XAUt0 at $23k) and the
  duplicate USDG/META link.

## Facts verified 2026-09-21 and 2026-09-22

Read live from each chain's public node, Uniswap's interface GraphQL
(`interface.gateway.uniswap.org/v1/graphql`, with an `Origin` header),
GeckoTerminal, Trustware's API with the configured key, and the Uniswap
developer docs. Pin every number in code to a comment carrying its date; the
check script re-reads all of them.

### The pools

Fee and tick spacing are what the chain says (`fee()` and `tickSpacing()` on
v3, `PositionManager.poolKeys` on v4), and the v4 pool ids recompute from
those keys. **The SPY/USDG and META/USDG v4 pools charge 3000 pips (0.30%)**;
Uniswap's explorer shows 0.3499% for both, which is not what `lpFee` in
`getSlot0` returns. Volume and TVL are the explorer's on 2026-09-21; the fee
APR is 7-day volume times the LP fee, annualised, over TVL.

| Chain | Pair (token0 / token1) | Ver | Fee | Spacing | TVL | 7d fee APR |
|---|---|---|---|---|---|---|
| Robinhood 4663 | USDG / NVDA `0xd4EB2120…` | v3 | 500 | 10 | $6.2M | ~60% |
| Robinhood 4663 | SPY / USDG `0xfe2a80bb…` | v4 | 3000 | 60 | $5.0M | ~52% |
| Robinhood 4663 | USDG / META `0x5875d407…` | v4 | 3000 | 60 | $3.7M | ~190% |
| Robinhood 4663 | SPCX / USDG `0xc6128433…` | v3 | 500 | 10 | $2.7M | ~120% |
| Robinhood 4663 | USDG / GLD `0x7A6A053e…` | v3 | 3000 | 60 | $3.7M | ~32% |
| Monad 143 | USDC / WETH `0xad408916…` | v4 | 500 | 10 | $1.8M | ~32% |
| Monad 143 | MON / USDC `0x18a9fc87…` | v4 | 500 | 10 | $2.1M | ~18% |
| Monad 143 | MON / WETH `0x3783b51e…` | v4 | 500 | **1** | $2.0M | ~18% |
| Monad 143 | MON / WBTC `0x1c93dd2f…` | v4 | 500 | **1** | $1.8M | ~17% |
| Monad 143 | USDC / cbBTC `0x7fc6232a…` | v4 | 500 | 10 | $1.0M | ~25% |
| Ethereum 1 | USDC / WETH `0x88e6A0c2…` | v3 | 500 | 10 | $104M | ~16% |
| Base 8453 | WETH / USDC `0x6c561B44…` | v3 | 3000 | 60 | $153M | ~59% (8% over 24h) |

Every listed v4 pool has the zero hook. On Monad, MON is `currency0` as the
zero address in three pools: the position holds native MON and a mint carries
`value`.

### Tokens

| Token | Chain | Address | Decimals |
|---|---|---|---|
| USDG (Paxos Global Dollar) | 4663 | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| NVDA | 4663 | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | 18 |
| SPY | 4663 | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | 18 |
| META | 4663 | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` | 18 |
| SPCX | 4663 | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` | 18 |
| GLD | 4663 | `0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e` | 18 |
| WETH | 4663 | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | 18 |
| USDC | 143 | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 |
| WETH | 143 | `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` | 18 |
| WBTC | 143 | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` | 8 |
| cbBTC | 143 | `0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b` | 8 |
| USDC / WETH | 1 | `0xA0b86991…eB48` / `0xC02aaA39…6Cc2` | 6 / 18 |
| WETH / USDC | 8453 | `0x42000000…0006` / `0x833589fC…2913` | 18 / 6 |

Robinhood's stock tokens are plain 18-decimal ERC-20s (Robinhood's own
description: economic exposure to an ETP, a debt instrument, no shareholder
rights). The stable in every stock pool is USDG, not USDC; USDC on 4663 is a
bridged `USDC.e` that no listed pool uses.

### Chains

- **Robinhood Chain**: chain id 4663, Arbitrum Orbit, ETH gas, mainnet since
  2026-07-01, ~100ms blocks. viem 2.55.8 ships `robinhood`. Public RPC
  `https://rpc.mainnet.chain.robinhood.com` (rate-limited); Alchemy serves it.
  Explorers: robin.etherscan.io, robinhoodchain.blockscout.com. Not in
  Privy's `supportedChains` yet (D9).
- **Uniswap contracts**, from the developer docs. v4 Robinhood: PoolManager
  `0x8366a39cc670b4001a1121b8f6a443a643e40951`, PositionManager
  `0x58daec3116aae6d93017baaea7749052e8a04fa7`, StateView
  `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b`. v4 Monad: PoolManager
  `0x188d586ddcf52439676ca21a244753fa19f9ea8e`, PositionManager
  `0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016`, StateView
  `0x77395f3b2e73ae90843717371294fa97cc419d64`. v3 NonfungiblePositionManager:
  Robinhood `0x73991a25c818bf1f1128deaab1492d45638de0d3`, Monad
  `0x7197e214c0b767cfb76fb734ab638e2c192f4e53`, Ethereum
  `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`, Base
  `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1`. Permit2 is
  `0x000000000022D473030F116dDEE9F6B43aC78BA3` everywhere.

### Trustware

Chain 4663 is listed and enabled (providers lifi and relay; relay's own
deposit path also lists it). Quotes on 2026-09-21, dummy addresses, nothing
signed:

| Leg | Result |
|---|---|
| Solana USDC 25 → Robinhood USDG | lifi, 24.88 USDG, fees $0.07 |
| Solana USDC 25 → Robinhood WETH | lifi, 0.00903 WETH, fees $0.16 |
| Solana USDC → Robinhood **native ETH** | **502** from Trustware's gateway, both spellings, four attempts. Not a route verdict; the same shape works to Monad and Base. Slice 0 retests. |
| Solana USDC 25 → Robinhood NVDA | no route: squid (chain unsupported), relay (unsupported currency), khalani, lifi all decline. **Stock tokens are bought on-chain.** |
| Robinhood USDG 12 → Robinhood NVDA (same chain) | lifi, 0.0526 NVDA, fees $0.12 |
| Robinhood USDG 2 → Robinhood native ETH (same chain) | relay, 0.00073 ETH, fees $0.006 (needs gas to sign, so not a first leg) |
| Robinhood USDG 25 → Solana USDC | lifi, 24.66 USDC, fees $0.16 |
| Robinhood NVDA 0.1 → Solana USDC | lifi, 22.22 USDC min, fees $0.24 |
| Monad USDC 25 → Robinhood USDG | lifi, 24.90 USDG |
| Solana USDC 25 → Monad WETH | lifi, 0.00898 WETH min, fees $0.11 |
| Base ETH 0.001 → Robinhood ETH | lifi (for the record; the wallet holds no Base ETH) |

Not yet quoted: Solana USDC → Monad WBTC and cbBTC, Monad WETH/WBTC/cbBTC →
Solana USDC, the Ethereum and Base legs (Ethereum USDC and ETH are in
`SWAP_TOKENS` and the ETH gas leg is `lib/trustware/eth-gas.ts`; Base USDC is
the Glider deposit's token and Base ETH the `base-gas` shape), and the
allowance proxy on 4663. Slice 0 quotes them all.

### Uniswap Liquidity Provisioning API

`https://liquidity.api.uniswap.org/lp/{check_approval,create,create_classic,
increase,decrease,claim_fees,pool_info}`, POST, `x-api-key` server-side, free
on the Uniswap Developer Platform. Returns a `TransactionRequest` (`to`,
`data`, `value`, `chainId`, optional gas fields) "ready for signing", with a
deadline encoded and a 30-second refresh recommended. `/lp/create` takes
`existingPool.poolReference` (pool address on v3, pool id on v4), one
`independentToken` amount and either `priceBounds` or `tickBounds`, and
returns both token amounts, the adjusted ticks and the transaction.
`/lp/decrease` takes `liquidityPercentageToDecrease` (v3 collects fees in the
same call); `/lp/claim_fees` takes `tokenId`. `/lp/check_approval` returns
approval transactions, or a Permit2 batch permit as EIP-712 data, or that
permit as a transaction when `generatePermitAsTransaction` is true. The LP
endpoints' chain list is unpublished; the swap API lists 4663 and 143, and
Uniswap's launch post says the API supported Robinhood Chain from day one.
Native ETH is the zero address in requests.

### Position and metric reads

- Uniswap's interface GraphQL answers `v3Pool` and `v4Pool` (TVL, day and
  week volume, tokens, fee tier, hook) keyless with an `Origin` header; it
  refuses introspection and blocks Python's TLS fingerprint, not curl or
  Node. Undocumented, so treated like the Nasdaq site API the Terminal uses.
- GeckoTerminal (`api.geckoterminal.com/api/v2/networks/{robinhood,monad}/
  pools/{id}`) serves reserve and 24h volume for both chains, v4 pools by
  pool id, keyless at about 30 requests a minute. The fallback source.
- Uniswap's `ListPositions` endpoint answers 200 keyless; its coverage of
  4663 and 143 is unproven. Not relied on (D8).
- On-chain: v3 positions enumerate (`balanceOf`, `tokenOfOwnerByIndex`,
  `positions`) and `collect` simulated from the owner returns the fees owed.
  v4 positions do not enumerate; `getPoolAndPositionInfo(tokenId)`,
  `getPositionLiquidity(tokenId)`, `StateView.getFeeGrowthInside` and
  `StateView.getPositionInfo(poolId, PositionManager, tickLower, tickUpper,
  bytes32(tokenId))` give everything else.

Not verified, and must be before the venue is shown to anyone:

- The native ETH gas leg to Robinhood Chain (the 502 above).
- That the LP API serves chains 4663 and 143 (needs `UNISWAP_API_KEY`).
- The write path end to end: nothing has been signed. Gas per operation is
  unmeasured on every chain.

## Decisions

**D1. A card, not a table column.** `components/UniswapPoolsCard.tsx` mounts
in `components/EarnPanel.tsx` under the Vaults/Looping row, below the shMON
card, above `RyskOptionsCard`. The page header's "Four ways to earn yield"
becomes five (liquidity pools). Reason: the position is two tokens with
impermanent loss, and the rate is a trailing fee rate; neither fits a
USDC-keyed row.

**D2. Twelve pools, listed in `lib/uniswap/pools.ts`**: the five Robinhood
stock and gold pools, the five Monad pools with real depth, Ethereum
USDC/WETH, Base WETH/USDC (the table above). The three hooked Robinhood pools
and the two dust Monad pools are recorded here as excluded, with the reason.

**D3. One symmetric band per pool, ±10% in price, aligned to the tick
spacing.** A geometric band `[P/(1+b), P(1+b)]` around the current price is
exactly 50/50 by value at the centre, so a deposit is sized as half and half
and the maths is one identity rather than a solver. Ticks are
`tick ∓ round(ln(1+b)/ln(1.0001))` (953 for 10%), the lower rounded down and
the upper rounded up to the spacing, so the band is never narrower than
asked. `BAND_BPS` is one constant in `lib/uniswap/constants.ts`; per-pool
overrides live on the registry entry and none is set. The card states the
band and, on every position, whether the price is inside it.

**D4. The rate shown is the pool's 7-day fee APR, labelled so.** Volume over
seven days times the LP fee, annualised, over TVL; the 24h figure is the
hint under it. This is the pool's average, gross of impermanent loss; a ±10%
position earns more than the average while in range and nothing outside it,
and the card says so in one sentence rather than modelling it. Never "APY".

**D5. Calldata comes from Uniswap's LP API through our proxy.**
`app/api/uniswap/lp` verifies the Privy token, pins `walletAddress` to the
identity's embedded EVM wallet, admits only pools in the registry and the
five operations the venue uses, forwards with `UNISWAP_API_KEY`, and returns
the response. If Slice 0 finds the API does not serve 4663 or 143, the
contingency is building the same calldata with `@uniswap/v3-sdk` and
`@uniswap/v4-sdk` behind the same proxy shape; nothing client-side changes.

**D6. Funding is the Morpho machinery, chain by chain, from Solana USDC.**
Every token in the registry carries how it is obtained: `bridge` (a
Trustware leg from Solana USDC delivers it, in parallel with the others) or
`swap` (the chain's dollar token is delivered and half is swapped on-chain
through Trustware's same-chain route, signed with the EVM wallet). Stock
tokens are `swap`; everything else is `bridge` until the check script says
otherwise. Gas: Monad reuses the existing 0.5 USDC native-MON leg and
`GAS_FLOOR_WEI`; Robinhood gets its own native-ETH leg sized like it (cheap
chain, fixed top-up); Ethereum reuses `planEthGas` with this venue's gas
budget; Base reuses the `base-gas` shape. Every plan is made from a fresh
balance read, so a retry never re-buys what already arrived, and the mint
is sized from what the wallet actually holds after the legs settle.

**D7. Approvals run as transactions.** `/lp/check_approval` is called with
`generatePermitAsTransaction: true`, so a v4 Permit2 batch permit arrives as
a transaction rather than typed data to sign, and one signing path covers v3
and v4. This costs one extra transaction on a v4 first deposit per token.
Typed-data permits are a follow-up.

**D8. Positions are recorded from receipts, server-side.** After a mint the
client POSTs `{chainId, txHash}` to `app/api/uniswap/positions`; the server
reads the receipt on its own RPC, finds the ERC-721 `Transfer` from the zero
address by the chain's position manager to the identity's EVM wallet, reads
the position's pool and ticks from the chain, and inserts the row
(`supabase/migrations/0004_uniswap_positions.sql`). The client never names a
token id. Before sending the mint the client writes a pending marker
(`localStorage`, keyed by address) with the hash once it has one, and on the
next load reconciles by POSTing it, so a mint that landed while the record
call failed still appears. v3 positions are also discovered by enumeration on
every read. A row whose position now has zero liquidity and no fees owed is
marked closed and hidden.

**D9. Robinhood Chain joins Privy's `supportedChains`** (viem's `robinhood`),
and `lib/robinhood/constants.ts` holds the chain id, `ROBINHOOD_RPC_URL`
(server-only, public default), the explorer and the token constants. Base
reads get `BASE_RPC_URL` the same way. `lib/uniswap/rpc.ts` maps a chain id
to endpoints and wraps `jsonRpcBatchSettled`.

**D10. Reuse over rewrite.** `connectEvmChain`, `executeEvmRoute`,
`submitTrustwareReceipt` and `trackTrustwareSettlement` from
`lib/trustware/execute.ts`; `quoteFunding`, `broadcastFundingLeg` and
`GAS_FLOOR_WEI` from `lib/morpho/fund.ts` (with `fundingRequest` generalised
to take the destination chain, a two-line change that keeps its default);
`planEthGas` from `lib/trustware/eth-gas.ts`; `waitForReceipt`, `sendTx` and
`approveIfShort` from `lib/ethereum/tx.ts`, which gain a chain-id parameter
so the same five helpers serve four chains (`connectEthereum` stays as a
one-line wrapper). No new signing path.

**D11. Exits land in the wallet; home is a separate press.** Withdraw runs
`/lp/decrease` at 100% (v3 with `withdrawAsWeth: true`, so WETH stays WETH
for the return leg); the two tokens land in the EVM wallet. Claim runs
`/lp/claim_fees`. Reopen is Withdraw followed by a deposit sized from the
wallet's balances of both tokens (the on-chain swap rebalances to 50/50).
"Move to Solana" appears for every pool token the wallet holds on that chain
and runs the `return` shape (any token to Solana USDC) per token; native MON
goes through `sendMonToSolana` as it does for shMON.

**D12. Minimums and warnings.** Deposit minimum 10 USDC per position (two or
three legs at about $0.07 to $0.16 fixed each). Warn below 50 USDC that the
legs' fixed fees are a noticeable share, and on Ethereum defer to
`planEthGas`, which refuses when gas would exceed 2% of the position.

**D13. Metrics route: Uniswap GraphQL first, GeckoTerminal second, chain
always.** `app/api/uniswap/pools` reads TVL and volumes for every pool in one
GraphQL request through `lib/upstream.ts`'s circuit (which gains a POST
body), falls back to GeckoTerminal per pool for TVL and 24h volume, and reads
`slot0` and liquidity from each chain in one batch. Cached 60 s, stale-served
for 30 min with `x-aeras-stale: 1`.

## Architecture

### Flows

**Deposit (from Solana USDC).**
1. Read fresh balances of both pool tokens and the gas token on the chain
   through the positions route (`walletBalances` on the payload).
2. Plan: split the USDC in half per side; for each side that is short, price
   its leg (`bridge`: Solana USDC → token; `swap`: the dollar side gets both
   halves and half is priced as a same-chain quote). Price the gas leg when
   the wallet is under the chain's floor. Refuse below the minimum, or when
   any leg fails to quote.
3. Broadcast every Solana-source leg (one signature each), submit receipts,
   track all to settlement in parallel, then poll the balances until they
   cover the plan.
4. Run the on-chain swap where the plan has one (`executeEvmRoute`,
   same-chain), then read balances again.
5. `check_approval` for the two tokens at the amounts held; send each
   returned transaction; `create` with `tickBounds` from D3 and the dollar
   side (or token1 where there is none) as the independent amount held less
   0.5%; if the dependent amount exceeds the other holding, call `create`
   again with the other side independent at its holding less 0.5%. Sign,
   send, wait. Record (D8).

Stages reported through `MorphoTxProgress` (`funding`, `switching`,
`approving`, `depositing`, `confirming`, `done`); reuse the type.

**Claim.** `claim_fees` → sign → wait → refresh. **Withdraw.** `decrease`
100% → sign → wait → refresh; the row is marked closed on the next read.
**Reopen.** Withdraw, then the deposit flow from wallet balances with no
Solana legs. **Move to Solana.** Per token, the `return` shape through
`executeEvmRoute`; native MON through `sendMonToSolana`.

### Files

New:

```
lib/robinhood/constants.ts    chain id, RPC env + public default, explorer,
                              USDG, WETH, native aliases, GAS floor and top-up
lib/uniswap/constants.ts      LP API base, per-chain contracts, BAND_BPS,
                              minimums, cache windows
lib/uniswap/pools.ts          the twelve pools and their tokens; exclusions
                              recorded; lookups by id and chain
lib/uniswap/abi.ts            v3 pool, v3 position manager, v4 position
                              manager, StateView, ERC-721 Transfer
lib/uniswap/math.ts           pure: tick ↔ sqrt price, band ticks, amounts
                              for liquidity, liquidity for amounts, price,
                              fees owed, fee APR, v4 pool id, position info
                              unpacking
lib/uniswap/math.test.ts      pins to the live figures in this file
lib/uniswap/rpc.ts            server-only endpoints per chain + batch
lib/uniswap/server.ts         server-only: pool state, position reads (v3
                              enumeration + stored v4 rows), receipt → row
lib/uniswap/metrics.ts        server-only: GraphQL + GeckoTerminal + APR
lib/uniswap/lp-api.ts         server-only LP API client
lib/uniswap/positions-store.ts server-only Supabase rows
lib/uniswap/client.ts         browser fetchers
lib/uniswap/use-uniswap.ts    hook: pools, positions, prices, polled
lib/uniswap/fund.ts           plan and run the funding legs per chain
lib/uniswap/deposit.ts        approvals + create through the proxy; record
lib/uniswap/withdraw.ts       decrease, claim, reopen, move to Solana
app/api/uniswap/pools/route.ts
app/api/uniswap/positions/route.ts   GET (auth) and POST (auth, receipt)
app/api/uniswap/lp/route.ts          POST (auth) proxy
components/UniswapPoolsCard.tsx
supabase/migrations/0004_uniswap_positions.sql
scripts/uniswap-check.mts
docs/uniswap-lp.md
public/logos/uniswap.png, robinhood.png, wbtc.png, cbbtc.png
```

Changed:

```
lib/privy/provider.tsx        supportedChains + robinhood
lib/base/constants.ts         BASE_RPC_URL
lib/ethereum/tx.ts            chain-id parameter on the five helpers
lib/morpho/fund.ts            fundingRequest takes toChain
lib/trustware/server.ts       the `lp` shape (D6); allowance proxy unchanged
lib/upstream.ts               optional method/body on fetchUpstreamJson
lib/tokens/logos.ts           VENUE_LOGOS.uniswap, robinhood; token logos
lib/ui/chains.ts              Robinhood Chain as a receive chain
lib/positions/earn.ts         EarnSnapshot.uniswap and its rows
components/EarnPanel.tsx      mount the card; header copy
CLAUDE.md                     see Slice 5
```

`lib/trustware/server.ts`, `lib/positions/earn.ts` and CLAUDE.md carry the
owner's uncommitted work; they are edited and left uncommitted (see
Operating rules).

## Slices

Each slice ends with `npx tsc --noEmit`, `pnpm test:run`, the check script
where the slice touches a live integration, and a commit of that slice's
files only. Do not start the next slice with the previous one failing.

### Slice 0. Plan, registry, math, chain plumbing, check script

- This file; `lib/robinhood/constants.ts`; `lib/uniswap/constants.ts`,
  `pools.ts`, `abi.ts`, `math.ts`, `math.test.ts`, `rpc.ts`; the Privy and
  Base constant changes.
- `scripts/uniswap-check.mts`, run as
  `set -a; . ./.env.local; set +a; npx tsx scripts/uniswap-check.mts`:
  1. Registry vs chain for every pool: tokens, fee, tick spacing, hook, and
     the v4 id recomputed from the key. **Assert.**
  2. Pool state: `slot0` and liquidity per pool; the price implied for the
     dollar-quoted pools against GeckoTerminal's, within 3%. **Assert.**
  3. Metrics: the GraphQL read for all twelve, GeckoTerminal for two, the
     fee APR from each. Print.
  4. Trustware: every `bridge` token from Solana USDC at 25 USDC; every
     stock token as a same-chain swap from USDG at 12 USDG; the gas legs
     (Robinhood native ETH with three retries five minutes apart on a 502);
     every pool token to Solana USDC (the way home); the allowance proxy on
     4663 and 143. Assert the Robinhood USDG and Monad USDC legs; print the
     rest and record.
  5. LP API, when `UNISWAP_API_KEY` is set: `pool_info` for every pool,
     `check_approval` for a dummy wallet, `create` with
     `simulateTransaction` on one pool per chain. Assert calldata is
     non-empty for every pool the key serves; print which chains it does
     not.
  6. Gas price per chain, printed.
- Tests pin: `getSqrtRatioAtTick` at 0, `MIN_TICK`, `MAX_TICK`; the tick ↔
  sqrt round trip on the live pairs (NVDA/USDG `5266705192528656573699911090413946`
  ↔ 222102, MON/USDC `12519170589231556796262` ↔ −313228, USDC/WETH on Monad
  `1516325497069829269038989379629140` ↔ 197199); the price from those
  (about 226 USDG per NVDA, 0.025 USDC per MON, 4,388 USDC per WETH within
  1%); band ticks for spacing 10 and 60 and 1; amounts for liquidity against
  a hand-checked case; fees owed with wraparound; the v4 id of SPY/USDG from
  its key; fee APR.

Acceptance: sections 1 and 2 pass; tests and tsc clean; the Trustware and
LP API sections' outcomes are written into `docs/uniswap-lp.md` either way.

### Slice 1. Read layer and the card, read-only

- `rpc.ts` used by `metrics.ts`, `server.ts`, the pools and positions
  routes, the migration and `positions-store.ts`, `client.ts`,
  `use-uniswap.ts`, the card without forms, the `EarnPanel` mount, logos.
- Pools route body: per pool `id, chainId, protocol, tvlUsd, volume24hUsd,
  volume7dUsd, feeApr24h, feeApr7d, sqrtPriceX96, tick, liquidity, price
  (token1 per token0, float), quoteUsdPerBase (dollar per non-dollar token,
  or null), readAt, stale`.
- Positions route GET: `positions[]` with `chainId, protocol, tokenId,
  poolId, tickLower, tickUpper, liquidity, amount0, amount1, fees0, fees1,
  inRange, valueUsd, feesUsd, openedAt`, plus `walletBalances` per chain
  (each pool token and the gas token). POST `{chainId, txHash}` per D8.
- `lib/positions/earn.ts` rows: "NVDA / USDG · Uniswap · Robinhood", amount
  unset, usd from the read.

Acceptance: `/api/uniswap/pools` returns twelve rows with non-null TVL for
at least ten; the positions route for a wallet with none returns an empty
list and balances; the card renders unauthenticated with live figures on a
temporary preview route (deleted before the commit).

### Slice 2. Write path on Monad

- `lp-api.ts`, the proxy route, `fund.ts` (Monad legs: the existing USDC and
  MON shapes, plus WETH/WBTC/cbBTC bridge legs through the `lp` shape),
  `deposit.ts`, `withdraw.ts` (claim, withdraw), the card's forms and
  position actions, the `lp` shape in `lib/trustware/server.ts`, the
  `lib/ethereum/tx.ts` generalisation.

Acceptance: every write path typechecks and is reachable only with a
wallet; the check script's section 5 passes for Monad when a key is set;
tests and tsc clean.

### Slice 3. Robinhood Chain

- `lib/robinhood/constants.ts` in use: the native-ETH gas leg, the USDG
  bridge, the same-chain stock swap, the five stock pools live; Reopen; Move
  to Solana for every pool token.

Acceptance: section 4 passes for the Robinhood legs (or the gap is
recorded); tests and tsc clean.

### Slice 4. Ethereum and Base

- Ethereum: USDC bridge (SWAP_TOKENS already lists it), WETH by same-chain
  swap, gas through `planEthGas` with this venue's budget (approve ×2,
  mint, decrease, claim; measure in section 6 and pin). Base: USDC and WETH
  bridges through the `lp` shape, gas through the `base-gas` shape.

### Slice 5. Docs, CLAUDE.md, memory

- `docs/uniswap-lp.md`: what the venue is in repo terms; the facts tables
  updated with what the check script found; keys and env; what is built;
  decisions; traps; follow-ups (increase, typed-data permits, the Trader
  descriptor, hooked pools if ever).
- CLAUDE.md: a Chain Assumptions paragraph ("Uniswap liquidity pools are the
  seventh exception"), Repo Layout entries, a Built Since v1 entry, the Out
  of Scope venue list, the RPC section (`ROBINHOOD_RPC_URL`, `BASE_RPC_URL`,
  `UNISWAP_API_KEY`).

## Copy

House style applies. Names: "Liquidity pools", "Uniswap" as the venue,
"Robinhood Chain" as the chain, the pair as "NVDA / USDG". The rate is "7d
fee APR". The disclosure under the card, verbatim unless the numbers change:

> A liquidity position holds both tokens of the pair and earns the pool's
> trading fees while the price stays inside its range. Its value moves with
> both tokens and can be less than holding them (impermanent loss). Outside
> the range it holds one token and earns nothing until it is reopened. The
> rate shown is the pool's fees over the last seven days, annualised, not a
> guaranteed return.

## Traps

- **USDG, not USDC, on Robinhood Chain.** Every stock pool is quoted in
  Paxos USDG (6 decimals). Bridging USDC.e would strand it.
- **The explorer's fee tier is not the LP fee** on two v4 pools (3499 shown,
  3000 charged). The registry pins what `poolKeys` says; the APR uses it.
- **Tick spacing 1** on MON/WETH and MON/WBTC. Band alignment must handle
  it, and so must anything that assumes spacing ≥ 10.
- **Native MON is currency0** on three Monad pools. A mint sends `value`; a
  decrease delivers native MON; the wallet's gas reserve is the same token.
- **No bridge delivers a stock token.** The USDG leg carries the whole
  deposit and the on-chain swap makes the stock half. A retry must read the
  wallet first or it swaps twice.
- **v4 positions do not enumerate.** Lose the row and the position is
  invisible to the app (never to the chain). D8's receipt record and pending
  marker are the whole answer; keep them.
- **The LP API's calldata carries a deadline.** Fetch it after the funding
  legs settle, never before, and sign within the minute.
- **Never index the Privy wallets array**; sign through `useEmbeddedEvmWallet`
  and `useSendSolanaTxBase64`. Never capture the wallet object across a
  chain switch (`connectEvmChain` handles it).
- **Ethereum gas can swamp a small position.** `planEthGas` refuses past 2%;
  do not lower that for this venue.

## Manual test (for the product owner, after the build)

With a wallet holding 40 USDC on Solana and a provisioned EVM wallet:

1. Earn tab, Liquidity pools card: twelve rows with TVL, volume and 7d fee
   APR; positions empty.
2. Monad, MON / USDC: deposit 15 USDC. Expect three silent Solana
   signatures (USDC, MON, and gas if the wallet has none), stage messages,
   then approvals and a mint on Monad, a position row with a value near $15
   and "in range".
3. Robinhood Chain, NVDA / USDG: deposit 15 USDC. Expect the USDG leg and
   the gas leg, the on-chain swap, approvals, the mint, and a row near $15.
4. Claim fees on either (expect a small amount or "nothing to claim").
5. Withdraw the Monad position. Expect MON and USDC in the Monad wallet and
   the row gone; then Move to Solana for the USDC.
6. Withdraw the Robinhood position, then Move to Solana for both tokens.
   Expect USDC on Solana within minutes.

## Operating rules for the autonomous run

- **Git.** Work on the current branch. The checkout carries weeks of the
  owner's uncommitted work and a stash named `pre-integrate-test`; never run
  `git add -A`, `git stash`, `git checkout` or `git reset`, and never touch
  that stash. Commit each slice with `git commit --only -- <paths>` naming
  that slice's files, message `Uniswap LP: slice N, <what>`, with the
  Co-Authored-By trailer. Files that already carry the owner's uncommitted
  changes (`lib/trustware/server.ts`, `app/api/trustware/route/route.ts`,
  `lib/positions/earn.ts`, CLAUDE.md) are edited but not committed; list
  them in the report. Do not push.
- **Servers.** The owner's `next dev` may be on port 3000; never start one
  there. Use `.claude/launch.json`'s `aeras-preview` (3100) for a browser
  check; otherwise curl the routes with `PORT=3100 pnpm dev` in the
  background, and stop it.
- **Env.** `.env.local` holds `MONAD_RPC_URL`, `ETHEREUM_RPC_URL`,
  `TRUSTWARE_API_KEY`. `UNISWAP_API_KEY` and `ROBINHOOD_RPC_URL` are the
  owner's to add; build so their absence is a clear message, never a crash.
  Load with `set -a; . ./.env.local; set +a`. Add no keys. Do not print
  values.
- **Blocked.** If Trustware stays 502 on a leg through the retries, build
  the slice anyway, record the gap in `docs/uniswap-lp.md` under "Not yet
  verified", and say so in the report. If a chain fact contradicts this
  file, the chain wins: update the constant, the doc and the test, and note
  it. If the LP API refuses a chain, record it and leave D5's contingency as
  the next step rather than building it in this run.
- **Scope.** Non-goals stay out. Anything not covered here that the build
  needs is decided the way the shMON venue decided it, and written down in
  `docs/uniswap-lp.md` under Decisions.
- **Report.** End with: what was built, what each check printed (numbers),
  what is unverified, and the commit list.
