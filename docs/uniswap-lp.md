# Uniswap liquidity pools

Read this before touching `lib/uniswap/`, `lib/robinhood/`, `app/api/uniswap/`,
`components/UniswapPoolsCard.tsx`, or the `lp` shape in
`lib/trustware/server.ts`. The plan that produced it, with the decisions
numbered, is `docs/uniswap-lp-plan.md`; this file is the record of what is
built and what was verified. Everything marked *verified* was read live from
the four chains, Uniswap's indexer and Trustware on 2026-09-22 by
`scripts/uniswap-check.mts`, which re-verifies it on demand:

```bash
set -a; . ./.env.local; set +a; npx tsx scripts/uniswap-check.mts
```

The script quotes Trustware (which creates nothing and moves nothing), reads
every chain, and signs nothing. With `UNISWAP_API_KEY` set it also asks the
LP API to build one mint per chain for a dummy wallet, which is what proves
the key serves a chain.

Read CLAUDE.md first, in particular Chain Assumptions: this is the seventh
venue where a position lives off Solana, and the first on Robinhood Chain.
It is reached the way Morpho-on-Monad and shMON are, through the embedded
EVM wallet and Trustware legs from Solana USDC, and it reuses their plumbing
by import.

## The three things to get right first

**A position is two tokens, not a deposit.** Opening one buys both sides of
the pair (half and half by value, because the band is geometric around the
price), and its value then moves with both tokens and can be less than
holding them. It earns the pool's fees only while the price is inside its
range; outside it holds one token and earns nothing until reopened. The
card says this in its figures and its disclosure, calls the rate "7d fee
APR", and never "APY". It is not a Vaults column and not a Buy + Earn
option, and should not become either.

**The calldata is Uniswap's, through our proxy.** Every mint, decrease and
claim is built by Uniswap's Liquidity Provisioning API
(`liquidity.api.uniswap.org/lp/*`, key `UNISWAP_API_KEY`, server-only) and
handed back as a `TransactionRequest` the embedded wallet signs as it is.
`app/api/uniswap/lp` pins the wallet to the verified identity's embedded EVM
wallet and the pool to the registry; the browser chooses an operation, an
amount, a tick range or a token id, and nothing else. **The key was not set
when this was built, so no calldata has been built or signed yet** (see
"Not yet verified").

**v4 positions do not enumerate.** The v4 PositionManager is an ERC-721
without enumeration, so a position the app minted is only visible to the
app through the row `app/api/uniswap/positions` writes from the mint's
receipt (POST `{chainId, txHash}`; the token id, pool and ticks are read
from the chain, never from the browser). A pending marker in localStorage
holds the hash until the row exists and is reconciled on the next load. v3
positions are also discovered by enumeration on every read. Lose the row
and the position is invisible to the app, never to the chain.

## Facts, as of 2026-09-22

### The pools (registry `lib/uniswap/pools.ts`)

Fee and tick spacing are the chain's (`fee()`/`tickSpacing()` on v3,
`PositionManager.poolKeys` on v4), and every v4 id recomputes from its key.
*verified* for all twelve. TVL and volume are Uniswap's indexer at 03:00
UTC; fee APR is volume times the LP fee, annualised, over TVL.

| Chain | Pair | Ver | Fee | Spacing | TVL | 24h vol | 7d fee APR |
|---|---|---|---|---|---|---|---|
| Robinhood | USDG / NVDA `0xd4EB2120…` | v3 | 500 | 10 | $5.91M | $21.7M | 61.9% |
| Robinhood | SPY / USDG `0xfe2a80bb…` | v4 | 3000 | 60 | $5.03M | $3.9M | 51.0% |
| Robinhood | USDG / META `0x5875d407…` | v4 | 3000 | 60 | $3.65M | $7.0M | 197.1% |
| Robinhood | SPCX / USDG `0xc6128433…` | v3 | 500 | 10 | $2.67M | $19.3M | 121.1% |
| Robinhood | USDG / GLD `0x7A6A053e…` | v3 | 3000 | 60 | $3.57M | $1.0M | 33.7% |
| Monad | USDC / WETH `0xad408916…` | v4 | 500 | 10 | $1.84M | $4.3M | 32.3% |
| Monad | MON / USDC `0x18a9fc87…` | v4 | 500 | 10 | $2.06M | $5.0M | 18.9% |
| Monad | MON / WETH `0x3783b51e…` | v4 | 500 | 1 | $1.94M | $2.7M | 18.4% |
| Monad | MON / WBTC `0x1c93dd2f…` | v4 | 500 | 1 | $1.75M | $2.8M | 18.1% |
| Monad | USDC / cbBTC `0x7fc6232a…` | v4 | 500 | 10 | $1.05M | $1.6M | 23.3% |
| Ethereum | USDC / WETH `0x88e6A0c2…` | v3 | 500 | 10 | $103.8M | $94.0M | 15.4% |
| Base | WETH / USDC `0x6c561B44…` | v3 | 3000 | 60 | $152.5M | $22.8M | 60.3% |

