# Glider: the Bitwise Mag7X portfolio on Base

Read this before touching `lib/glider`, `lib/base`, `app/api/glider`,
`components/glider`, or the `glider-deposit` and `base-gas` shapes in
`lib/trustware/server.ts`.

**Status as of 2026-09-22: key in place, every API call verified, no funds
moved yet.** Every read on the Markets card runs keyless and is verified
live. With `GLIDER_API_KEY` the check script verified the tenant ("Aeras",
all scopes granted, no integrator swap fee configured), the strategy and
discovery reads, and the whole enrollment with a throwaway key
(`--enroll-test`): stage 1 digest, `personal_sign` over the raw bytes,
stage 2 answering 201 with a Base smart account, the list-by-owner lookup
the app uses, positions on the empty portfolio, and liquidate-all refusing
an empty portfolio with `API_220`. The two Trustware legs quote (deposit,
and the exit's Base gas). What is not yet done is a funded run: one $50
deposit through the ticket and one exit, with a wallet you control. One
thing that run must confirm: the manual rebalance trigger answered
`500 API_600` on the empty throwaway portfolio; the deposit path tolerates
that (the scheduler runs daily and `nextDueAt` was set to seconds after
enrollment), but on a funded portfolio it should answer 202. Enrollment, deposits, positions and the
exit need `GLIDER_API_KEY` and were written from Glider's B2B docs, which
are precise; `scripts/glider-check.mts` verifies all of it once the key is
in `.env.local`. Run it, then do one $50 deposit and one exit with a wallet
you control before the card is shown to anyone.

```bash
set -a; . ./.env.local; set +a; npx tsx scripts/glider-check.mts [--owner 0x...]
```

## What Mag7X is, and is not

Bitwise publishes a model portfolio: eight Coinbase-issued tokenized US
stocks on Base at 12.5% each (Apple, Alphabet, Meta, NVIDIA, Amazon, Tesla,
SpaceX, Microsoft), rebalanced daily with a 10% drift trigger. Glider runs
it. Three things follow, and each one shapes the code.

**It is not a token.** Nothing can be bought on Jupiter or anywhere else and
called Mag7X. Each investor gets a ZeroDev Kernel smart account on Base,
owned by their own EOA, with Glider's agent holding a session key that can
swap and rebalance but cannot withdraw. What the user holds is that account
and the eight tokens inside it. So the catalog in `lib/jupiter/xstocks.ts` is
untouched: the portfolio is its own row group in Markets ("Portfolios"), its
own ticket, and its own position row.

**It is not collateral.** No share token exists and the holdings sit on Base,
so nothing here can be posted at Kamino or Jupiter Lend. The Buy + Earn and
Buy + Buy more strategies can send borrowed USDC into it, and the loan stays
on Solana against the xStock that was bought; the Mag7X value does not count
toward that loan's health, and both tickets say so.

**The 10% is a campaign, not a yield.** Glider's frontend API reports it as
`campaignId: "bitwise-mag7x-08-26", apr: 0.1`, paid in dollars into the
portfolio. `lib/glider/server.ts` reads it live on every strategy view and
the card shows the campaign name beside the figure. It is never hardcoded,
never defaulted, and the day it ends the boost reads null and Mag7X drops out
of the Buy + Earn destination list (an equity exposure with no stated return
is not an "earn" option).

**Who may enroll.** The tokens are offered under Regulation S and are not
available to US persons. Glider's API enforces nothing about who enrolls; the
docs say the integrator does. `lib/glider/eligibility.ts` does: the country
Vercel's edge stamps on the request is checked against the US and the
comprehensively sanctioned jurisdictions, and the user must send `attest:
true` from the checkbox the ticket will not submit without. Both checks run on
the enroll routes and nowhere else; reading a public strategy is not gated.

## The two APIs

The B2B API at `https://api.glider.fi/v2` is the partner contract, keyed
with `x-api-key`. Get a key at `console.glidercloud.dev`. The read scopes are
granted on every key; `enroll:write`, `portfolios:write` and
`portfolios:withdraw` are "standard" tier, self-service in the console or by
asking `developers@glider.fi`. Public strategies are `canMirror: true`, so
enrolling users into Bitwise's strategy needs no approval from Bitwise.

Glider's frontend API at `https://api.glider.fi/v1/trpc` is keyless. It is
read for exactly two things the B2B API does not carry: the boost campaign
(`strategyBlueprints.getDynamicAprForStrategy`) and the strategy's live TVL
and user counts (`getStrategyTvlStatsBatch`), plus the performance curve and
blueprint as a fallback when there is no key. It is not a contract. The
check script pins the shapes; if they move, the strategy view degrades to
nulls, never to wrong numbers.

**The tenant fee.** `GET /v2/tenant/fees` answered `swapBps: null` on
2026-09-22: no integrator fee is configured, so nothing is charged in
Aeras's name on rebalance swaps. Glider's docs show a 50 bps example, which
is what a configured fee looks like. `PATCH /v2/tenant/fees` sets one; the
decision is the operator's and nothing in the app sets it. The check script
prints the current value.

## Flows

Every flow goes through `app/api/glider/*`. The owner of a portfolio is the
embedded EVM wallet on the verified Privy identity, read off the token and
never accepted from the request, the same rule `app/api/trustware/route`
states for payout addresses.

### Enroll (`lib/glider/enroll.ts`)

1. `POST /api/glider/enroll/signature` with `{ attest: true }`. The route
   runs the eligibility gate, then asks Glider for stage 1
   (`POST /v2/enroll/signature`, `accountType: "ECDSA"`, `chainIds: [8453]`).
   If the user already has a portfolio the route returns it instead.
2. The embedded EVM wallet signs `message.raw` with `personal_sign`,
   **untransformed**. It is already a 32-byte digest. Hashing it again or
   treating the hex as text produces a signature Glider rejects.
3. `POST /api/glider/enroll` echoes the round-trip fields (`flowId`,
   `accountIndex`, `agentAccountId`) with the signature. Glider creates the
   Kernel account on Base and answers with its address. `flowId` is the
   idempotency anchor for 24 hours, so a replay returns the same portfolio.

### Deposit (`lib/glider/fund.ts`)

Solana USDC to Base USDC through Trustware, delivered straight to the smart
account. One Solana signature, no ETH, no chain switch: the Ondo-margin
pattern in `lib/ondo/fund.ts`, for the same reason. The request carries
`intent: "glider-deposit"`, one of the three shapes whose destination the
proxy does not overwrite, and it is the only one of the three the route
handler verifies: `verifyGliderSmartAccount` asks Glider whether the address
is the Base smart account of a portfolio this identity's EVM wallet owns, and
refuses otherwise. After settlement the app calls
`POST /api/glider/portfolio/rebalance` (start, then a manual trigger) so the
USDC becomes the eight holdings in minutes. A refused trigger (Glider's
cooldown) is data, not an error: the scheduler runs daily and the USDC is
already in the account.

Minimum $50. Glider skips any slice under the strategy's swap threshold,
which is **$5 per asset** on Mag7X (`GET /v2/strategies/{id}/preferences`
on 2026-09-22: `thresholdUsd "5.00"`, and `slippageBps 1000`, a 10% swap
tolerance because the Coinbase tokens are thin). Eight slices at $5 is a
$40 hard floor below which some holdings are never bought and the USDC
sits idle; $50 keeps every slice at $6.25 before swap fees. The route
itself is cheap: 25 USDC from Solana delivered 24.94 USDC on Base for
about $0.06 of LI.FI fees the same day, a fifth of what the return leg was
measured at. The plan refuses any route delivering under 97%.

### Exit (`lib/glider/exit.ts`)

Whole position only. A partial in-kind withdrawal would land a Coinbase
tokenized stock in the EVM wallet with no route home, the exact stranding
the wallet panel's "cannot be moved" warning is about.

1. `POST /api/glider/portfolio/liquidate/signature`. The route pins the
   recipient to the user's own embedded EVM wallet on Base and asks Glider
   for the EIP-712 authorization (`liquidate: true`, settlement USDC).
2. The wallet is switched to Base and read back, then signs with
   `eth_signTypedData_v4`. The authorization lives ten minutes.
3. `POST /api/glider/portfolio/liquidate` sends `typedData.message` back
   **byte-for-byte** with the signature. Re-serialising `amountRaw` as a
   number or reordering assets breaks the signature. Glider sells everything
   above threshold, pays the gas, delivers USDC to the wallet.
4. The wallet is born with no ETH, so if it cannot pay for a Base
   transaction, a 2 USDC Solana to Base ETH leg runs first (the `base-gas`
   shape, delivered to the user's own wallet). This is the top-up
   `lib/trustware/base.ts` said Base could not have because nothing inbound
   existed to ride on; a Mag7X exit is that inbound leg.
5. `sendBaseUsdcToSolana` brings it home, unchanged.

Every leg re-reads Base before it acts, so pressing Exit again after a
failure resumes where it stopped.

## Where it shows

- **Markets.** A "Portfolios" group below the catalog groups
  (`components/glider/GliderMag7xCard.tsx`). The row carries the boost, the
  live since-listing return and the user's position; the expansion is the
  exposure table (weight, live price from the matching xStock, ten-year
  CAGR), the basket CAGR, Glider's performance windows, mechanics and the
  disclosures, beside the ticket.
- **Strategies.** Buy + Earn lists "Bitwise Mag7X on Base" as a destination
  for the borrowed USDC while the boost is live; Buy + Buy more offers it as
  a ladder-ending pick. Both go through `depositUsdcToEarn` and
  `withdrawUsdcFromEarn` in `lib/strategies/execute.ts`, so there is one
  deposit path and one exit path.
- **Positions.** One earn row, "Glider · Base", valued by Glider's positions
  endpoint with the money-weighted all-time return as its note.

## The CAGR table

`app/api/glider/history` reads ten years of daily closes per holding from
Nasdaq's site API (keyless, wants a browser User-Agent, verified
split-adjusted: AAPL's 2016 close reads $28.39, a quarter of what it printed
before the 2020 split). A holding with two years or more gets a CAGR; less
gets its cumulative since-listing return, because annualising three months
of trading is arithmetic, not information. The basket is daily-rebalanced
equal weight across the holdings with the full window and names what it
excludes: SpaceX listed on 2026-06-12, so the ten-year basket is seven
names. Cached a day on the server; a cold load takes about ten seconds.

Ten-year figures on 2026-09-22: NVDA 63.6%, TSLA 38.9%, AAPL 28.1%, GOOGL
24.2%, MSFT 24.0%, AMZN 20.5%, META 17.8%.

## Performance figures

Glider reports two curves for the strategy and its page headlines the wrong
one as "all time". `live` starts 2026-06-12, the first day all eight
holdings existed; `backtestExcludingSpacex` is a twelve-month model without
SpaceX. The strategy view carries both under those names and the card
labels them. A user's own portfolio reports money-weighted return (MWR) by
default, which is their outcome after their deposits and withdrawals.

## Environment

| variable | side | purpose |
|---|---|---|
| `GLIDER_API_KEY` | server | B2B API key. Unset, the card reads but the ticket cannot enroll or deposit. |
| `BASE_RPC_URL` | server | Base JSON-RPC for the exit's balance reads. Unset, `https://mainnet.base.org`. |

## What to record after the first live run

- The delivered amount on a $20 and a $100 deposit, and the time from
  Solana signature to Glider's rebalance completing.
- What a liquidation of a $100 position delivers to the wallet, and what
  the leg home then delivers to Solana.
- The tenant swap fee after it is set.
