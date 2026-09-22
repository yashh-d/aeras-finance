# shMON staking on Monad: build plan

shMON (FastLane's liquid staking token for Monad) as a fifth Earn venue, funded
in one click from the user's Solana USDC through Trustware and the Privy
embedded EVM wallet, with both of shMON's exit paths and a way home to Solana,
and offered as an earn venue inside the Buy + Earn strategy. This file is the
plan, the record of what was verified while writing it (2026-09-22), and the
operating rules for building it without the product owner in the loop.

Read CLAUDE.md first. Then `lib/morpho/fund.ts`, `lib/morpho/deposit.ts`,
`components/MorphoVaultsCard.tsx` and `components/AaveVaultsCard.tsx`: this
venue is those two venues' shapes pointed at a staking contract, and every
decision below that is not stated is "do what Morpho-on-Monad does".

## Summary

- **What the user sees.** A "shMON staking" card in the Earn tab under the
  Vaults table. Live APY (about 12% on 2026-09-22), the exchange rate, TVL, the
  user's position in shMON, MON and dollars. A Stake form that takes a USDC
  amount from the Solana wallet. A Withdraw panel with the two exits the venue
  offers: instant (a fee, today 0.92%) and queued (no fee, about a day). A
  "Move to Solana" action that turns unstaked MON back into Solana USDC.
- **The one click.** Enter USDC, press Stake. The app quotes and routes Solana
  USDC to native MON on Monad through Trustware (one Solana signature), waits
  for settlement, then calls shMON's payable `deposit` with the delivered MON
  less a gas reserve (one Monad signature). Both signatures are silent because
  `showWalletUIs` is off. No separate gas top-up leg exists: the delivered MON
  is the gas token.
- **Buy + Earn.** "shMON staking on Monad" appears in the Buy + Earn ticket's
  venue picker beside the three USDC vaults, with a currency-mismatch warning
  (the loan is USDC, the earn side is MON). It is never the default.
- **Everything settles the way Morpho-on-Monad does.** Shares sit in the
  embedded EVM wallet on Monad. Reads go through our own API routes. Trustware
  routes, Privy signs, the proxy's existing shape allowlist already admits
  every leg (see Facts), so no proxy change is needed.

## Goals

1. A user holding only Solana USDC can hold shMON and see it earn, with one
   press and no wallet UI.
2. Every exit the contract offers is offered, with its live cost and wait, and
   a path back to Solana USDC, so the venue is not a one-way door.
3. The rate shown is derived from the chain (share price growth), keyless,
   and agrees with FastLane's own figure within a reasonable tolerance.
4. The Buy + Earn strategy can send borrowed USDC here, with the risk stated.
5. `scripts/shmonad-check.mts` proves the registry, the math and the routes
   against live endpoints, and `lib/shmonad/math.test.ts` pins the math to
   figures measured and recorded here.

## Non-goals (do not build)

- Committing shMON to policies, boosts, holds, the "degen pool" zero-yield
  tranche, or anything under `commit`/`hold` in IShMonad. Plain stake and
  unstake only.
- Staking MON the wallet already holds, as a separate form. The Stake form
  takes USDC. (The deposit helper is generic; a "stake wallet MON" button is a
  two-line follow-up, not part of this build.)
- Direct Solana USDC to shMON routing through a DEX (see D2).
- A MON row in the Vaults table. The table is keyed by Solana earn assets and
  every cell is a stablecoin or SOL vault; a MON-denominated position with an
  unbonding path belongs in its own card.
- shMON as collateral anywhere, shMON in the swap registry, shMON in the
  wallet panel as a token row (it is an earn position and shows through
  `lib/positions/earn.ts` like Morpho shares).
- Any change to the Privy config. Monad is already in `supportedChains`.

## Facts verified on 2026-09-22 (block 106,886,926, 00:02 UTC)

Read live from Monad mainnet (chainId 143) through `https://rpc.monad.xyz`
and the configured `MONAD_RPC_URL`, from the docs at docs.shmonad.xyz, and from
the interfaces in FastLane-Labs/fastlane-contracts (`src/shmonad/interfaces/
IShMonad.sol`, `IERC4626Custom.sol`). Pin every number in code to a comment
carrying this date; the check script re-reads all of them.

| Fact | Value |
|---|---|
| shMON contract, mainnet | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` (docs.shmonad.xyz/addresses; `name()` "ShMonad", `symbol()` "shMON", `decimals()` 18) |
| `asset()` | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`, the native-MON alias. Deposits are native MON, not an ERC-20. |
| Deposit | `deposit(uint256 assets, address receiver) payable returns (uint256 shares)`. `msg.value` must equal `assets`. Estimated 75,095 gas at 102 gwei (0.0077 MON). `maxDeposit` is 2^128 − 1. |
| Exchange rate | `convertToAssets(1e18)` = 1.623863 MON per shMON. `previewDeposit(1e18 MON)` = 0.615772 shMON. `totalAssets` 336.6M MON, `totalSupply` 207.3M shMON. |
| Yield | Auto-compounded into the rate every epoch (about 5.5 h per the docs; 1,590 epochs a year). No rebasing, no claiming. Sources: staking rewards, MEV, atomic unstake fees. FastLane commission: 5% of staking rewards (`getAdminValues` stakingCommission 500 bps), 25% on boost, 10% MEV handler fee (docs). |
| Measured APY | Share price grew 0.1653% over 126.9 h (block 105,374,926 to 106,886,926): APR 11.41%, APY 12.07%. Over the last 18.1 h: APY 12.40%. |
| History depth | `rpc.monad.xyz` serves `eth_call` at blocks about 7 days back; 30 days fails. `MONAD_RPC_URL` (Alchemy) serves about 1 day; 7 days fails. `eth_getLogs` on the public node is capped at a 100-block range. |
| Instant exit | `redeem(shares, receiver, owner)` and `redeemWithSlippageProtection(shares, receiver, owner, minAmountOut)` burn shMON and pay MON at once, minus a fee. `previewRedeem(1e18)` = 1.609083 MON; `previewRedeemDetailed(1e18)` = gross 1.623863, fee 0.014781, net 1.609083. |
| Instant fee | Affine in pool utilization, in RAY: fee = yIntercept + slope × utilization. `getFeeCurveParams()` = slope 1e25 (1.00%), yIntercept 5e22 (0.005%). `getCurrentUnstakeFeeRateRay()` = 9.1857e24 = 0.9186% at utilization 0.9136 (`getAtomicUtilizationWad`). Cap = 1.005%. |
| Instant capacity | `getAtomicPoolUtilization()` = utilized 6.150M, allocated 6.732M, available **581,892 MON**, utilizationWad 0.9136. Target pool is 2% of equity (`getScaledTargetLiquidityPercentage` 2e16). `maxRedeem`/`maxWithdraw` for a non-holder return 0; what they return for a holder is unmeasured (no EOA holder with a balance was found in the last 3,000 blocks). |
| Queued exit | `requestUnstake(uint256 shares) returns (uint64 completionEpoch)`, then `completeUnstake()`. `getUnstakeRequest(address) returns (uint128 amountMon, uint64 completionEpoch)`. `previewUnstake(1e18)` = 1.623863 MON (no fee). Wait is 4 to 5 epochs, 22 to 27 hours (docs). The rate locks at request time: queued MON earns nothing while waiting. **One active request per account; a second request merges into it and restarts the wait.** Not cancellable. |
| Epoch counters | `getInternalEpoch()` = 1404 and `getEpochInfo()` = (2138, 0) are different counters. Which one `completionEpoch` is expressed in is unknown until a request is observed, so readiness is decided by simulating `completeUnstake()` (D6), never by comparing epochs. |
| Anti-gaming | Deposit and withdrawal use different rates on purpose: a deposit then an unstake in the same epoch returns less MON than went in (docs, exchange-rate page). The card shows both live values rather than promising par. |
| Slashing | Inactive on Monad; a circuit breaker trips at a 7% loss of protocol equity (docs). |
| MON price | Implied by Trustware: 25 Monad USDC bought 974.78 MON (about $0.0256). shMON about $0.0416. |
| Trustware, same-chain on Monad | USDC → native MON: lifi, 25 USDC → 974.78 MON, fees $0.066. Native MON → USDC: lifi, 500 MON → 12.73 USDC, fees $0.035. USDC → shMON: squid, 25 USDC → 599.12 shMON ($24.93). |
| Trustware, cross-chain | **Every Solana ↔ Monad quote answered 502 (a Cloudflare HTML page) across three attempts over five minutes, including the Solana USDC → Monad USDC shape verified live on 2026-08-25.** `GET /routes/chains` answered 200 and lists 143. This is an upstream outage at planning time, not a routing verdict. Slice 0 re-verifies. |
| Proxy shapes (`lib/trustware/server.ts`) | `funding`: toChain 143 and toToken in {Monad USDC, native MON}. `return`: toChain Solana and toToken USDC, any source. Both already exist, so native MON in and native MON out pass validation with no change. The proxy overwrites `toAddress` with the verified identity's wallet for the chain. |
| Privy | Monad is in `supportedChains`; `showWalletUIs` is false; `EvmSigner` in `lib/morpho/deposit.ts` is the signer shape. |

Not verified, and must be before the venue is shown to anyone:

- Trustware cross-chain quotes and routes for Solana USDC → native MON and
  native MON → Solana USDC (the outage above). The first is the shape the
  Morpho gas top-up already runs; the second has never been run from this app.
- The write path end to end: nothing was signed. Gas for `requestUnstake`,
  `redeem` and `completeUnstake` is unmeasured.
- Whether `maxRedeem(holder)` reflects pool availability or the holder's
  balance.

## Decisions

**D1. A card, not a table column.** `components/ShMonadCard.tsx` mounts in
`components/EarnPanel.tsx` under the Vaults/Looping row, full width, above
`RyskOptionsCard`. The page header's "Three ways to earn yield" becomes four
(staking). Reason: see Non-goals; the venue's unit, exit paths and price
exposure do not fit a USDC-keyed row.

**D2. Fund by minting, not by buying shMON.** The funding leg delivers native
MON and the app calls `deposit`. Trustware can deliver shMON directly (squid,
same-chain verified), but that path prices off a DEX pool: at 25 USDC it
returned 599.1 shMON where minting returns about 600.2, and at size it takes
price impact while `deposit` takes none. Minting also makes the delivered MON
the gas, so the Morpho venue's separate 0.5 USDC gas leg disappears here. The
check script still prints the direct quote for the record.

**D3. The gas reserve is `GAS_FLOOR_WEI` (0.1 MON), kept back from the
delivered MON.** A deposit costs 0.0077 MON, so the reserve covers the
deposit, both exits and the return leg's approval-free send with two orders of
magnitude to spare. Export the constant from `lib/morpho/fund.ts` rather than
duplicating it. If the wallet already holds more than the reserve, deposit the
full delivered amount.

**D4. Both exits, and the instant one is capped by the pool.** Instant redeem
uses `redeemWithSlippageProtection` with `minAmountOut` = `previewRedeemDetailed(shares).net`
less 0.25%, and the form caps shares at what `available` MON can pay at the
gross rate. Today that is 581,892 MON against a 6.7M target, at 91% utilization:
the pool is thin and the fee is near its cap, so the card states the live
capacity and fee beside the button rather than in a footnote. Queued exit uses
`requestUnstake` and `completeUnstake`.

**D5. One pending request is a state, not a form.** The Withdraw panel's queued
mode is a state machine in the shape of `AaveVenuePanel`'s Umbrella cooldown:
`none` (form) → `pending` (amount, "ready in about a day", a warning that a new
request merges and restarts) → `ready` (Complete button) → back to `none`.

**D6. Readiness is a simulation.** The position route calls `eth_call` of
`completeUnstake()` with `from` = the user; success with a non-zero pending
amount means `ready`, a revert means `pending`. Never compare `completionEpoch`
against either epoch counter for anything but the label, and label the wait in
words ("about a day") not a countdown.

**D7. APY from share price growth on-chain, 7-day window, 1-day fallback.**
`app/api/shmonad/metrics` reads `convertToAssets(1e18)` now and at a block
about seven days back (block estimate from 0.4 s block time, then the real
timestamps), annualises with the docs' own formula, and falls back to a one-day
window when the history call fails. The historical read goes to
`MONAD_HISTORY_RPC_URL`, a new optional server env defaulting to
`https://rpc.monad.xyz`, because the paid endpoint keeps a day of history and
the public one keeps a week. Cache 5 minutes, serve stale for 30 with
`x-aeras-stale: 1`. Both windows agreed within 0.4 points when measured.

**D8. Dollar figures use the native price feed.** `/api/prices/native` already
serves `monad`. Position value = shares × rate × MON price. The card fetches it
itself; nothing new upstream.

**D9. Buy + Earn gets shMON as an option with a warning, never as default.**
`UsdcEarnOption.venue` gains `"shmonad"`. `defaultEarn` and the "best of"
reduce exclude it, because `earnNetApy` assumes the earn side holds its dollar
value and this one does not. The ticket shows a warn-toned note when it is
picked. The close path uses the instant exit (a close has to finish in one
press) and then the return leg; if the pool cannot pay the position it fails
with a message that names the Earn tab's queued exit. No run-store migration:
`state` is jsonb and the server validates only the strategy kind.

**D10. Reuse over rewrite.** Export `connectMonad`, `waitForReceipt` and
`sendTx` (with a new optional `value`) from `lib/morpho/deposit.ts`, and
`GAS_FLOOR_WEI` plus the private `quoteFunding`, `fundingRequest` and
`broadcastFundingLeg` from `lib/morpho/fund.ts`. Do not move them into a
`lib/monad/` home in this build; note it as a follow-up in `docs/shmonad.md`.
The Trustware execution engine (`executeEvmRoute`, `submitTrustwareReceipt`,
`trackTrustwareSettlement`) is used as is.

**D11. The return leg is native MON → Solana USDC in one route, with a
two-leg fallback.** `executeEvmRoute` with `fromToken` = the zero address:
no approvals (native), and `buildEvmTxParams` already forwards `value`. If
Slice 0 finds Trustware will not route a native source cross-chain, the
fallback is the verified pair: same-chain MON → Monad USDC (`executeEvmRoute`,
lifi), then the existing `sendMonadUsdcToSolana`. Build whichever Slice 0
proves; keep the other as a documented alternative, not dead code.

**D12. Minimum and warnings.** Stake minimum 1 USDC. Warn below 5 USDC that
fees (about 0.3% plus a $0.03 fixed fee plus the Solana transaction) are a
noticeable share. The check script prints fees at 5, 25 and 100 USDC; adjust
the threshold to where fees exceed 2%.

## Architecture

### Flows

**Stake (from Solana USDC).**
1. Read fresh Monad balances (MON) through the position route, as
   `depositUsdcWithFunding` does, so a retry never re-buys what already arrived.
2. Quote Solana USDC → native MON (`fundingRequest` with `MONAD_NATIVE_TOKEN`).
   Preview: MON delivered (`toAmountMin`), shMON minted (`previewDeposit`),
   fees USD. Refuse if `toAmountMin` ≤ reserve shortfall.
3. Route, sign the base64 Solana transaction (`solana.signAndSendBase64`),
   submit the receipt, track to settlement (`broadcastFundingLeg`,
   `trackTrustwareSettlement`).
4. Poll the position route until `monBalanceAtomic` ≥ expected.
5. `connectMonad`, then `deposit(assets, owner)` with `value = assets`, where
   `assets = monBalance − GAS_FLOOR_WEI` (or the delivered amount when the
   wallet was already above the reserve). Wait for the receipt. Done, with the
   Monad explorer link.

Stages reported through `MorphoTxProgress`'s shape (`funding`, `switching`,
`depositing`, `confirming`, `done`); reuse the type.

