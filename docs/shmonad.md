# shMON staking on Monad

Read this before touching `lib/shmonad/`, `app/api/shmonad/`,
`components/ShMonadCard.tsx`, or the `shmonad` branches in
`lib/strategies/`. The plan that produced it, with the decisions numbered, is
`docs/shmonad-plan.md`; this file is the record of what is built and what was
verified. Everything marked *verified* was read live from Monad mainnet and
Trustware on 2026-09-22 by `scripts/shmonad-check.mts`, which re-verifies it
on demand:

```bash
set -a; . ./.env.local; set +a; npx tsx scripts/shmonad-check.mts [evmHolder]
```

The script creates Trustware route intents (which move nothing) and signs
nothing on chain. Pass a shMON holder's address to measure the exit paths'
gas from it; without one it scans recent Transfer logs for a holder.

Read CLAUDE.md first, in particular Chain Assumptions: this is the fifth venue
where a position lives off Solana, and the second on Monad. It is reached the
way Morpho-on-Monad is, through the embedded EVM wallet and a Trustware leg
from Solana USDC, and it reuses that venue's plumbing by import rather than
by copy.

## The two things to get right first

**shMON's asset is native MON, and `deposit` is payable.** `asset()` returns
the 0xEeee alias; `deposit(assets, receiver)` takes `msg.value`, and the
contract reverts when `msg.value != assets` (*verified*: the mismatched
estimate fails). There is no ERC-20 to approve, so a stake is one signature
on Monad, and the MON the stake delivers is also the gas that pays for it.
Nothing here runs the Morpho venue's separate 0.5 USDC gas leg; the stake
keeps `GAS_FLOOR_WEI` (0.1 MON) back from the delivered MON instead.

**The position is denominated in MON.** A user who stakes 25 USDC holds
about 600 shMON worth about 975 MON, and its dollar value moves with MON.
Every dollar figure the app shows for it is shares, at the exchange rate, at
the MON price from `/api/prices/native`; no price means no figure, never
zero. In the Buy + Earn ticket this is the venue whose earn side does not
hold the loan's value, so it is offered with a warning and is never the
default (`pickDefaultEarn` in `lib/strategies/rates.ts`, pinned by test).

## Facts, as of 2026-09-22

Block 106,892,988 (00:32 UTC), via `https://rpc.monad.xyz`.

