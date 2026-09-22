# Trader mode: build plan

A second way of looking at the same account. The app as it stands becomes
**Investor** mode, untouched. **Trader** mode is a card-first surface with
four sections: Earn, Buy + Earn, Strategies, Portfolio. Every card is a
venue or a strategy the repo already runs; Trader mode changes what a user
sees first, not what signs. This file is the plan, the decisions numbered,
and the slices, written 2026-09-21 for confirmation before code.

Read CLAUDE.md first, then `docs/buy-strategies-plan.md` (the three
strategies every Trader card resolves to) and `docs/shmonad.md` (the first
Earn card). The reference screenshots were Rysk's covered-call table, Steer's
vault grid and Steer's fund-a-vault page. What is taken from them is the
structure, stated under D7; the palette and chrome are theirs and stay theirs.

## Summary

- **Two modes, one account.** A segmented control under the logo switches
  between Investor and Trader. Same wallet, same balances, same positions,
  same hooks. The choice is remembered per browser. Investor is the default
  and is the current app byte for byte.
- **Earn.** A grid of yield venues, one card each: what goes in, what comes
  out, the live APY large, TVL small, the user's position when there is one.
  Opening a card shows the venue's own deposit and withdraw form beside a
  "Your position" panel. First card: shMON staking on Monad. Uniswap LP
  cards land when that venue is built (its own plan, see D9).