**Instant exit.** Read `previewRedeemDetailed(shares)` and the pool's
`available`; cap; `redeemWithSlippageProtection`. MON lands in the wallet.

**Queued exit.** `requestUnstake(shares)`; the panel moves to `pending`. On
the next reads, `ready` when the simulation passes; `completeUnstake()`.

**Move to Solana.** Native MON (wallet balance minus the reserve) → Solana
USDC via the return shape (D11). Shown whenever the Monad wallet holds more
MON than the reserve, so MON from either exit has a way home.

**Buy + Earn open.** Steps buy → collateral → earn, where the earn step for
`shmonad` is the Stake flow sized to the borrowed USDC less the 400 bps fee
headroom `depositUsdcToEarn` already applies for Morpho. **Close.** Instant
redeem all → Move to Solana → repay (existing step).

### Files

New:

```
lib/shmonad/constants.ts      address, decimals, native alias, fee-curve RAY
                              scale, EPOCH_HOURS_APPROX (5.5, copy only),
                              GAS reserve re-export, MONAD_HISTORY_RPC_URL
lib/shmonad/abi.ts            the subset called: deposit (payable), balanceOf,
                              convertToAssets, convertToShares, previewDeposit,
                              previewRedeemDetailed, previewUnstake,
                              redeemWithSlippageProtection, requestUnstake,
                              completeUnstake, getUnstakeRequest,
                              getAtomicPoolUtilization,
                              getCurrentUnstakeFeeRateRay, getFeeCurveParams,
                              getInternalEpoch, getAdminValues, totalAssets,
                              totalSupply, name, symbol, decimals, asset
lib/shmonad/math.ts           pure: rateFromConvert, feeRateFromRay,
                              feeRateAtUtilization, apyFromGrowth (APR and
                              APY), sharesToMon, monToShares,
                              instantCapacityShares, unstakePhase
lib/shmonad/math.test.ts      pins to the Facts table
lib/shmonad/server.ts         server-only batched reads (plain JSON-RPC POST,
                              matching app/api/morpho/position): metrics and
                              position, including the completeUnstake
                              simulation and the historical rate read
lib/shmonad/client.ts         browser fetchers for the two routes
lib/shmonad/stake.ts          write path over EvmSigner: stakeMon,
                              redeemInstant, requestUnstake, completeUnstake
lib/shmonad/fund.ts           planStake (quote + sizing) and stakeFromSolana
                              (the Stake flow above); maxStakeUsdcAtomic
lib/shmonad/unwind.ts         sendMonToSolana (D11) and its quote
lib/shmonad/use-shmonad.ts    metrics + position + MON price, polled at 60 s,
                              refresh after actions
app/api/shmonad/metrics/route.ts
app/api/shmonad/position/route.ts
components/ShMonadCard.tsx    header, position, Stake form, Withdraw panel,
                              Move to Solana
scripts/shmonad-check.mts
docs/shmonad.md
public/logos/shmonad.png      from https://shmonad.xyz (apple-touch-icon or
                              favicon); if no PNG can be fetched, use
                              /logos/monad.png and say so in docs/shmonad.md
```