| | |
|---|---|
| Contract | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`, `name()` ShMonad, `symbol()` shMON, 18 decimals. *verified* |
| Rate | 1 shMON = 1.623874 MON (`convertToAssets(1e18)`); `previewDeposit(1e18)` = 0.615771 shMON. TVL 336.97M MON, 207.49M shMON. |
| APY | 12.07% over 126.9 h and 12.39% over 18.1 h when first measured; 12.33% over the true 7-day window (169 h) once the block guess was corrected. Derived from share price growth with the docs' own formula (`apyFromGrowth`). |
| Yield mechanics | Compounded into the rate every epoch (about 5.5 h). Sources: staking rewards, MEV, atomic unstake fees. FastLane keeps 5% of staking rewards (`getAdminValues` stakingCommission 500 bps). *verified* |
| Instant exit | `redeemWithSlippageProtection(shares, receiver, owner, minAmountOut)`. Fee affine in pool utilization: intercept 0.005%, slope 1.00%, cap 1.005%; 0.9175% at 91.25% utilization when measured, and `feeRateAtUtilization` reproduces the contract's figure exactly. Pool available 588,956 MON of 6.73M allocated. *verified* |
| Queued exit | `requestUnstake(shares)` then `completeUnstake()`; `getUnstakeRequest(address)` = (amountMon, completionEpoch). 4 to 5 epochs, 22 to 27 hours (docs). One active request per wallet; a second merges and restarts the wait. The rate locks at the request. `completeUnstake` reverts before then. *verified* (the revert; the wait is the docs' figure) |
| Gas | deposit 75,095; requestUnstake 107,587; redeem 100,202; redeemWithSlippageProtection 98,840. At 102 gwei, about 0.01 MON each. *verified* from holder `0xec1fb66a…7228` |
| `maxRedeem`, `maxWithdraw` | For a holder below the pool they return the balance and its gross value, so they do not express the pool cap; the app caps instant exits itself (`instantCapacityShares`). *verified* |
| Epoch counters | `getInternalEpoch()` 1404, `getEpochInfo()` (2138, 0). Different counters; readiness is decided by simulating `completeUnstake()`. |
| History depth | Public node: `eth_call` served 2.4M blocks back (8.4 days), refused 2.8M; `eth_getLogs` capped at 100 blocks. `MONAD_RPC_URL` (Alchemy): about 1 day. Block time 0.302 s. *verified* |
| Trustware, Solana USDC → native MON | 5 USDC: relay, 190.33 MON, fees $0.032 (0.64%). 25 USDC: lifi, 964.67 MON, $0.070 (0.28%). 100 USDC: lifi, 3,858.67 MON, $0.258 (0.26%). Route carries a base64 Solana transaction. *verified* |
| Trustware, native MON → Solana USDC | 100 MON: lifi, 2.57 USDC, fees $0.01. Route carries `value`, `chainId` 143, no usable approval. The way home is one leg. *verified* |
| Same-chain fallbacks | Monad USDC → MON (relay) and MON → Monad USDC (lifi) both quote; not used. USDC → shMON direct (relay) delivered 594.6 shMON for 25 USDC, against about 600 by minting. *verified* |
| MON price | About $0.0256, implied by the quotes. |
| Proxy shapes | `funding` admits toChain 143 with native MON; `return` admits any source to Solana USDC. No change to `lib/trustware/server.ts`. |

## Not yet verified

- **Nothing was signed.** The stake, both exits, the completion and the way
  home are typechecked against the ABI and the verified route shapes, and the
  gas figures come from another holder's estimates. The first live stake is
  the manual test below.
- The Buy + Earn earn step and close path on this venue have not run.
- Which epoch counter `completionEpoch` is expressed in. Immaterial to the
  app (readiness is simulated), recorded so nobody builds a countdown on it.

## Keys and env

| Variable | Where | What |
|---|---|---|
| `MONAD_RPC_URL` | server | Live reads, as for Morpho-on-Monad. |
| `MONAD_HISTORY_RPC_URL` | server, optional | The historical `convertToAssets` read behind the APY. Defaults to `https://rpc.monad.xyz`, which serves about eight days; the paid endpoint serves about one. |
| `TRUSTWARE_API_KEY` | server | The funding and return legs, through the existing proxies. |

No new keys.

## What is built

- `lib/shmonad/constants.ts`, `abi.ts`: the registry and the ABI subset.
- `lib/shmonad/math.ts` and `math.test.ts`: rate, fee curve, APY from growth,
  share and MON conversion, instant capacity, reserve, queued-exit phase.
  Pinned to the 2026-09-22 readings.
- `lib/shmonad/server.ts`: server-only batched reads. Metrics: rate, APY
  (week window, day fallback, `windowStale` when the fallback served), TVL,
  fee, pool, epoch, commission. Position: shares, MON at the rate, what each
  exit pays now, wallet MON, the pending request and `ready` from the
  simulation.
- `app/api/shmonad/metrics` (5-minute cache, 30-minute stale grace) and
  `app/api/shmonad/position` (5-second cache per address, 5-minute grace),
  both with `x-aeras-stale: 1` when stale.
- `lib/shmonad/client.ts`, `use-shmonad.ts`: the browser readers and the
  card's hook (60-second poll, explicit refresh after actions).
- `lib/shmonad/stake.ts`: `stakeMon`, `redeemInstant`, `requestUnstake`,
  `completeUnstake` over the Morpho venue's `connectMonad`, `sendTx` (now
  taking a `value`) and `waitForReceipt`, exported from
  `lib/morpho/deposit.ts` for this.
- `lib/shmonad/fund.ts`: `planStake` (quote and sizing, read-only) and
  `stakeFromSolana` (route, sign on Solana, track, wait for the MON, deposit
  what arrived less the reserve). Reuses `fundingRequest`, `quoteFunding`,
  `broadcastFundingLeg` and `GAS_FLOOR_WEI`, exported from
  `lib/morpho/fund.ts` for this. `stakeWalletMon` stakes MON already in the
  wallet, for a retry whose conversion landed.
- `lib/shmonad/unwind.ts`: `sendMonToSolana`, native MON home as Solana USDC
  through `executeEvmRoute`, and its quote.
