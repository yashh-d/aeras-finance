# Partner API

**Status: draft, 2026-09-08. Nothing here is built.** The "Open decisions"
section at the end lists what has to be settled before code. Read CLAUDE.md
first; this document assumes it.

The partner API lets any wallet or app let its users earn on and borrow
against the assets Aeras already supports, without running Aeras's UI. The
partner keeps its users, its wallet, and its front end. Aeras supplies market
data, position reads, unsigned transactions, submission, and the fee layer.

## 1. Custody model

**Bring your own signer.** The partner names a wallet address; Aeras returns
unsigned transactions; the partner's wallet signs; Aeras submits and confirms.
Aeras never holds a key.

This is the same invariant the app already runs on: a transaction Aeras builds
can only move the named wallet's own funds into or out of a venue. The route
proxy for Trustware states it as a threat model (`app/api/trustware/route/route.ts`),
and every partner endpoint inherits it. **No endpoint ever accepts a
destination address from the caller.**

It works for any Solana wallet that can sign a base64 versioned transaction:
Phantom, Backpack, Privy, Turnkey, Dynamic, a hardware wallet, or a server-held
keypair. The EVM steps (Trustware source legs, later the Morpho venues) need an
EIP-1193-shaped signer on the partner's side.

Aeras-hosted wallets (Privy server wallets under a policy, `@privy-io/node` is
already a dependency, and `docs/privy-policy-inventory.md` is the groundwork)
are a later layer. They plug in as a second signer behind the same endpoints
and do not change the API shape.

## 2. Surface

Versioned under `/api/v1`, separate from the app's own `/api/*` routes, which
stay as they are. Every route runs through one wrapper that does key
verification, CORS against the partner's registered origins, rate limiting,
and error shaping. There is no middleware today and this design does not add
one; the wrapper is a function each route calls.

### Reads

| Route | Returns |
|---|---|
| `GET /v1/assets` | Catalog: class (`equity`, `index`, `commodity`, `stable`, `crypto`), mint, decimals, token program, the venues that accept it as supply or collateral, and the disclosure text the partner must show. |
| `GET /v1/markets` | Every earn and borrow market, normalised: venue, chain, supply or collateral asset, debt asset, LTV and liquidation threshold as fractions, APYs as decimals, liquidity, oracle price, the first-position setup cost. Built on `BorrowRoute` in `lib/borrow/route.ts` and the venue state readers. |
| `GET /v1/wallets/{address}/balances` | Holdings on Solana, plus the cross-chain scan Trustware already serves when an EVM address is also given. |
| `GET /v1/wallets/{address}/positions` | Every open position across venues with structured numbers: collateral, debt, health, APY. The fan-out and degrade-per-venue policy come from `lib/positions/use-positions.ts`; the display strings do not. |
| `GET /v1/wallets/{address}/setup-cost?venue=` | First-position rent for the venue and whether the wallet covers it. |

### Writes: plans and steps

A write is a **plan**. A plan is an ordered list of steps, each one thing to
sign. Most actions are one step. A Kamino open is two (supply, then draw). A
Trustware deposit from Ethereum is two or three (approval, source transaction,
then the Solana deposit once the funds land). The plan is the unit that
carries fees, previews, and status.

```
POST /v1/plans
{
  "wallet": { "solana": "...", "evm": "0x..." },
  "action": "earn.deposit",
  "venue": "jupiter-lend",
  "asset": "USDC",
  "amount": "1000000",
  "endUserRef": "opaque-partner-user-id"
}
```

Actions: `earn.deposit`, `earn.withdraw`, `borrow.supply`, `borrow.draw`,
`borrow.repay`, `borrow.withdraw`, `trade.buy`, `trade.sell`,
`convert.deposit` (Trustware, cross-chain source into a venue deposit).

```
{
  "planId": "...",
  "steps": [
    {
      "index": 0,
      "chain": "solana",
      "kind": "solana-tx",
      "transaction": "<base64 unsigned v0>",
      "blockhash": "...",
      "lastValidBlockHeight": 123,
      "submitVia": "aeras",
      "fee": { "bps": 30, "amount": "3000", "mint": "EPjF...", "mechanism": "appended-transfer" }
    }
  ],
  "preview": { "amount": "1000000", "net": "997000", "expected": { "...": "..." } },
  "fees": { "aeras": { "...": "..." }, "venue": { "...": "..." }, "network": { "lamports": 12000 } },
  "disclosures": ["..."],
  "expiresAt": "..."
}
```