Changed:

```
lib/morpho/deposit.ts         export connectMonad, waitForReceipt, sendTx
                              (+ optional value)
lib/morpho/fund.ts            export GAS_FLOOR_WEI, quoteFunding,
                              fundingRequest, broadcastFundingLeg
lib/tokens/logos.ts           VENUE_LOGOS.shmonad
lib/positions/earn.ts         EarnSnapshot gains shmonad position + metrics;
                              readEarnVenues reads them (evmAddress-gated);
                              earnRows adds "shMON · Monad" (amount in shMON,
                              usd via MON price, note "x% APY")
components/EarnPanel.tsx      mount the card; header copy
lib/strategies/rates.ts       EarnVenue "shmonad"; option from metrics;
                              excluded from defaults (D9)
lib/strategies/execute.ts     depositUsdcToEarn, readEarnPositionUsdc,
                              withdrawUsdcFromEarn branches for shmonad
components/strategies/EarnTicket.tsx
                              warn Note when shmonad is picked; step labels
CLAUDE.md                     see Slice 5
```

The MON price for `lib/positions/earn.ts` and `readEarnPositionUsdc`: read
`/api/prices/native` inside `readEarnVenues` (one fetch, gated on the shMON
share balance being non-zero so the common case costs nothing).

## Slices

