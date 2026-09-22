# Buy strategies build plan

Three one-click strategies attached to every collateralisable asset on the Home
asset detail and the Markets row expansion. Each starts from USDC in the wallet,
buys the asset, and then does something with it as collateral. This file is the
plan and its status. Slices are ordered by how much of each already
exists in the repo, not by product priority.

## What the three strategies are

All three assume the asset has a borrow market. `hasLendingMarket(mint)` in
`lib/borrow/availability.ts` is the gate, and `borrowRouteFor(mint)` in
`lib/borrow/route.ts` picks the venue and normalises its terms. Today that is
fourteen assets: four with a Jupiter Lend vault (TSLAx, SPYx, QQQx, NVDAx) and
ten on Kamino's isolated xStocks Market (those four again, plus GOOGLx, AAPLx,
METAx, MSTRx, HOODx, CRCLx). The gold tokens have no market and get no strip.

### 1. Buy + Earn

Buy the asset, post it as collateral, borrow USDC against it at a chosen ratio,
and deposit the borrowed USDC into the best USDC earn vault on Solana. The user
holds the asset and earns the spread between the vault's APY and the borrow
rate on the borrowed slice.

Rate shown on the tile, as an APY on the equity the user put in:

    net = b × (earnApy − borrowApr) + collateralSupplyApy

where `b` is the borrow ratio (debt as a fraction of collateral value),
`earnApy` is the best of Jupiter Lend Earn USDC (vault 2) and Kamino's RWA USDC
kvault, `borrowApr` is the route's live USDC borrow rate, and
`collateralSupplyApy` is the Kamino collateral reserve's supply APY (zero on
Jupiter, where collateral earns nothing; usually near zero on Kamino, but it is
in the metrics payload so it costs nothing to include).

The spread is not guaranteed positive. Jupiter's xStock vaults have borrowed at
4 to 8% and USDC earn has paid 5 to 8%, so it flips. The tile shows the live
delta and greys out with the two numbers side by side when the spread is at or
below zero. It never hides the strategy, and it never shows a rate without the
two components that made it.

The base case for the borrowed USDC is the Hyperithm USDC Apex vault, Morpho
on Monad, funded through the same Trustware path the Earn tab uses (Solana
USDC to Monad USDC, a MON gas top-up when the wallet has none, then the
ERC-4626 deposit). Jupiter Lend Earn and Kamino's USDC vault are offered as
the alternatives that stay on Solana. Closing a Monad position withdraws from
the vault and brings the USDC home through the return leg before repaying.
Every signature is silent, so the one press runs the whole chain.

### 2. Buy + Leverage

Buy the asset at a multiple of the USDC put in. Presets at 2x, 3x and the
vault's max, with the slider from `LoopingPanel` behind them for anything in
between. The tile names the real ceiling per asset, because 3x is not reachable
everywhere: `maxLeverageForVault` derives it from the collateral factor with a
five-point buffer, which gives 2.5x on TSLAx and NVDAx (CF 65%) and 3.3x on
SPYx and QQQx (CF 75%). A preset the asset cannot reach is not rendered.

On Jupiter vaults this is one atomic transaction. `buildMultiplyTx` in
`lib/jupiter/multiply.ts` already composes flashloan, swap, deposit-and-borrow,
and payback; it just assumes the equity is already held as the asset. The
change is to let equity arrive as USDC:

    flashloan   L × E          (was (L − 1) × E)
    swap        L × E USDC → asset
    deposit     swap minimum out (+ any asset already in the wallet)
    borrow      (L − 1) × E
    payback     L × E, funded by the borrow plus the user's own E USDC

Same instruction count, same account-lock budget, one signature. The swap is
larger (the whole exposure instead of the borrowed slice), so price impact on
the preview matters more and the 28-account route budget bites sooner on thin
names. The existing walk-down loop handles that; the preview shows the impact.

On Kamino-only assets there is no flashloan through the KTX proxy, so atomic
leverage is not available. Those assets get leverage through the sequential
ladder in strategy 3 with a target multiple instead of a target floor. The tile
says "in N steps" for those, and "one transaction" for Jupiter vaults. Do not
paper over the difference: it is the difference between one signature and six.

### 3. Buy + Buy more (the ladder)

Buy the asset, post it, borrow USDC, then ask the user what to buy with the
borrowed USDC. Default is the same asset again. If the pick has a borrow market
the ladder continues; if it does not (a gold token, say) the ladder ends with
that purchase. Repeat until the next borrow would be below a floor, until the
venue's liquidity is exhausted, or until the user stops.

Each round is a purchase on Jupiter Ultra followed by a deposit-and-borrow.
Nothing is atomic and nothing should pretend to be. Each round is signed
separately and the user sees the aggregate after every one: total exposure,
total debt, per-position health and liquidation drop, and how many rounds are
left. Rounds converge geometrically: at a borrow ratio of 58% (Jupiter's 65% CF
times the 0.9 safety ratio) five rounds capture 90% of the limit, so the
"rounds left" figure is real and small.