- **Buy + Earn.** A grid of every asset with a borrow market, one card each,
  headlined by the net rate on the money put in (Buy + Earn's figure), with
  the borrow rate and the earn rate that made it. Opening a card shows the
  existing Buy + Earn ticket beside the position it opened.
- **Strategies.** Named plays with a thesis, each a preset over the three
  strategies the machine already runs: which asset, which kind, which venue,
  which ratio. Opening one shows the thesis and the mechanics, then the
  existing ticket pre-filled. No play adds a signing path.
- **Portfolio.** The wallet card and the positions view, both existing.

## Goals

1. A user who wants yield, or a stock with its loan working, reaches a
   priced card in one click and a signed run in three, without reading the
   Borrow tab.
2. Every figure on a Trader card is the figure Investor mode shows for the
   same venue and asset, from the same hook. No second rate calculation.
3. Every action in Trader mode runs through a path Investor mode already
   runs. `lib/strategies/execute.ts` and every venue's write path are not
   touched.
4. Investor mode renders exactly as before. A snapshot of `app/app/page.tsx`
   in Investor mode is the regression test.

## Non-goals (do not build)

- A separate route. `/app` stays the one URL; see D1.
- New venues. Uniswap LP is a separate build (D9). The USDC vaults not named
  in the request are not added to the Earn grid unless confirmed (D3).
- New strategy kinds. A play is a preset over earn, leverage or ladder.
- Mobile navigation for Trader mode. The sidebar nav is desktop-only today
  and `docs/mobile-build-plan.md` owns that question.
- Hardcoded numbers in copy. A thesis states the mechanism; the live figure
  beside it carries the number.

## Decisions

**D1. Mode is state in the signed-in shell, not a route.** `SignedIn` in
`app/app/page.tsx` already holds the balance reads, the cross-chain scan,
the earn positions and the section state; Trader mode needs all of them. A
`mode` state ("investor" | "trader") sits beside `activeSection`, read from
`lib/ui/use-app-mode.ts`, the same external-store-over-localStorage pattern
`use-view-mode.ts` uses (key `aeras.app.mode`, server snapshot "investor").
Trader mode keeps its own `traderSection` state so switching back and forth
returns each mode to where it was. A `/app/trade` route was considered and
rejected: it needs the shell lifted out of a 1,600-line page, four days
before the feature freeze, for no benefit a user can see.

**D2. The switch is a two-segment control under the logo**, in the sidebar
header on desktop and the top bar on mobile, labelled "Investor" and
"Trader". Nothing else about the sidebar changes: total balance, the
addresses and sign out stay. In Trader mode the nav shows four items: Earn,
Buy + Earn, Strategies, Portfolio. Selling, sending, withdrawing to another
wallet, hedging and perps are Investor-mode actions, one switch away, and
the Portfolio section says so under its positions.

**D3. Earn grid content, as requested: shMON now, Uniswap LP when built.**
The grid is a registry (`lib/trader/earn-venues.ts`) of card descriptors:
id, name, chain, logo, the asset in, the asset out, a rate reader, a TVL
reader, a position reader, and the component that renders the venue's own
form. shMON's descriptor reads `fetchShmonMetrics` and `useShmonEarn` and
mounts `ShMonadCard`, which already carries stake, both exits and the way
home. *Open for confirmation:* the USDC vaults the repo already runs (Morpho
Hyperithm on Monad, Jupiter Lend, Kamino, Blend) fit the same descriptor and
would give the grid five cards instead of one. Recommended: add Morpho on
Monad and Blend, both Monad venues, since the launch is Open by Monad and a
grid with one card reads as an empty page. Their forms are sub-components
of `EarnPanel.tsx` and need exporting; about half a day for the pair.

**D4. Buy + Earn cards are `useStrategyRates().rows`, one per asset.** The
same fourteen assets the Strategies page lists, in the same order, priced by
the same hook. Card: logo, name, symbol and venue pills, the net rate on
equity at the safe maximum ratio (`earnNetApy` with `maxBorrowRatio`, see
D11) as the headline, then "Borrow x%" and "Earn y% in <venue>" under it,
the ratio it borrows at, and "Borrow up to z%" from the route's collateral
factor. A card whose spread is at or
below zero stays on the grid, greyed, with both numbers, per the rule in
`docs/buy-strategies-plan.md`: never hide the strategy, never show a rate
without its components. A saved run on the asset badges the card "Open" or
"Resume", as the strip does. Search and a sort (net rate, borrow rate,
name) sit above the grid.

**D5. Opening a card is a detail view, not a row expansion.** The grid
gives way to one asset: a back link, the asset header priced live, then two
columns. Left: `EarnTicket`, unchanged, keyed by mint. Right: "Your
position", a new `components/trader/PositionSummary.tsx` reading the saved
run (`pickRun`) and the live borrow position (`useBorrowPositions`, the read
`PositionsPanel` already does) to show exposure, debt, health, liquidation
drop, the earn deposit and its value, and the run's step list when one is
landing. The Close action stays on the ticket, where it is today; the
summary points at it. Same shape for Earn (D3) and Strategies (D6).

**D6. A play is a preset, in a registry, over the three strategy kinds.**
`lib/strategies/plays.ts` exports `PLAYS: Play[]`:

```ts
interface Play {
  id: string;
  name: string;            // the card title
  thesis: string;          // one to three sentences, mechanism not adjectives
  tag: "Carry" | "Leverage" | "Conviction" | "Diversify" | "Crypto" | "Rotation";
  mint: string;            // the asset bought first
  preset:
    | { kind: "earn"; venue?: EarnVenue; ratio?: number }
    | { kind: "leverage"; leverage: number | "max" }
    | { kind: "ladder"; nextMint?: string; ratio?: number };
  steps: [string, string, string];  // what happens, in order, for the detail
  risk: string;            // the one thing that loses money here
}
```

A play resolves at render against `useStrategyRates`: its asset must have a
route and, for an earn play, its venue must be in `earnOptions`. A play that
does not resolve renders greyed with the reason ("Bitwise boost has ended",
"NVDAx market unavailable") rather than vanishing. The headline figure is
the kind's figure from `lib/strategies/math.ts`: net rate for earn, the
multiple for leverage, the ladder's converged leverage and debt for ladder.
`plays.test.ts` pins every play to a resolvable mint and, for ladders, a
`nextMint` in the catalog.

The tickets gain additive props so a play can pre-fill them: `EarnTicket`
takes `initialVenue` and `initialRatio`; `LeverageTicket` takes
`initialLeverage`; `LadderTicket` takes `initialRatio` and
`initialNextMint`. Each seeds the `useState` initialiser it already has.
Nothing downstream of the state changes.

Launch set, for editing:

| Play | Kind | Asset | Preset | Tag |
|---|---|---|---|---|
| Nvidia pays its own carry | earn | NVDAx | Hyperithm USDC on Monad, default ratio | Carry |
| The index, twice | leverage | SPYx | 2x | Leverage |
| Nasdaq at the limit | leverage | QQQx | max | Leverage |
| Tesla, then more Tesla | ladder | TSLAx | same asset each round | Conviction |
| Stocks buy gold | ladder | NVDAx | first pick PAXG, which ends the ladder | Diversify |
| Apple funds the Nasdaq | ladder | AAPLx | first pick QQQx | Diversify |
| The Monad believer | earn | SPYx | shMON staking, with the currency warning | Crypto |
| Mag 7, paid to wait | earn | QQQx | Bitwise Mag7X, only while the boost is live | Rotation |

Thesis lines follow the writing rules: declarative, a mechanism per
sentence, the risk named. "Nvidia pays its own carry": *Hold NVDAx. Borrow
USDC against half of it. Put the loan where it earns more than it costs. The
stock stays yours and the spread is the yield; the risk is the stock falling
past the liquidation line, which the ticket prices before you sign.*

**D7. Visual language is Aeras night glass, with the screenshots' structure.**
Taken from them: an equal-card grid with the headline figure set large; a
pill naming the pair or venue under the title; the detail page split into a
form on the left and "Your position" on the right; a tabbed form (Open and
Close, in place of Zap, Pair and Withdraw); a preview block that shows the
split before signing, which `PreviewBlock` already is. Not taken: the cream
and lime palette, the terminal window chrome, the `~/assets` framing. Cards
are `GLASS_SURFACE`, figures are Geist Mono tabular, the headline figure is
`text-3xl font-light`, chain and venue pills reuse `CategoryPill`'s shape,
the primary button is `PRIMARY_BUTTON` with `aeras-press`. Green appears on
a positive net rate and nowhere else; a negative spread is `aeras-warning`.
Copy: no em dashes, no adjectives that are not facts, and "fun" is carried
by the play names and the thesis, not by exclamation.

**D8. Nothing in Investor mode moves.** No component is edited for Trader
mode except the three tickets' additive props and `app/app/page.tsx`, which
gains the mode state, the switch, and one branch that renders
`components/trader/TraderShell.tsx` in place of the section switch. Trader
components live in `components/trader/`; the registries in `lib/trader/`
(earn venues) and `lib/strategies/plays.ts` (plays, beside the math they
call).

**D9. Uniswap LP is a separate build and does not make the freeze.** The
research is done (see the Uniswap note: Robinhood Chain 4663, USDG-quoted
stock pools, Uniswap's LP API, no cross-chain route to a stock token). It is
the largest venue so far: a new chain in Privy and the Trustware proxy, a
new keyed API, per-user position storage, a two-token deposit with
impermanent loss. `docs/uniswap-lp-plan.md` is the next step for it. The
Earn registry (D3) and `EarnVenue` are built so a "uniswap" card and an
"Earn the spread" play (buy NVDAx, borrow USDC, provide NVDA/USDG) drop in
when it lands.

**D10. Feature freeze is 2026-09-25.** Slices 0 to 2 below are the freeze
target; slice 3 is polish that can land after. Each slice is one session.

**D11. Trader borrows at the safe maximum.** Asked for on 2026-09-22, after
the build: every Buy + Earn card, every earn and ladder play, and every
ticket opened from Trader mode sizes the loan at `maxBorrowRatio` in
`lib/strategies/math.ts`, which is 90% of the collateral factor, the same
ceiling the borrow forms and the ratio slider already enforce, floored to
the slider's hundredth so the card, the slider and the run agree. That is
the biggest net rate the position can show, and the smallest cushion: on
the Jupiter markets health lands near 1.3 and the price can fall about 21
to 23% before liquidation. The card states the ratio it borrows at, the
ticket states health and the drop before signing, and the slider still
moves. A play names a `ratio` only to borrow less on purpose. Investor
mode keeps its half-of-CF default, per D8.

**D12. Buy + Earn is three tiers, and the venue picker goes to the plays.**
Asked for on 2026-09-22, after D11: a Buy + Earn card reads "Buy Tesla,
earn up to Y%", and the borrowed USDC goes into one of three tiers, ranked
in the order given, in `lib/trader/tiers.ts`: **1, Portfolio**, the
Bitwise Mag7X basket on Base with its boost; **2, Staking**, the loan
converted to a chain's own token and staked, MON today; **3, Liquidity
pools**, the loan into a Uniswap stock pool for its fees. Y is the best
tier's net rate at the safe maximum borrow (`bestTier`), and a tier with
nothing built or nothing answering never contributes to it. The detail
shows the three tiers priced, with each one's mechanism and risk, and the
existing `EarnTicket` on the chosen tier with that tier's option as its
only venue, so the five-venue picker Investor mode's ticket carries does
not appear here: the vault destinations (Hyperithm, Jupiter Lend, Kamino)
are plays, not Buy + Earn. A saved run's own venue is always passed through
so its close path withdraws from the venue that holds the money.

What is built into the tiers today and what is a slot: tier 1 runs
(Glider, while the boost is live and once its live test is done); tier 2
runs on shMON, with ETH staking and BTC staking as planned slots, since no
ETH or BTC staking venue exists in the repo; tier 3 is a planned slot
until the Uniswap LP venue is built (D9), and the grid says "soon" rather
than showing a rate nothing backs. The tier labels are the ranks and what
each holds; the UI does not call the portfolio tier "safest", because it
is equity exposure, and the risk line on each tier says what it is.
`tiers.test.ts` pins the ranking, the pricing, the states and the copy.

**D13. Trader mode names no lending venue.** Asked for on 2026-09-22: the
Trader cards, details and position column do not say Jupiter Lend or
Kamino, and the shared tickets drop the venue from their step labels,
previews and notes when rendered under `VenueNames.Provider value={false}`,
which `TraderShell` provides. The context lives in
`components/strategies/shared.tsx` with a default of `true`, so Investor
copy is unchanged to the character. The venue still decides the route,
the rates and the signatures; only the words are gone. A step label is
saved with the run, so a run opened in Trader mode reads without the
venue on the Investor Strategies page too, which is the record of what
the user saw. The Portfolio section's positions view is the Investor
component and still names venues there, because on that surface the
venue is the answer to where the money is; say the word to hide it.

**D14. Clean cards, exposures as marks.** Asked for on 2026-09-22 after
seeing the surfaces live ("TMI, make it clean, add the logos to show most
of the exposures"). A Buy + Earn card is now the asset, the "earn up to"
figure with the venue it comes from, and an exposure strip: the asset's
mark, an arrow, the marks of what the loan becomes (the eight Mag 7
holdings as the xStocks that track them, shMON, and so on, from
`lib/trader/exposures.ts` and `components/trader/ExposureStrip.tsx`).
The tier list, the ratio and the "borrow up to" foot line are gone from
the card; the tier picker in the detail is rank, name, marks and figure,
with the chosen tier's risk as one line under the row. A play card is its
strip, its name, its thesis and its figure. A play detail mounts the
ticket on the play's venue alone, so no venue picker shows, and the thesis
card is the thesis and the risk without the numbered steps. The shared
`EarnTicket` gained a compact presentation through the same context as
D13 (`TicketPresentationContext`, `compact: true` under `TraderShell`):
no venue picker, no "Steps" row, and a short form of the Mag7X note. The
attestation checkbox stays, because the enroll route refuses without it.
Uniswap and BTC have no mark on disk yet and draw as letter badges.

**D15. The run drawn, with the borrow as created money.** Asked for on
2026-09-22 ("add logos for the assets and use something to show borrow /
creation of more funds"). Every ticket opened in Trader mode draws its
run above the preview as marks joined by arrows: the USDC put in, the
stock bought, a dashed green "borrow" edge carrying the money it creates
("+$58.00", or "+58% of its value" before an amount is typed), the new
USDC, and where it goes (the Mag 7 marks, shMON, a USDC vault). Leverage
draws the borrow first and one buy of the whole exposure; a ladder draws
two rounds and folds the rest into a "n rounds" node with the total. The
figures are the ticket's own, handed through a `flow` slot on the
presentation context (`lib/strategies/ticket-flow.ts` is the contract,
`lib/trader/flow.ts` the builder, `components/trader/StrategyFlow.tsx`
the drawing), so Investor mode, which sets no slot, is unchanged. The
position column carries marks too: the asset on "posted", USDC on
"owed", the destination on "the loan is earning". `flow.test.ts` pins
the arithmetic and the shape.

**D16. No captions.** Asked for on 2026-09-22, in strong terms: nothing
small under a figure. The headline on a play card and detail is the
figure and its label alone (no "58% of the stock's value into PAXG", no
"one transaction, borrowing at 5.69%"); the "earn up to" on a Buy + Earn
card carries no venue line, since the strip shows the destination. The
drawn flow is marks and verbs only: no "You put in", no "held as
collateral", no "+58% of its value"; an edge reads "buy NVDAx", "borrow
USDC" (dashed green, with the created figure once an amount is typed),
"deposit", "stake" or "buy", and a mark carries a number under it only
when the ticket has one. The USDC vaults draw as the venue's mark, not as
USDC: Morpho with the Hyperithm mark beside it, Jupiter Lend and Kamino
as their own marks, so "the Morpho sign" is what a vault deposit shows
and the curator is still there, as a mark.

**D17. Uniswap liquidity pools are a live destination.** The venue landed
on 2026-09-22 (`lib/uniswap`, `docs/uniswap-lp-plan.md`) and is now wired
into all three Trader surfaces, which supersedes that plan's note that it
would never be a Buy + Earn option.

- **Rates.** `EarnVenue` gains `"uniswap"`. `useStrategyRates` prices every
  *depositable* pool at its own fee APR (`feeApr7d ?? feeApr24h`) into
  `uniswapOptions`, best first, and puts the best-paying one in
  `earnOptions` as the venue's entry, since those are keyed by venue. A
  pool with no measured volume has no rate and is dropped, never shown as
  zero. `pickDefaultEarn` excludes it: a pool's fee rate is not a spread
  against a dollar loan, for the same reason a MON stake is not.
- **Tier 3** of Buy + Earn is now live on it, and `bestTier` will pick it
  when its fees beat the other two, which on the thin Robinhood Chain
  pools they usually do by a wide margin.
- **Two plays**, tagged `Fees`: "Own Nvidia, charge the traders"
  (NVDA/USDG) and "The index pays its own rent" (SPY/USDG). A play may
  name a `poolId`, which resolves against `lib/uniswap/pools.ts` and must
  be depositable; `resolvePlay` blocks it when *that* pool has no rate,
  not merely when the venue has one.
- **The Earn grid** gets a second card for the venue, opening onto
  `UniswapPoolsCard`. Its `positionKey` is a prefix, because the venue has
  a position row per pool and the card sums them.
- **Marks.** A pool draws as its own pair (`poolMarks`), not as the
  Uniswap logo, because the money really is in both tokens. The flow's
  verb for it is "pool".
- **Execution** reuses the venue's own path: `depositFromSolana` for the
  deposit, and a new `exitPositionToSolana` in `lib/uniswap/withdraw.ts`
  for the close, which takes the whole position out and sends both sides
  home as USDC. Whole positions only: a range is not a balance, so a
  partial withdrawal cannot be sized to a repayment.

**Two things this venue does not share with the others, and both are
stated in the ticket.** Its rate is trading fees, not a deposit rate, and
the impermanent loss taken to earn it is not netted off the headline. And
its position is two assets, so it can be worth less than the loan while
still earning. **The fee APRs on the thin pools are very large** (193% on
USDG/META when first measured) and move with a week of volume against a
small TVL; they are the venue's own measured figures, the same ones the
Investor card shows, and nothing caps or smooths them today.

## Status (2026-09-22)

Slices 0 to 2 are built and verified on a preview route against the live
reads: every section rendered with live figures, every play resolved, the
play and Buy + Earn details opened their tickets pre-filled, and tsc, lint
and the suite (469 tests) pass. Confirmed on the day: Investor stays the
default, the Earn grid is shMON until Uniswap lands, the eight plays stand
as written, and Uniswap LP is its own build after the freeze. Nothing in
Trader mode has signed a transaction; each ticket's first live run is the
manual test its own doc describes. Slice 3 is open.

## Slices

Every slice ends with `npx tsc --noEmit`, the test suite, and a render check
on a temporary preview route (the pattern in the signed-in UI note), deleted
before commit. Commit with `git commit --only -- <paths>`.

- [x] **0. Mode switch, Trader shell, Portfolio, Earn grid with shMON.**
      `lib/ui/use-app-mode.ts`, the segmented control, `TraderShell.tsx`
      with its four-item nav, Portfolio mounting `WalletPanel` and
      `PositionsPanel`, `lib/trader/earn-venues.ts` with the shMON
      descriptor, `EarnGrid.tsx` and `VenueCard.tsx`, and the detail view
      mounting `ShMonadCard` beside `PositionSummary` in its earn shape.
      Test: switch modes, reload, mode persists; Investor renders unchanged;
      the shMON card's APY, TVL and position match the Investor Earn tab.
- [x] **1. Buy + Earn grid and detail.** `BuyEarnGrid.tsx`, `AssetCard.tsx`,
      search and sort, the detail with `EarnTicket` and `PositionSummary` in
      its strategy shape. Test: every card's net rate equals the Strategies
      page row for the same asset; a card with a negative spread shows both
      components; a saved run badges its card; opening a card and pressing
      Buy + Earn runs the same steps the Strategies page runs.
- [x] **2. Plays.** `lib/strategies/plays.ts` and `plays.test.ts`, the
      additive ticket props, `PlaysPanel.tsx`, `PlayCard.tsx` and the play
      detail (thesis, steps, risk, pre-filled ticket, position). Test: each
      play's ticket opens with the preset applied; a play whose venue is
      absent (unset `GLIDER_API_KEY`, say) renders greyed with the reason;
      the pinned tests pass.
- [ ] **3. Polish.** Loading skeletons on the grids, empty states, the
      position summary's live health tone (neutral, amber, red), the
      Morpho-on-Monad and Blend Earn cards if D3 is confirmed, and the
      Uniswap card slot.

## Questions that change the work

1. **Default mode.** Investor, as planned. Or Trader for everyone, with
   Investor behind the switch?
2. **Earn grid.** shMON only until Uniswap lands, as requested. Or also the
   Monad USDC venues already built (recommended), or all five USDC vaults?
3. **The launch plays.** The eight above, or edit names and picks. The
   Glider play stays gated on the boost and on the venue's live test.
4. **Uniswap LP.** Confirm it is its own build after the freeze.

## Standing constraints

- CLAUDE.md governs. Every broadcast goes through `sendAndConfirm`, every
  built transaction sets a compute unit price, every rate is a decimal until
  it is formatted, and no user-facing copy uses an em dash or a marketing
  adjective.
- Never index a Privy wallets array. Sign through the hooks the tickets
  already use.
- `loop_positions` and `strategy_runs` are display-only. Nothing read from
  them sizes a transaction. A play card's "Open" badge is a label, not a
  balance.
- Investor mode is the regression baseline. If a Trader change needs an
  Investor component to change shape, stop and say so.