Each slice ends with `npx tsc --noEmit`, `pnpm test:run`, the check script
where the slice touches a live integration, and a commit of that slice's files
only (see Operating rules). Do not start the next slice with the previous one
failing.

### Slice 0. Verify, registry, math

- `lib/shmonad/constants.ts`, `abi.ts`, `math.ts`, `math.test.ts`.
- `scripts/shmonad-check.mts`, run as
  `set -a; . ./.env.local; set +a; npx tsx scripts/shmonad-check.mts [evmAddress]`.
  It must print, and assert where marked:
  1. Registry vs chain: `name`, `symbol`, `decimals` = 18, `asset()` = the
     native alias. **Assert.**
  2. Rate and previews for 1e18: `convertToAssets`, `previewDeposit`,
     `previewRedeemDetailed`, `previewUnstake`. Assert net + fee = gross.
  3. Fee curve: `getFeeCurveParams`, `getAtomicUtilizationWad`,
     `getCurrentUnstakeFeeRateRay`. Assert `feeRateAtUtilization` reproduces
     the contract's figure to 1e-9.
  4. APY: 7-day and 1-day windows through `MONAD_HISTORY_RPC_URL`; print
     which succeeded. Assert at least one does and that APY is between 0 and
     50%.
  5. Trustware quotes: Solana USDC → native MON at 5, 25 and 100 USDC (print
     delivered MON and fees USD); native MON → Solana USDC at 100 MON; the
     same-chain fallbacks; the direct USDC → shMON quote for the record.
     Then `/route` for the Solana-source leg (assert base64 `data`, no `0x`)
     and for the native-MON-source leg (assert `value` present, no usable
     approvals). Routes create intents and move nothing. On a 502, retry
     three times five minutes apart, then report the outage and exit
     non-zero; the build continues (see Operating rules) but the doc records
     it as unverified.
  6. Gas: `eth_estimateGas` for `deposit(1e18)` with `value` = 1e18 from any
     address (assert about 75k), and assert that `value` ≠ `assets` fails.
     With a holder address (argv, or one found by scanning `Transfer` logs in
     100-block windows for an EOA with a balance): `requestUnstake`,
     `redeem`, `redeemWithSlippageProtection`, `completeUnstake`,
     `maxRedeem`, `maxWithdraw`, `getUnstakeRequest`. Print; record in the
     doc.
  7. Epoch counters: `getInternalEpoch`, `getEpochInfo`, `getGlobalPending`.
     Print.