Two things the explorer shows differently from the chain: the SPY/USDG and
META/USDG v4 pools charge 3000 pips (the explorer's `feeTier` says 3499;
`getSlot0().lpFee` says 3000), and MON/WETH and MON/WBTC use tick spacing 1.
Every listed v4 pool has the zero hook. MON is `currency0` as the zero
address in three Monad pools: those positions hold native MON and a mint
carries `value`.

The prices the pools imply agreed with GeckoTerminal's within 0.5% on every
dollar-quoted Robinhood pool (NVDA $226.27 vs $226.25, SPY $772.97 vs
$775.25, META $744.91 vs $742.33, SPCX $152.19 vs $152.26, GLD $397.01 vs
$398.96). *verified*

Excluded, with the reason recorded in the registry: the three hooked
Robinhood pools (AI/NVDA, ETH/STANDARD, WETH/STATICS, memecoin pairs behind
third-party hooks) and the two dust Monad pools (WBTC/USDC $45k, AUSD/XAUt0
$23k).

### Chains and contracts

| | |
|---|---|
| Robinhood Chain | chain id 4663, Arbitrum Orbit, ETH gas, mainnet since 2026-07-01. viem 2.55.8 ships `robinhood`; declared in `lib/privy/provider.tsx`. RPC `ROBINHOOD_RPC_URL`, public default `https://rpc.mainnet.chain.robinhood.com`; Alchemy serves it. Explorer robin.etherscan.io. Gas 0.054 gwei when measured: a 600k-gas mint is 0.00003 ETH. *verified* |
| Base | `BASE_RPC_URL`, public default `https://mainnet.base.org`, which **drops calls from a batch of six** (observed twice); `lib/uniswap/server.ts` chunks Base batches at four and the check script re-asks dropped calls. Set the Alchemy endpoint. |
| Monad, Ethereum | the endpoints the other venues use. Monad gas 102 gwei (a mint 0.06 MON), Ethereum 0.06 gwei when measured. |
| v4 PositionManager | Robinhood `0x58daec31…`, Monad `0x5b7ec4a9…`, Ethereum `0xbd216513…`, Base `0x7c5f5a4b…`; StateView Robinhood `0xf3334192…`, Monad `0x77395f3b…`. From the developer docs, and *verified* by the pool keys they return. |
| v3 NonfungiblePositionManager | Robinhood `0x73991a25…`, Monad `0x7197e214…`, Ethereum `0xC36442b4…`, Base `0x03a520b3…`. |
| PositionInfo layout | `unpackPositionInfo` in `lib/uniswap/math.ts` *verified* against live positions on both v4 chains (token 3093770 on Robinhood, 631095 on Monad). |

### Tokens

USDG (Paxos Global Dollar, `0x5fc5360D…`, 6 decimals) is the quote asset of
every Robinhood stock pool. Not USDC: the USDC on 4663 is a bridged USDC.e
that no listed pool uses. The stock tokens are plain 18-decimal ERC-20s
(NVDA `0xd0601CE1…`, SPY `0x117cc213…`, META `0xc0D6457C…`, SPCX
`0x4a0E65A3…`, GLD `0xC9a981FE…`). Monad: USDC `0x754704Bc…`, WETH
`0xEE8c0E9f…`, WBTC `0x0555E30d…` (8), cbBTC `0xd18B7EC5…` (8). Ethereum and
Base: the canonical USDC and WETH.

### Trustware, quotes on 2026-09-22 (*verified*, dummy addresses, nothing created)