Step kinds: `solana-tx` (base64, signed by the Solana wallet),
`evm-approval` and `evm-tx` (`chainId`, `to`, `data`, `value`; signed and
broadcast by the EVM wallet, which reports the hash back). `submitVia` is
`aeras` for our own confirm path or `jupiter-ultra` for Ultra orders, which
must go back through Jupiter's execute endpoint with the `requestId` the step
carries.

```
POST /v1/plans/{id}/steps/{n}/submit   { "signedTransaction": "..." }  or  { "txHash": "0x..." }
GET  /v1/plans/{id}                     status of every step, including Trustware intent tracking
```

Later steps that depend on an earlier one landing are built lazily: the
response for a two-step plan carries step 0 fully built and step 1 as a stub
with `dependsOn: 0`, and the stub is built on the first `GET` after step 0
confirms. This is what keeps Kamino's obligation-not-found ordering and
Trustware's arrival wait out of the partner's code.

The server owns every clamp the app's components own today: the LTV cap, the
Jupiter Lend withdrawable cap, the fresh-collateral read before a Kamino
deposit, the first-position setup preflight. A partner that sends an amount
above the cap gets a 422 with the cap in the body, not a transaction that
fails simulation.

Submission runs `sendAndConfirm` from `lib/solana/send-confirm.ts`, which can
take two minutes. The submit route sets `maxDuration` accordingly. Every
route is in `fra1` with the rest of the project (see `vercel.json`).

### What is in v1 and what is not

In: the five Solana venues (Jupiter Lend earn and borrow, Kamino K-Vaults and
the xStocks market, Jupiter Ultra trades) and Trustware conversions whose
destination is a Solana venue deposit.

Not in v1: the EVM venues (the two Morpho venues and, once built, Aave V4
gold; each step there is a bare `eth_sendTransaction` with reads between
steps, and needs the step protocol extended to interleaved reads), the Base
and Monad return legs, perps and hedging (Ondo's session is a browser cookie
with no server-to-server equivalent), and the Privy hosted on-ramp in the
first-position sheet, which has no server form.

When the EVM venues come in, Aave's signature gateway (`docs/aave-gold.md`) is
the model for the step kind: the user signs typed data, and the step carries
who relays it. That is the first place a partner can pay a user's gas without
Aeras holding a key, and the same shape a hosted relayer would use.

Two coverage gaps to say out loud, because the pitch names all three asset
classes. **Commodities:** gold is buyable on Solana but is collateral only in
the Morpho market on Ethereum, so there is no Solana gold borrow to expose.
**Crypto:** SOL is earnable on two venues, but nothing crypto is
borrowable-against anywhere in the app today. The Kamino main market has never
been integrated. Adding it is venue work, not API work, and is its own session.

## 3. Fees

Aeras will charge its own fee on every transaction the API builds. The design
has to hold two things at once: a single place that decides the fee, and
several different mechanisms for collecting it, because the venues differ in
what they allow.

### 3.1 One engine, many mechanisms

`lib/fees/` decides; builders collect. Given a partner, an action, a venue, an
asset and an amount, the engine returns a `FeeQuote`:

```
{
  bps, amountAtomic, mint, tokenProgram,
  recipient,                  // treasury token account for that mint
  mechanism,                  // see table
  scheduleVersion
}
```

Every builder takes an optional `FeeQuote` and either collects it or returns
`mechanism: "none"` with a reason. The API never reports a fee it could not
attach. That is the opposite of Jupiter's referral behaviour, where a missing
fee account silently zeroes the fee, and it is deliberate: a fee that was
quoted but not collected is worse than no fee.