- Tests pin: rate 1.623863 from `1623863471383778647n`; fee 0.9186% from
  `9185666628676110910000000n`; the curve at utilization
  `913566640436094698n` equals that fee; APR 11.41% and APY 12.07% from
  `1621184296758721965n` → `1623863499756773368n` over 456,840 s (tolerance
  5e-4); `unstakePhase` for none, pending, ready; `instantCapacityShares` for
  a position above and below the pool.

Acceptance: check sections 1 to 4, 6 (deposit) and 7 pass; tests pass; tsc
clean. Section 5's outcome is written into `docs/shmonad.md` either way.

### Slice 1. Read layer

- `lib/shmonad/server.ts`, the two routes, `client.ts`, `use-shmonad.ts`.
- Position route body: `sharesAtomic`, `monAtomic` (convertToAssets),
  `instantNetMonAtomic` and `instantFeeMonAtomic` (previewRedeemDetailed),
  `queuedMonAtomic` (previewUnstake), `walletMonAtomic`, `pending: {amountMon,
  completionEpoch} | null`, `ready: boolean` (D6), `poolAvailableMonAtomic`,
  `feeRate` (decimal). Per-address cache 5 s, stale 5 min. 400 on a bad
  address.
- Metrics route body: `rateMonPerShare`, `apy`, `apr`, `windowHours`,
  `windowStale: boolean` (true when the 1-day fallback was used),
  `tvlMon`, `totalShares`, `feeRate`, `feeCap`, `poolAvailableMon`,
  `poolAllocatedMon`, `utilization`, `internalEpoch`, `stakingCommission`.