| Leg | Result |
|---|---|
| Solana USDC 25 → Robinhood USDG | lifi, 24.88 USDG, fees $0.067 |
| Solana USDC 2 → Robinhood native ETH | relay, 0.000721 ETH, fees $0.029, **both spellings** (the 502 of 2026-09-21 was transient) |
| Solana USDC 25 → Robinhood WETH | lifi, 0.00909 WETH |
| Robinhood USDG 12 → NVDA / SPY / META / SPCX (same chain) | lifi, all four; fees $0.12 each |
| Robinhood USDG → GLD, WETH → GLD, Solana USDC → GLD | **no route from any provider**. Only Monad USDC → Robinhood GLD quotes (khalani), which the app does not run. GLD is `source: "none"`: listed, not depositable. |
| Robinhood NVDA / SPY / META / SPCX / GLD / USDG / WETH → Solana USDC | lifi, all seven; fees $0.17 to $0.47 |
| Solana USDC 25 → Monad USDC / MON / WETH / WBTC / cbBTC | all five (lifi or relay), fees $0.05 to $0.13 |
| Monad USDC / MON / WETH / WBTC / cbBTC → Solana USDC | all five, lifi |
| Solana USDC → Ethereum USDC / WETH / native ETH; Ethereum USDC / WETH → Solana USDC | all five |
| Solana USDC → Base USDC / WETH / native ETH; Base USDC / WETH → Solana USDC | all five |
| Allowance proxy (`/sdk/rpc/evm/allowance`) | answers on all four chains |

A Solana-sourced quote carries `fromAmountUSD`; without it the squid
provider declines (lifi still answers), so the planner's requests carry it.

### Metrics sources

Uniswap's interface GraphQL answered all twelve pools in one request with
TVL, 24h and 7d volume. *verified* GeckoTerminal answered the Robinhood
pools and rate-limited the Monad ones at 2.1 s spacing, so it is the
fallback and not the primary. Both run through `lib/upstream.ts`'s circuit
(`uniswap-graphql`, `geckoterminal`), and `fetchUpstreamJson` gained a POST
body for the first.

## Keys and env

| Variable | Where | Purpose |
|---|---|---|
| `UNISWAP_API_KEY` | server-only | The LP API. Free on the Uniswap Developer Platform. Without it the proxy answers 503 with "Liquidity pool transactions are not enabled" and the card's actions fail with that message; reads work. **Not set as of 2026-09-22.** |
| `ROBINHOOD_RPC_URL` | server-only | Robinhood Chain reads. Public node by default (rate-limited). |
| `BASE_RPC_URL` | server-only | Base reads. Public node by default (drops batched calls). |
| `MONAD_RPC_URL`, `ETHEREUM_RPC_URL`, `TRUSTWARE_API_KEY` | as before | |

The Supabase migration `supabase/migrations/0004_uniswap_positions.sql` has
to be run by hand in the SQL editor (supabase/README.md). Until it is, the
positions route still reads v3 positions and balances, logs a store error,
and records nothing.

## What is built

- `lib/uniswap/pools.ts`: the registry (twelve pools, their tokens with a
  `source` of `bridge`, `swap` or `none`, the four chains).
  `lib/uniswap/constants.ts`: endpoints, contracts, `BAND_BPS` (1000),
  minimums, `MINT_MARGIN_BPS`. `lib/robinhood/constants.ts`: the chain.
- `lib/uniswap/math.ts` (+ tests): TickMath and LiquidityAmounts in bigint,
  band ticks, prices, `tokenUsdPrices` (every registry token priced off the
  dollar-quoted pools in two passes), fees owed, fee APR, v4 pool id,
  PositionInfo unpacking.
- Reads: `lib/uniswap/rpc.ts` (per-chain batched JSON-RPC), `server.ts`
  (pool states, wallet balances, positions with fees, gas prices, receipt →
  row), `metrics.ts` (TVL and volume), `positions-store.ts` (Supabase).
  Routes: `app/api/uniswap/pools` (cached 60 s, stale 30 min),
  `app/api/uniswap/positions` (GET with the token; POST records a mint).
- Writes: `lib/uniswap/lp-api.ts` and `app/api/uniswap/lp` (the proxy),
  `fund.ts` (the planner and the one-press deposit), `deposit.ts` (the mint
  and the pending marker), `withdraw.ts` (claim, withdraw, reopen, move
  home). `lib/ethereum/tx.ts` now takes a chain id; `fundingRequest` in
  `lib/morpho/fund.ts` takes a destination chain; `lib/trustware/server.ts`
  admits the `lp` shape (pinned by `lib/uniswap/lp-shape.test.ts`).
- The card: `components/UniswapPoolsCard.tsx`, mounted under the shMON card
  in `components/EarnPanel.tsx`. Rows per pool, an expanded row with the
  price, the band, positions with Claim / Withdraw / Reopen, the deposit
  form with the priced legs shown before the button, and Move to Solana for
  every pool token in the wallet. `lib/positions/earn.ts` draws a row per
  position in the wallet card and the Portfolio tab.

## Decisions (beyond the plan's D1 to D13)

- **GLD is listed but not depositable.** No provider routes into GLD on
  Robinhood Chain from anywhere the app signs. The card says so on the row;
  its positions still claim and withdraw, and GLD → Solana USDC routes.