**What is centralised and what is not.** The decision, the schedule, the
treasury, the ledger, and the response shape are one thing each. A partner
never sees which venue is under a plan; every step reports its fee the same
way. Collection is one mechanism by default, a transfer to the treasury
appended inside the transaction we compile, which covers every venue whose
transaction we compose. The exception is Jupiter Ultra, where the transaction
is finished and may already carry a market maker's signature, so the fee has to
go through Jupiter's referral program into a referral account we own. That is
a second inbox under the same owner, not a second design. The engine tags the
mechanism on the quote, the builder does what it is told, and reconciliation
sums every inbox into one ledger.

Routing trades through the swap-instructions endpoint instead of Ultra would
make the appended transfer cover trades too. It is rejected here: it gives up
JupiterZ RFQ quotes and Jupiter's managed landing for a uniformity no partner
can observe.

**Router and spread.** A plan may name a venue or pass `venue: "auto"`. Under
`auto` the server picks the venue that delivers the best outcome **net of the
Aeras fee**, not gross, so a partner comparing the quote to a venue's own UI
sees a rate, not a gap. The default presentation is a spread: the response
quotes what the user receives or the rate they get, and the fee is the
difference between that and the venue's execution. The breakdown is always
present in the response so a partner that must disclose can. This is the
solver model without a solver network: the server-side plan builder is the
only router, there is no auction to run, and the fee is collected inside the
one transaction the user signs. An on-chain Aeras program would add nothing
but an explorer label, and is not planned.

The two places a spread cannot be taken by us are the two venues that run
their own solver networks: Jupiter Ultra's RFQ market makers and Trustware's
provider auction set the delivered amount. Ultra is covered by its referral
program and Trustware by the landing deposit, as in the table below. Being
inside Trustware's auction rather than downstream of it is a question for
Trustware.

Semantics: `amount` is what leaves the wallet. `fee = floor(amount × bps /
10000)`. `net = amount − fee` is what reaches the venue. For a borrow draw the
debt is the requested amount and the user receives `requested − fee`. The
schedule can carry a per-action minimum in atomic units so dust trades do not
produce a zero fee with a full transfer instruction attached.

### 3.2 Mechanism per surface

Measured against the code on 2026-09-08. Line references are in the
exploration notes that produced this table; the summary is what matters.

| Surface | Mechanism | Notes |
|---|---|---|
| Jupiter Ultra buy and sell | `referralAccount` + `referralFee` on `/order` | Native. Range **50 to 255 bps**, so Ultra trades cannot carry less than 0.5%. Jupiter keeps 20% of it. Jupiter picks the fee mint from its priority list (SOL, then stables, then others), which is USDC for every pair we route. A referral token account must exist per fee mint or the order executes with **no fee and no error**. Setting referral params **disables Jupiter's automatic gasless**. The Ultra transaction cannot be modified: it may already carry a market maker's signature. |
| Jupiter classic swap (`/quote` + `/build`) | `platformFeeBps` on the quote, `feeAccount` on the build | Native. Any SPL token account we control. Used by the Solana-to-Solana conversion leg and by the leveraged loop. The loop transaction is at 52 of 64 account locks already, so a fee there degrades routing; take it separately or not at all. |
| Jupiter Lend earn deposit and withdraw | appended `transferChecked` | We compile these in `lib/jupiter/earn.ts`. No venue fee, no venue hook. |
| Jupiter Lend borrow (supply, draw, repay, withdraw) | appended `transferChecked` | We compile in `lib/jupiter/borrow.ts`. Fee on a draw comes out of the borrowed USDC in the same transaction. |
| Kamino K-Vault deposit and withdraw | appended `transferChecked` in `composeKvaultTx` | Already composed client-side from KTX instructions. |
| Kamino xStocks market (deposit, borrow, repay, withdraw) | switch the proxy to KTX's `-instructions` endpoints and compose, then append | KTX exposes `/ktx/klend/{deposit,borrow,repay,withdraw}-instructions` returning instructions plus lookup tables. Today the app takes the finished transaction, which cannot be altered and which carries no compute unit price and Kamino's blockhash, the same two problems the K-Vault path already fixed. This switch is a prerequisite for fees on Kamino borrow and an improvement on its own. Needs a check script like `scripts/kamino-deposit-check.mts`. |
| Kamino referrer (ongoing share of borrow activity) | referrer on `UserMetadata` at first touch | Native and permanent: set once when the user's `UserMetadata` is created, never changeable. KTX takes no referrer, so the first-touch transaction has to carry our own init instruction. The share is a market setting, not documented; read it on chain before relying on it. Every existing app user already has a `UserMetadata` without one. Phase 2. |
| Trustware, EVM source into a Solana venue | **none upstream**; fee on landing | Trustware's request and response carry no fee, affiliate or partner field anywhere. Aeras pays Trustware 75 bps. The Solana deposit that follows every `convert.deposit` is a transaction we compose, so the Aeras fee is taken there on the delivered amount. |
| Trustware, Solana source to an EVM chain; Base and Monad return legs | none | No transaction we can alter and no landing we compose. v1 charges nothing here and records the event in the ledger with `mechanism: "none"`. |
| Morpho on Monad, Morpho gold on Ethereum | none | Each step is one `eth_sendTransaction`. A fee would be its own transaction with its own gas and failure mode. Phase 2, together with those venues. |
| Aave V4 gold on Ethereum (`docs/aave-gold.md`) | none | Same position as the Morpho row. Aave's `SignatureGateway` executes EIP-712 intents relayed by anyone who pays gas, which is the shape an EVM plan step wants (the partner relays, or Aeras does), but its `multicall` runs only gateway intents, so it cannot carry a treasury transfer either. |
| Ondo perps | builder code, cap 10 bps | Exists (`lib/ondo/builder.ts`), currently 0 bps. Position-level stop orders do not inherit the code and leak. Not a v1 API surface. |
| Lighter | none known | Zero maker and taker fees, no builder mechanism. Not a v1 API surface. |