- `lib/positions/earn.ts` row. Verify the wallet card and the Portfolio tab
  both draw it by reading the code paths (`use-earn-positions.ts`,
  `use-positions.ts`); no new consumer wiring should be needed.

Acceptance: `curl localhost:3100/api/shmonad/metrics` returns the shape with
a non-null `apy`; the position route for a random EVM address returns zeros
and `ready: false`; tsc and tests clean.

### Slice 2. The card: stake, exits, home

- `lib/shmonad/stake.ts`, `fund.ts`, `unwind.ts`, `components/ShMonadCard.tsx`,
  the `EarnPanel` mount, logo, header copy, and the exports listed under D10.
- Form rules: USDC amount with Max = Solana USDC × (1 − 300 bps), the same
  margin `maxFundableDepositAtomic` uses; slider when a balance exists, as the
  Morpho form does; preview rows for MON delivered, shMON minted, fees, and
  "keeps 0.1 MON for gas"; stage messages on the button while busy; error
  and done states in the Morpho form's shape, done linking the Monad explorer.
- Withdraw: a Withdraw/Stake mode switch like `VaultDetailHeader`; inside
  Withdraw, Instant and Queue tabs; the state machine from D5; capacity and
  fee shown live; a full exit redeems the exact share balance.
- Move to Solana: visible when wallet MON exceeds the reserve; quotes the
  guaranteed USDC floor before the button; runs D11.