- **The deposit spends exactly the amount entered.** Gas top-up first, then
  each side gets half of what is left in dollars, less what the wallet
  already holds of it up to that half; the mint is sized from what arrives.
  A short arrival is a slightly smaller position, never a failure, and
  anything left over stays in the wallet with a Move to Solana button.
- **Rebalance before every mint from wallet balances.** When the two sides
  differ by more than 3% of the total and more than a dollar, half the
  difference is swapped through Trustware's same-chain route, so a Reopen
  after an out-of-range exit (100% one token) comes back to 50/50.
- **Ethereum gas goes through `planEthGas`** with a 1,000,000-unit
  lifecycle budget; the other chains keep fixed floors (Monad 0.1 MON,
  Robinhood and Base 0.0002 ETH) and fixed top-ups (0.5, 1.5, 1.5 USDC).
- **Approvals as transactions** (`generatePermitAsTransaction: true`), so
  v3 and v4 share one signing path. Typed-data permits are a follow-up.

## Traps

- USDG, not USDC, on Robinhood Chain; the explorer's fee tier is not the LP
  fee on two v4 pools; tick spacing 1 on two Monad pools; native MON is
  `currency0` on three; no bridge delivers a stock token, so the USDG leg
  carries the whole deposit and the swap makes the stock half; the LP API's
  calldata carries a deadline (build it after the legs settle, sign within
  the minute); v4 positions do not enumerate. All in the plan's Traps.
- **Prices in the planner are the pools' own.** `tokenUsdPrices` prices
  every token off the dollar-quoted pools; a stale pools payload sizes a
  side wrong by the drift, which the mint absorbs (the API computes the
  dependent side at the live price), so the cost is leftover dust, not a
  bad position.
- **`fetchUniswapPositions` is the balance read**, one call for four chains,
  cached 5 s per address. The arrival poll runs every 2.5 s; half its polls
  hit the cache, by design.
- **Another session's uncommitted files.** `lib/trustware/server.ts`,
  `lib/morpho/fund.ts`, `lib/positions/earn.ts`, `lib/tokens/logos.ts`,
  `lib/upstream.ts`, `lib/base/constants.ts`, `lib/ui/chains.ts` and
  CLAUDE.md carry the owner's uncommitted work and this venue's edits to
  them are uncommitted too; the committed slices do not build without them.

## Not yet verified

- **The LP API.** No key, so no `check_approval`, `create`, `decrease` or
  `claim_fees` has been called, and whether the API serves chains 4663 and
  143 is unknown. Section 5 of the check script answers it the moment the
  key is set. If it refuses a chain, the plan's D5 contingency (the same
  calldata from `@uniswap/v3-sdk` and `@uniswap/v4-sdk` behind the same
  proxy shape) is the next step.
- **Every write path.** Nothing has been signed: no leg, no swap, no
  approval, no mint, no decrease, no claim. The manual test below is the
  first run. Gas per operation is unmeasured on every chain.
- **The pending-marker reconcile** and the receipt reader have run against
  no real mint.

## Follow-ups

- `/lp/increase` (add to an existing position rather than opening a second).
- Typed-data Permit2 permits instead of approval transactions.
- A Trader-mode Earn descriptor (`lib/trader/earn-venues.ts`) once that
  grid's page wiring is committed.
- `earnKind: "pool"` for the wallet card's badge (the rows read "Vault").
- GLD deposits, if a provider starts routing it, by flipping its `source`.

## Manual test (for the product owner)

With `UNISWAP_API_KEY` set, the migration run, and a wallet holding 40 USDC
on Solana plus a provisioned EVM wallet:

1. Earn tab, Liquidity pools card: twelve rows with TVL, volume and 7d fee
   APR; positions empty.
2. Monad, MON / USDC: enter 15, read the priced legs (USDC, MON with the gas
   reserve folded in), press Deposit. Expect two silent Solana signatures,
   the bridging stage, then approvals and the mint on Monad, and a position
   near $15 marked in range.
3. Robinhood Chain, USDG / NVDA: enter 15. Expect the USDG leg and the ETH
   gas leg, then the on-chain USDG → NVDA swap, approvals, the mint, and a
   row near $15.
4. Claim fees on either (expect a small amount, or the button disabled).
5. Withdraw the Monad position. Expect MON and USDC in the wallet rows under
   the pool and the position gone; Move to Solana for the USDC.
6. Withdraw the Robinhood position, then Move to Solana for both tokens.
   Expect USDC on Solana within minutes.
7. Run `scripts/uniswap-check.mts` and paste section 5 into this file.