Three things fall out of the table.

**The Ultra floor.** Jupiter's referral range starts at 50 bps. If Aeras wants
a trade fee below that, the only path is the classic swap API with
`platformFeeBps`, which loses JupiterZ RFQ liquidity and the managed landing
that `/execute` provides. The recommendation is to accept the floor on trades
and set the rest of the schedule independently of it.

**Gasless.** Jupiter's automatic gasless (taker under 0.01 SOL, trade over
about $10) is what lets a user with no SOL buy their first xStock, and the
first-position funding in `lib/borrow/fund-setup.ts` depends on it. Referral
params switch it off. Two policies are possible: charge the referral fee only
when the taker holds enough SOL, and quote fee-free otherwise; or run an
integrator `payer` wallet that co-signs and pays gas for every trade, which
restricts routing to Metis and puts a server-held signer in the trade path.
The recommendation is the first, and never on the setup-funding swap.

**Fail closed on accounts.** Every fee mechanism has a treasury account that
must already exist: a treasury ATA per fee mint under the right token program,
a Jupiter referral account under the Ultra referral project
(`DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc`) with a referral token account
per fee mint, a fee account for the classic swap. None are created inside a
user's transaction. A check script verifies all of them, and the engine refuses
to quote a fee whose recipient account is missing.

### 3.3 Schedule

`lib/fees/schedule.ts` holds the default bps per action, the per-action
minimum, and a version. Per-partner overrides live on the partner row. The
schedule is code so it ships with a commit and a review; the override is data
so a partner deal does not need a deploy.

No numbers are chosen in this document. See open decisions.

### 3.4 Partner share

Partners will want a cut. Two models:

- **Off-chain settlement.** Aeras collects everything on chain, the ledger
  attributes every fee to a partner, and settlement is a periodic report and
  payment. One transfer instruction per transaction, one referral account.
- **On-chain split.** The fee instruction pays the partner's account directly.
  Two transfers per transaction, more account locks, and Jupiter's referral
  supports one account, so it does not cover trades.

Recommendation: off-chain settlement, with `revenue_share_bps` on the partner
row and a settlement report generated from the ledger.

### 3.5 Treasury and ledger

Treasury: one Solana address, held in an env var, with its token accounts
pre-created. Whether that address is a plain wallet or a Squads multisig is an
open decision; the code does not care.

Ledger: a `fee_events` table, one row per step that carried a fee quote,
following the conventions in `supabase/migrations/0003_position_setup.sql`:
event log, no uniqueness constraint, `bigint` in the chain's own unit, USD as
`numeric(20,6)` alongside, RLS on with no policies.