- Disclosure paragraph under the form: what shMON is, that its value follows
  MON, the 5% commission, that slashing is inactive with a 7% circuit breaker,
  and that a same-epoch stake-then-unstake returns less than went in.
- Visual check, if a browser tool is available: the temporary route pattern
  (`app/preview-shmonad/page.tsx`, `"use client"`, mount `ShMonadCard` with
  `walletAddress={undefined}` and live hooks; open on the `aeras-preview`
  server, port 3100; delete the directory before finishing). Never start a
  second server on 3000.

Acceptance: the card renders with live metrics and no console errors
unauthenticated; every write path typechecks and is reachable only with a
wallet; the preview route is deleted; tsc, tests, and the check script pass
(section 5 excepted while Trustware is down).

### Slice 3. Buy + Earn

- `rates.ts`, `execute.ts`, `EarnTicket.tsx` per D9 and Architecture.
- `readEarnPositionUsdc` for shmonad: shares × rate × MON price.
- Close: `withdrawUsdcFromEarn` for shmonad redeems all instantly, then
  `sendMonToSolana`, and returns the delivered USDC; when
  `poolAvailableMonAtomic` is below the position's gross MON it throws
  "The instant exit pool cannot pay this position right now. Queue an unstake
  from the Earn tab and close once the MON has arrived." When shares are zero
  but wallet MON exceeds the reserve (a close retried after a queued exit),
  skip the redeem and bridge.
- Reconcile for the earn step stays the Solana-USDC-fell-by-half test.

Acceptance: the ticket lists the option with its APY and the warning; the
strip figure and `defaultEarn` are unchanged with the option present (write a
test in `lib/strategies` if one can be expressed purely, else assert by
reading); tsc and tests clean.

### Slice 4. Docs, CLAUDE.md, memory

- `docs/shmonad.md`: what shMON is in repo terms; the Facts table updated
  with what the check script found (gas for the exits, `maxRedeem` semantics,
  Trustware verification date or its absence); keys and env; what is built;
  decisions; traps (the epoch counters, the anti-gaming rate, the merge rule,
  the pool at 91%, history depth per endpoint); the follow-ups (a `lib/monad`
  home for the shared plumbing, a "stake wallet MON" button).