A ladder is a set of plain borrows whose proceeds went into other assets. It is
not a loop in the sense `loop_positions` records today, and it must not be
labelled as one: `LoopingPanel` would draw a leverage figure the user never
chose. The Positions view needs to explain the debt as "borrowed to buy X",
which is bookkeeping this repo does not have yet (see slice 4).

## Where it lives in the UI

Three buttons under the asset's chart, rendered only when
`borrowRouteFor(xstock.mint)` resolves and there is a wallet to sign with:
`components/strategies/AssetStrategies.tsx`, mounted by the Markets row
expansion and the Home asset detail in `app/app/page.tsx` (as of 2026-09-20).
They sit beside `AssetTradePanel` rather than inside it, because the buttons go
under the chart and the ticket they open takes the market ticket's place; both
are siblings of the trade panel on each surface. The Strategies page draws the
same strip and ticket in its row expansion, without the market ticket to return
to. The sortable strategy column on the Markets header is not built.

Each button names the strategy and shows one live number (the net rate, the
max multiple, the borrow rate) or the state of a saved run on it ("Resume",
"Open"). There is no prose beside the ticket: what a strategy does is in its
preview, priced on the amount typed. The ticket takes a USDC amount, the
strategy's one parameter (borrow ratio, leverage, floor), and a preview block
in the shape of `LoopingPanel`'s: exposure, debt, LTV, liquidation price,
drawdown to liquidation, carry, swap price impact. The submit button reads the
number of signatures it will ask for.

## Shared foundation

New module `lib/strategies/`. Nothing else in the repo should compute a
strategy rate; the Borrow tab, Earn tab and these tiles must agree to the
decimal, and the way to guarantee that is one source.

- `rates.ts`: `useStrategyRates(mint)`. Joins `borrowRouteFor`, the live borrow
  rate (already fetched per venue in `useBorrowMarketStats`), the best USDC earn
  APY (from `fetchEarnVaultsViaProxy` and `fetchKaminoVaultsViaProxy`, the same
  calls `EarnPanel` makes), and Kamino's collateral supply APY. Returns nulls
  while loading; the tiles render dashes, never zeros.
- `math.ts`: pure functions with no I/O, so they can be unit-tested against the
  numbers in `docs/jupiter-borrow.md`. `earnNetApy`, `leverageForRatio`,
  `ratioForLeverage`, `ladderProjection(equity, ratio, floor)` returning the
  per-round sizes and the geometric total, and aggregate health across several
  routes. `healthAt` and `borrowLiquidationDrop` in `lib/borrow/route.ts` stay
  where they are and are called, not copied.
- `machine.ts`: the resumable step runner the sequential strategies share. A
  strategy is a list of steps; each step builds one transaction, signs it,
  broadcasts through `sendAndConfirm`, and records what landed. State persists
  locally and on the server (a `strategy_runs` table) so a refresh between
  signatures resumes at the right step, but the resume point is reconciled
  against chain state (asset balance in the wallet, position debt) before
  continuing rather than trusted from storage. A user who closes the tab after
  the buy and before the deposit must come back to "deposit", not to "buy".

## Bookkeeping

`supabase/migrations/0002_loop_positions.sql` records one fact per vault: that
its position is leverage-managed, and the basis. Strategies need two more
things: which strategy opened a position, and, for the ladder, what the borrowed
USDC bought. Add a `strategy` column (`multiply`, `earn`, `ladder`) to
`loop_positions` so the Positions view can label each, and a `strategy_runs`
table holding the machine state for sequential strategies with a row per step
(step name, signature, status). As with `loop_positions`, none of it sizes a
transaction. That property is load-bearing and stays.

## Status (2026-09-19)

Built as its own page first, a "Strategies" section in the sidebar of
`app/app/page.tsx`, so the three flows can be tried end to end before they are
folded into the buy ticket. What exists:

- `lib/strategies/math.ts` and its tests, `lib/strategies/rates.ts` (live
  borrow, earn and supply rates joined per asset), `lib/strategies/execute.ts`
  (the signed legs: Ultra buy and sell, deposit-and-borrow and
  repay-and-withdraw on either venue, USDC earn deposit and withdraw on either
  venue, one-transaction leverage open and unwind from USDC) and
  `lib/strategies/run.ts` (the step runner with per-step retry and resume).
- `components/strategies/`: the page, and one ticket per strategy.
- `buildMultiplyTx` takes `equityUsdcAtomic`, so a wallet holding only USDC
  opens a leveraged Jupiter position in one signature. The leverage ticket
  writes the same `loop_positions` record the looping panel does, so the
  position shows there and unwinds from there.
- Run persistence: `supabase/migrations/0003_strategy_runs.sql`,
  `lib/strategy-runs.ts`, `app/api/strategies/runs`, and
  `lib/strategies/runs-client.ts`. A run is saved after every step with the
  balances it read, so a refresh mid-run comes back as a Resume prompt. A step
  that was interrupted mid-flight is reconciled against the chain (did the
  asset arrive, did the venue record debt, did the USDC leave) before anything
  is re-sent, so a buy is never sent twice.