| Column | Meaning |
|---|---|
| `partner_id`, `end_user_ref`, `wallet_address` | attribution |
| `plan_id`, `step_index`, `action`, `venue` | what |
| `mechanism`, `fee_mint`, `fee_atomic`, `fee_usd`, `bps`, `schedule_version` | how much and how |
| `tx_signature`, `status` (`quoted`, `confirmed`, `failed`) | proof |
| `created_at`, `confirmed_at` | when |

**This table records what was charged. It never decides what to charge.** The
other Supabase tables in this repo protect a property their headers state
plainly: a wrong row misleads only its owner. A ledger that drove charges
would lose that. So the engine computes every fee live from the schedule and
the partner row, and the ledger is written after the fact and reconciled
against the transaction on chain. Settlement reads the ledger; nothing signed
does.

## 4. Trustware in the API

`convert.deposit` is the universal-deposit shape the app already has, pointed
at a partner wallet. The plan is: `evm-approval` (if the allowance is short),
`evm-tx` (the route transaction), then a `solana-tx` deposit built once the
funds arrive, tracked through Trustware's intent status.

Destination pinning is the one thing that changes. The app overwrites
`toAddress` from the verified Privy identity. The partner API pins it to the
Solana address in the plan's `wallet` object, which is the same address every
other step in the plan operates on. A partner cannot route a user's funds to
any address it did not name as that user's wallet.

The Solana-to-Solana conversion (Ondo tokens into xStocks) does not touch
Trustware at all; it is a Jupiter classic swap, and carries the platform fee
from the table above.

Trustware's provider auction changes the router and the approval spender per
route and per size, which `docs/privy-policy-inventory.md` measured. The API
returns whatever the route says; it does not cache spenders.

## 5. Tenancy

- `partners` table: id, name, hashed key, key prefix for display, status,
  `fee_schedule_override` (jsonb), `revenue_share_bps`, `allowed_origins`,
  rate tier. Keys are shown once at creation and compared in constant time,
  the way `ADMIN_SECRET` is today.
- `Authorization: Bearer aeras_live_...`. Optional `X-Aeras-End-User` for
  attribution, or `endUserRef` in the plan body.
- Rate limiting needs shared state, because caching in this repo is per
  instance. Supabase Postgres is the recommendation at partner-scale traffic;
  Upstash is the alternative.
- CORS is on read routes for registered origins. Plan and submit routes are
  server-to-server by default.
- A server-only `SOLANA_RPC_URL` is needed. Only the public one exists.

## 6. Invariants carried over

- Every mint, vault, reserve and pair is allowlisted. A partner cannot pass
  an arbitrary mint. Same rule as the app.
- The xStocks disclosure travels in every response that touches one. Partner
  terms require displaying it.
- Amount clamps live on the server, not in the partner's code.
- No `wallets[0]`, no caller-supplied destinations, no key material on the
  server.

## 6a. Threat model

**What cannot happen.** Aeras holds no user key, so no server compromise,
leaked partner key or insider can move funds alone. A stolen partner key can
build unsigned transactions nobody will sign, read public position data, and
burn rate limits; that is its entire blast radius. No endpoint accepts a
destination, so a partner cannot route a user's funds anywhere but between
that user's wallet and an allowlisted venue, plus the disclosed fee to the
treasury.

**What the design trusts.** The server builds the transaction. A compromised
server could build a drain. A wallet with a confirmation screen shows the
user; a wallet that signs blindly, which is what our own app does with Privy,
would sign it. This is the same trust the app places in Jupiter's and
Kamino's transaction APIs today, and it is reduced to something checkable by
three controls:

1. **Simulate and assert on the server.** Every built transaction is
   simulated and its balance deltas compared to the preview. The wallet's
   outflows must equal `net` to the venue plus `fee` to the treasury and
   nothing else. A mismatch is a refused plan.
2. **Verify in the SDK.** The client re-simulates and checks the same
   deltas, that the only required signer is the user, and that every program
   invoked is on the published allowlist. This is the client-side twin of
   the wallet policies in `docs/privy-policy-inventory.md`.
3. **Pin the treasury in code.** The address is a constant verified by the
   accounts check script, not an environment variable an attacker with env
   access could redirect.