- `components/ShMonadCard.tsx`: the card under the Vaults table. Stake form
  with a debounced priced preview; Withdraw with Instant (capped by the pool,
  floor 25 bps under the preview) and Queue (the state machine: none,
  pending, ready); Move to Solana whenever the wallet holds MON beyond the
  reserve; the disclosure.
- `lib/positions/earn.ts`: the "shMON · Monad" row for the wallet card and
  the Portfolio tab, read only when the wallet holds shares.
- `lib/strategies/rates.ts`, `execute.ts`, `components/strategies/EarnTicket.tsx`:
  the Buy + Earn option, its earn step and close path, the warning.
- `scripts/shmonad-check.mts`, `public/logos/shmonad.png` (FastLane's
  apple-touch-icon), `VENUE_LOGOS.shmonad`.

## Decisions

Numbered in `docs/shmonad-plan.md`. The ones that bite:

- **Mint, do not buy shMON** (D2). The direct route prices off a DEX and
  delivered 1% less than minting at 25 USDC.
- **The delivered MON is the gas** (D3). No gas leg; 0.1 MON kept back.
- **Both exits, instant capped by the pool** (D4). The pool was 91% drawn
  when measured, so the card states capacity and fee beside the button.
- **Readiness is a simulation** (D6). Never compare epoch counters.
- **APY from a week of share price growth** (D7), day fallback, on the
  public node. The block guess uses 0.3 s per block; the first guess of
  0.4 s landed the "week" at 127 hours and flagged it stale.
- **Never the Buy + Earn default** (D9). The close uses the instant exit
  and refuses when the pool cannot pay, naming the Earn tab's queue.
- **Reuse by export** (D10). A `lib/monad/` home for the shared plumbing is
  the follow-up, not this build.
- **The way home is one leg** (D11), verified; the two-leg fallback is
  described in `unwind.ts` and not built.
- **Warn below 2 USDC** (D12): fees pass 2% of the amount there.

## Traps

- `msg.value` must equal `assets`; `stakeMon` derives both from one variable.
- Deposits and exits are priced at different rates on purpose: a stake then
  an unstake in the same epoch returns less MON than went in. The card shows
  `previewRedeemDetailed` and `previewUnstake`, never `convertToAssets`, as
  what an exit pays.
- One queued request per wallet; a second merges and restarts. The Withdraw
  panel warns; the Buy + Earn close never queues.
- `maxDeposit` is 2^128 − 1 and `maxRedeem` is the balance: neither sizes
  anything.
- The stale flag and the block guess are coupled: judge stale at half the
  week, or a slightly short week reads as the day fallback.
- Never index the Privy wallets array; never capture the wallet object
  across the chain switch. `connectMonad` and `useEmbeddedEvmWallet` handle
  both.

## Manual test

With a wallet holding 10 USDC on Solana and a provisioned EVM wallet:

1. Earn tab, shMON card: APY, rate, staked and the pool figures show;
   nothing staked.
2. Stake 5 USDC. Expect the preview to price (about 190 MON delivered,
   0.1 MON kept, about 55 shMON), two silent signatures, stage messages, a
   Monad explorer link, and the position within a minute of settlement. The
   wallet panel's MON row reads about 0.1 MON.
3. Withdraw, Instant, half. Expect the fee row to match
   `getCurrentUnstakeFeeRateRay` and the MON in the Monad wallet; the Move
   to Solana block appears.
4. Withdraw, Queue, the rest. Expect the pending block; about a day later,
   Complete unstake becomes enabled.
5. Move to Solana. Expect the USDC floor quoted, then USDC on Solana.
6. Strategies, a Jupiter asset, Buy + Earn, pick shMON: expect the warning
   with the live fee; run with 10 USDC; Close.

## Follow-ups

- Move `connectMonad`, `waitForReceipt`, `sendTx`, `GAS_FLOOR_WEI`,
  `fundingRequest`, `quoteFunding` and `broadcastFundingLeg` into a
  `lib/monad/` home, the way `lib/ethereum/` was made for Aave, and have
  both venues import from there.
- A "stake the MON already in your wallet" button on the card
  (`stakeWalletMon` exists).
- Record which epoch counter `completionEpoch` uses once a request is
  observed live.