- CLAUDE.md: a Chain Assumptions paragraph ("shMON staking on Monad is the
  fifth exception", in the shape of the Morpho-on-Monad one); Repo Layout
  entries for `/api/shmonad` and `lib/shmonad` and `docs/shmonad.md`; a Built
  Since v1 entry; the Out of Scope venue list; and under the RPC section, the
  one-line note that Monad history depth differs by endpoint and
  `MONAD_HISTORY_RPC_URL` exists for it.
- `.env.example` (if present) gains `MONAD_HISTORY_RPC_URL` with a comment.

### Slice 5. Final pass

- `npx tsc --noEmit`, `pnpm test:run`, `pnpm lint` (advisory; do not chase
  pre-existing `react-hooks/set-state-in-effect` findings, but introduce none
  in new files: use the deferred-`setTimeout` pattern `runs-client.ts` uses).
- Re-run `scripts/shmonad-check.mts` and `scripts/morpho-fund-check.mts`
  (the second guards the exports in D10 changed nothing).
- Write the manual test script (below) into `docs/shmonad.md` with the
  amounts filled from the check script's fee table.

## Copy

House style applies (CLAUDE.md Writing Style). Names: "shMON staking",
"Monad" as the chain, "FastLane" as the issuer. Never "instant liquidity",
"seamless", "unlock". State the fee and the wait as numbers read live. The
warning in the Buy + Earn ticket, verbatim unless the numbers change:

> Earns in MON, not USDC. The loan is USDC. If MON falls, the staked value may
> not cover the loan, and closing pays the instant exit fee ({fee}% now). The
> rate shown is the staking APY in MON terms.

## Traps

- **Two epoch counters** (`getInternalEpoch` 1404, `getEpochInfo` 2138). D6.
- **The pool is 91% utilized at planning time.** Instant exits above about
  580k MON fail. Cap and say so. Expect the fee near 1%.
- **One request per account, merges and restarts.** Warn before a second
  `requestUnstake`; never send one from an automated path (Buy + Earn uses
  the instant exit only).
- **`msg.value` must equal `assets`.** Build the deposit from one variable.
- **The rate is not par and moves against a same-epoch round trip.** Show
  `previewRedeemDetailed` and `previewUnstake`, never `convertToAssets`, as
  what an exit pays.
- **History depth per endpoint.** The paid Monad endpoint serves a day; the
  public one a week; neither serves a month. D7's fallback order matters.
- **`eth_getLogs` is capped at 100 blocks** on the public node.
- **Trustware fees come off the delivered side** and the delivered token is
  the gas token: never deposit the whole wallet balance.
- **Never index the Privy wallets array**; sign through `useEmbeddedEvmWallet`
  and `useSendSolanaTxBase64`. Never capture the wallet object across a
  chain switch (`connectMonad` handles it).
- **Do not consult `maxDeposit`** (it is 2^128 − 1) and treat `maxRedeem`
  as unknown until section 6 of the check script says otherwise.

## Manual test (for the product owner, after the build)

With a wallet holding 10 USDC on Solana and a provisioned EVM wallet:

1. Earn tab, shMON card: APY, rate and TVL show; position reads 0.
2. Stake 5 USDC. Expect two silent signatures, stage messages, a Monad
   explorer link, and a position of about 5 / 0.0416 ≈ 120 shMON within a
   minute of settlement. Wallet panel's MON row shows about 0.1 MON.
3. Withdraw, Instant, half the position. Expect the fee row to match
   `getCurrentUnstakeFeeRateRay` and MON to land in the Monad wallet.
4. Withdraw, Queue, the rest. Expect `pending` with the amount; a day later,
   `ready` and Complete.
5. Move to Solana. Expect the USDC floor quoted, then USDC on Solana.
6. Strategies, any Jupiter asset, Buy + Earn, pick shMON: expect the warning,
   run with 10 USDC, then Close.

## Operating rules for the autonomous run

- **Git.** Work on the current branch. The checkout carries weeks of
  uncommitted work and a stash named `pre-integrate-test`; never run
  `git add -A`, `git stash`, `git checkout` or `git reset`, and never touch
  that stash. Commit each slice with `git add <explicit paths>` and a message
  `shMON: slice N, <what>` ending with the Co-Authored-By trailer. Do not
  push.
- **Servers.** The owner's `next dev` may be on port 3000; never start one
  there. Use `.claude/launch.json`'s `aeras-preview` (3100) if a browser check
  is possible; otherwise rely on `curl` against the routes with the dev server
  started on 3100 by `PORT=3100 pnpm dev` in the background, and stop it.
- **Env.** `.env.local` holds `MONAD_RPC_URL` and `TRUSTWARE_API_KEY`; load
  with `set -a; . ./.env.local; set +a`. Add no keys. Do not print values.
- **Blocked.** If Trustware stays 502 through Slice 0's retries, build every
  slice anyway (the shapes are verified from the Morpho venue), record the
  gap in `docs/shmonad.md` under "Not yet verified", and say so in the final
  report. If a contract fact contradicts this file, the chain wins: update
  the constant, the doc and the test, and note the discrepancy in the report.
- **Scope.** Non-goals stay out. Anything not covered here that the build
  needs is decided the way the Morpho-on-Monad venue decided it, and written
  down in `docs/shmonad.md` under Decisions.
- **Report.** End with: what was built, what each check printed (numbers),
  what is unverified, and the commit list.

## Kickoff prompt

```
Build the shMON staking venue exactly as docs/shmonad-plan.md specifies. Read
CLAUDE.md, then the plan, then lib/morpho/fund.ts, lib/morpho/deposit.ts,
components/MorphoVaultsCard.tsx and components/AaveVaultsCard.tsx before
writing code. Work slice by slice in order; each slice ends with tsc, tests,
the check script where it applies, and a commit of that slice's files only.
Follow the plan's Operating rules on git, servers, env and what to do when
blocked. Do not ask questions; decide as the plan says and record decisions in
docs/shmonad.md. Finish with the report the plan asks for.
```