**Before partner traffic.** The app's existing unauthenticated routes, some
of which spend Trustware and Jupiter keys for anonymous callers, must not be
reachable as a way around the partner wrapper. EVM approvals stay sized to
the amount. Trustware's router and approval spender are checked against the
measured set; an unknown spender is a refused step. Token-2022 extensions on
every fee mint are read on chain before an in-kind fee is quoted.

**What is not covered.** Venue risk is inherited: an exploit at Kamino,
Jupiter Lend or a Trustware provider loses user funds and Aeras has no
contract of its own in the path. Liquidation risk is the user's. The spread
is disclosed in every response; a partner that hides it in its UI owns that.

**Phase 2 changes this.** Hosted wallets, where an Aeras authorization key
signs under a policy, are the point where a server compromise becomes a
drain. They need their own review before they are built.

## 7. Build order

Each slice is its own testable unit with a check script or a curl transcript,
per CLAUDE.md. Fees are threaded through from slice 1 so nothing has to be
retrofitted.

1. **Foundation.** `partners` table and migration, key wrapper, CORS, rate
   limit, `lib/fees/` engine and schedule with the fee accounts check script,
   `GET /v1/assets` and `GET /v1/markets`.
2. **Positions read.** `GET /v1/wallets/{address}/positions` and `/balances`.
3. **Earn writes.** Jupiter Lend earn and K-Vault plans with appended fees,
   submit, ledger rows. Verified by a script signing with a local keypair.
4. **Borrow writes.** Kamino via `-instructions` with its check script,
   Jupiter Lend operate with server-side position id resolution, setup-cost
   preflight, fees on draws.
5. **Trades.** Ultra with referral params and the gasless policy, classic
   swap platform fee for conversions.
6. **Trustware.** `convert.deposit` plans, EVM steps, intent tracking, fee on
   landing.
7. **SDK and docs.** A thin TypeScript client with a signer adapter
   interface, an example integration, and this document promoted from draft.

Phase 2, in no order: Kamino referrer, the EVM venues (Morpho and Aave, with
the relayed-intent step kind), hosted wallets, on-chain partner split if
wanted, and **Aeras-curated vaults**. A per-transaction fee
cannot take a share of yield over time; a vault between the user and the venue
can. Kamino's curator product (`KaminoManager.createVaultIxs`, performance
and management fees paid to the curator, admin on a multisig) and Morpho
Vaults V2 curator fees on Monad both give that without a custom program or
custody of keys. Routing `earn.deposit` under `auto` into an Aeras-curated
vault is the path to a yield spread. Needs its own research session against
Kamino's curator docs before anything is decided.

## 8. Open decisions

1. **Fee schedule.** Which actions carry a fee and at what bps. In
   particular: deposits and withdraws, or only trades and draws? Repays?
2. **The Ultra floor.** Accept 50 bps on trades, or route trades through the
   classic swap to go lower?
3. **Gasless policy.** Fee-free when the taker cannot pay gas (recommended),
   or an integrator payer wallet?
4. **Partner share.** Off-chain settlement (recommended) or on-chain split?
5. **Treasury.** Plain wallet or Squads multisig, and who holds it.
6. **Trustware.** Ask Trustware for a revenue share on the 75 bps. Nothing in
   the design depends on the answer, but it is the only way to earn on EVM
   source legs without a second signature.
7. **Rate-limit store.** Supabase (recommended) or Upstash.
8. **SDK location.** A top-level `sdk/` directory like `spend/`, or a separate
   repository.
9. **Kamino referrer.** Add `@kamino-finance/klend-sdk` (pinned) for the
   `UserMetadata` init, or hand-build the instruction. Phase 2 either way.

## 9. To verify before building on it

- The Kamino xStocks market's referral fee setting, read on chain.
- Which token program and which mint extensions each fee mint has. No xStock
  is recorded as carrying a transfer fee or hook, and nothing in the app
  checks. An in-kind fee on an xStock is the case that would break silently.
- Whether `totalFeesUsd` or `totalFeesUSD` is the live Trustware field name.
  The app type uses one and `scripts/trustware-base-check.mts` reads the
  other.
- That KTX's `klend` `-instructions` responses compose to the same
  transaction as the finished endpoint, the way the K-Vault check proves.