- Close paths on every ticket. Earn: withdraw enough USDC from the vault to
  clear the loan, repay, withdraw the asset. Leverage: the one-transaction
  unwind. Ladder: the same unwind when every round bought the same Jupiter
  asset (the positions merged into one), else the rounds taken apart in
  reverse, each asset sold to repay the loan that bought it.
- Positions labelling: the health card on the Positions view tags a position
  with the strategy that opened it.
- `scripts/jupiter-multiply-usdc-check.mts`: builds and simulates the
  USDC-equity multiply at 2x and max on all four vaults.

Not done:

- Nothing here has been run against mainnet. The script needs a wallet
  holding USDC and the RPC env var; run it before the first real open.
- The Jupiter flashloan fee is still unrecorded; the script prints the fee
  log line if the program emits one.
- Kamino's obligation reader reports one collateral, so a mixed ladder on
  Kamino shows only its first asset on the Borrow tab. The unwind does not
  depend on it: it repays and withdraws by the amounts the run recorded.

## Slices

Each slice ends with `npx tsc --noEmit`, a `scripts/` check where it touches a
live integration, and manual test instructions. One slice per session.

- [x] **0. Rates, math, and the strip with numbers only.** Done as a page, not a strip. `lib/strategies/rates.ts`
      and `math.ts`, the three tiles under `AssetTradePanel`, the Markets column.
      No execution. Test: every tile's number matches what the Borrow and Earn
      tabs show for the same asset and venue, and the max multiple matches
      `LoopingPanel`'s slider ceiling.
- [x] **1. Buy + Leverage on Jupiter vaults.** Code and script in; live check outstanding. Add `equityUsdcAtomic` to
      `buildMultiplyTx`, the ticket with presets, and a `loop_positions` row with
      `strategy = 'multiply'` and `basisUsd = E` so the existing loop card shows
      P&L and can unwind it. Verify with a new `scripts/jupiter-multiply-usdc-check.mts`
      that builds and simulates the transaction at 2x and at max on all four
      vaults, and reads back that the payback instruction draws the equity from
      the signer's USDC account. Also confirm the flashloan fee, which nothing in
      the repo records; if it is nonzero it belongs in the preview's cost line.
- [x] **2. Buy + Earn on Jupiter vaults.** Sequential steps and close path in; fusing the last two not done. Three signatures through the machine:
      Ultra buy, operate (deposit and borrow in one `getOperateIx`, as the
      multiply path already does), earn deposit. Then fuse the last two: both are
      our own instructions, so one transaction is likely to fit. Close path is
      earn withdraw, repay, collateral withdraw, chained through the same machine.
- [x] **3. Buy + Earn on Kamino.** Code in, untested live. Four signatures (KTX builds deposit and borrow
      separately). Same ticket, same machine, venue resolved by `borrowRouteFor`.
- [x] **4. The ladder, Jupiter first.** Rounds, picker, aggregate health, persistence and Positions labelling in. The asset picker between rounds, the
      aggregate health block, the floor, and `strategy_runs` persistence with
      chain reconciliation on resume. Positions view learns to say "borrowed to
      buy X". Then Kamino, which also gives Kamino-only assets their leverage.
- [x] **5. Close paths and labelling.** A "Close strategy" action that walks the
      steps in reverse for Earn and the ladder, and the Positions view showing
      strategy, basis and net rate per position.

## Decisions taken in this plan

- Earn venue for the borrowed USDC defaults to the Hyperithm vault on Monad,
  with Jupiter Lend Earn and Kamino's USDC kvault as alternatives.
- Default borrow ratio for Earn and the ladder is half the collateral factor,
  which puts health near 2.3 on a 75% LT market. The slider goes up to
  `safeMaxBorrowRatio`, the 90%-of-CF ceiling the borrow forms already use.
- Leverage on Kamino-only assets is sequential, never atomic, and the UI says
  so in signature counts.
- The ladder accepts any catalog asset at each round. A round that buys a
  non-collateral asset is the last round.
- Ladder floor is the larger of $5 and the venue's remaining liquidity, and the
  user can stop earlier at every prompt.

## Open questions

- Should the 3x preset exist at all when only two of fourteen assets reach it,
  or should the presets be 2x and max?
- Is a ladder that ends in a different asset than it started in a product we
  want, or should the picker be limited to assets with a market so every ladder
  is closable from the same view?
- Does the strip belong on the buy ticket, or as a fourth tab beside Market and
  Limit? The ticket is where a user with USDC is already standing; a tab hides
  it one click away but keeps the buy ticket short.

## Standing constraints

- CLAUDE.md governs. Every broadcast goes through `sendAndConfirm`, every built
  transaction sets a compute unit price, every venue rate is a decimal until it
  is formatted, and no user-facing copy uses an em dash or a marketing adjective.
- Never index a Privy wallets array. Sign through `useSignSolanaTxBase64`.
- `loop_positions` and `strategy_runs` are display-only. Nothing read from them
  sizes a transaction.
- Verify against the live endpoint before trusting a number in this file. The
  collateral factors above are from `docs/jupiter-borrow.md` and
  `lib/kamino/reserves.ts` snapshots and can move.
