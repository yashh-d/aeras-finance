# Morpho gold: borrowing USDT against tokenized gold

Read this before touching `lib/morpho/gold-*.ts`, `app/api/morpho/gold-*`, or
`components/GoldBorrowCard.tsx`.

Everything here was verified live on 2026-08-26 against Ethereum mainnet and the
Trustware API. `scripts/morpho-gold-check.mts` re-verifies it on demand:

```bash
set -a; . ./.env.local; set +a; npx tsx scripts/morpho-gold-check.mts [evmAddress]
```

## The one thing to get right first

**This is a Morpho Blue *market*, not a Morpho *vault*.** The Monad earn venue in
`lib/morpho/vaults.ts` is ERC-4626: deposit USDC, earn the vault's yield. This is
an isolated Blue market on the singleton at
`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`: one collateral, one loan asset, no
curator, no shares to hold. They share the name "Morpho" and nothing else, no
contract and no math.

The consequence that reaches users: **collateral in a Blue market earns nothing.**
XAUt supplied here is inert. It buys borrowing power, full stop. The ~4% supply
APY on Morpho's own market page belongs to USDT suppliers, who are a different
party entirely. Any surface that puts a percentage next to someone's supplied
gold is telling them they are earning it. `GoldBorrowCard` states the opposite
explicitly and renders the borrow rate in neutral white rather than the positive
green every other rate in the app uses.

## The market

| | |
|---|---|
| marketId | `0xb7843fe78e7e7fd3106a1b939645367967d1f986c2e45edb8932ad1896450877` |
| Collateral | XAUt `0x68749665FF8D2d112Fa859AA293F07A622782F38`, **6 decimals** |
| Loan | USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`, 6 decimals |
| Oracle | `0xc7d1FE3fBe90e8f755250CA3Ce4d2aE50873d9dc` |
| IRM | `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC` |
| LLTV | 77% |

**The market id is the keccak of those five params.** Morpho derives it by
hashing `MarketParams`, so a single wrong byte addresses a market that does not
exist and every call reverts. That is a safe failure, but it fails after the user
has signed, which is why the check script derives the id locally *and* reads
`idToMarketParams` off the singleton rather than trusting the registry.

Chosen from the five Ethereum XAUt markets purely on liquidity, which is the only
thing that decides whether a borrow executes:

| loan | listed | supply | borrowable |
|---|---|---|---|
| **USDT** | yes | $2.66M | ~$260k |
| tGBP | yes | $86.6k | $8.8k |
| USDR | no | $0.40 | $0.40 |
| USDQ | no | $1.04 | $1.04 |
| USDC | no | $0 | $0 |

The USDC market is the tempting one, since USDC is what the rest of the app
speaks, and it is **empty**: 86% LLTV and nothing to borrow. Borrowing USDT and
converting is the working path, and Trustware routes Ethereum USDT to Solana USDC
at about 0.3%, so the loan comes home.

## Decimals

**XAUt is 6 decimals.** Every other Ethereum ERC-20 in this app (the Ondo tokens,
the xStocks) is 18, so the habit is wrong here. Cross-checked in both directions
the way `lib/trustware/swap-tokens.ts` requires: 500 USDC bought 107,927 atomic
units, and 100,000 atomic units sold for $461.91. Both imply ~$4,615/oz. At 18
decimals the implied price is off by 10^12, which quotes as free gold.

## The math is a port, not an approximation

`lib/morpho/gold-math.ts` reproduces Morpho's libraries exactly: `SharesMathLib`
virtual shares (`1e6` shares, `1` asset), `MathLib.wTaylorCompounded` truncated at
three terms, and `Morpho._isHealthy`. Rounding direction is part of the port.
Debt rounds **up** (`toAssetsUp`) and borrowing power rounds **down**
(`mulDivDown`); reversing either produces a position the contract calls unhealthy
while the UI calls it fine.

Two things that silently produce wrong-but-plausible numbers if skipped:

1. **Accrue interest before pricing debt.** `market(id)` returns totals as of the
   last write that touched the market, which can be hours old. Reading debt off
   stale totals **understates** it, which reads as a healthier position than the
   borrower has. That is the one direction a liquidation warning must never err
   in.
2. **Accrue against the latest block's timestamp, not the server clock.** The
   contract compounds against `block.timestamp`.

Verified against Morpho's own indexer on a live $450k position
(`0x68b5…66b1`, 2026-08-26):

| | ours | indexer |
|---|---|---|
| collateral | 168.1 XAUt | 168.1 |
| debt | 453,682.872699 USDT | 453,682.792395 |
| health | 1.3226039296 | 1.3226041637 |

The $0.08 gap is interest accrued between their snapshot and our block, and ours
is the higher debt. That agreement covers the whole port at once: virtual shares,
Taylor accrual, the 1e36 oracle scale, LLTV, and every rounding direction.

## Funding: the conversion is a sale

`lib/morpho/gold-sources.ts` is **not** an equivalents registry. Nothing in it is
1:1 with anything else:

| | denomination | ~price |
|---|---|---|
| XAUt | one troy ounce | $4,610 |
| XAUt0 | one troy ounce (LayerZero) | $4,618 |
| GLDx | one GLD share, ~0.092 oz | $425 |
| GLDon (Solana) | ~0.086 oz | $395 |
| GLDon (Ethereum) | ~0.45 oz | $2,070 |

Converting between them is a **sale at market**, with slippage and a taxable
event, not a re-wrapping. The two GLDon rows are the sharp edge: same symbol,
same issuer, 5.2x apart across two chains. Ondo's own mark agrees with the
Ethereum figure (`docs/ondo-perps.md` records ~$2,090 and flags it is not a GLD
share), so it is a real denomination difference or a long-standing mispricing.
Either way it is not something to average over.

**Never price a conversion from a registry.** Trustware's token registry lists
GLDx on Ethereum at $7,160 against a real sale price near $425, a 17x error.
`approxUnitUsd` exists only to satisfy Trustware's `fromAmountUSD` requirement on
Solana routes and to order a picker. `gold-fund.ts` values the delivered side at
the Morpho oracle (measured within 0.42% of a live market quote) and the source
side at what it actually sells for, then refuses above 3% loss. This is the same
conclusion `lib/ondo/fund.ts` reached by a different road.

### What routes, and what does not

Measured 2026-08-26, and the two failures are **different failures**:

| route | result |
|---|---|
| Solana USDC → XAUt (Ethereum) | works, ~0.4% all-in |
| Solana USDC → native ETH (Ethereum) | works, **0xEeee sentinel only** |
| GLDx / GLDon / XAUt0 (Solana) → Solana USDC | works, ~0.3% |
| Ethereum USDT → Solana USDC | works, ~0.3% |
| GLDx / GLDon / XAUt0 (Solana) → XAUt | **502** |
| GLDx / GLDon (Ethereum, BNB) → anything | **502 in every direction** |

The Solana-gold failure is a **solver bug worth reporting upstream**: Trustware
runs `gold → USDC` and `USDC → XAUt` individually but cannot compose them. The
EVM-gold failure reads as **no DEX liquidity** for those wrappers off Solana,
which no backend fix changes. Conflating them would mean filing a liquidity fact
as a bug.

So `planGoldFunding` tries the direct route **first, every time**, and falls back
to selling for Solana USDC and buying XAUt with the proceeds. The day the solver
composes, direct wins with no code change. The check script prints both per
source, so that day is visible.

Hop 2 is priced against hop 1's **guaranteed minimum**, so the plan never promises
more than the worst case, and it is **re-routed at execution** against the USDC
that actually arrived, so a hop that beat its floor passes the surplus on.

### The 0xEeee sentinel

Native ETH as a route destination is the `0xEeee…` alias, **not** the zero
address. This is the reverse of Monad, where `MONAD_NATIVE_TOKEN` is the zero
address. On Ethereum the zero address returns a 502 and only the alias quotes.
Do not tidy the two constants into one.

## Gas

Every action here is an Ethereum mainnet transaction, and the Privy embedded
wallet is born with no ETH. Ondo funding dodges this entirely because Ondo pays
gas; Morpho does not.

A full borrow lifecycle is ~700k gas: approve (~50k), `supplyCollateral` (~130k),
`borrow` (~160k), the USDT approve pair (~100k, below), `repay` (~120k),
`withdrawCollateral` (~120k). The floor is sized for the whole cycle rather than
the entry, because a borrower with gas to deposit but not to repay is in the one
state this venue must not create.

Both thresholds are multiples of a cycle at the **current** price, read live from
`eth_gasPrice`, never fixed ETH amounts: gas moves an order of magnitude within a
week. Measured 2026-08-26 at **0.058 gwei**, a full cycle costs about **$0.10**;
at 20 gwei it is about $35.

The refusal threshold is a **fraction of the position** (2%, floored at $25), not
a flat cap. The same dollar figure is absurd and negligible at different sizes:
$80 of gas on a $500 position is a bad trade at any gas price, and on a $50,000
position it is a rounding error. A flat cap low enough to protect the first would
refuse the second at any ordinary gas price.

## USDT is not a compliant ERC-20

Two deviations, both of which bite:

1. `approve` **reverts** when it would move a non-zero allowance to a different
   non-zero value. So a standing allowance that is too small must be zeroed
   first. `approveIfShort` in `gold-borrow.ts` does that. Skipping the reset
   works on the first repayment and reverts on the second, which is the worst
   possible way for a bug to behave.
2. Neither `approve` nor `transfer` returns a bool. Harmless here because nothing
   decodes their return, but it breaks any helper that does.

## A full repayment is sized in shares

Debt accrues every second, so repaying an asset amount read a moment ago always
leaves dust and the position stays open, holding the collateral hostage. Pass
`repayAll` with the position's `borrowSharesAtomic` to close it exactly. This is
the same reason `lib/morpho/deposit.ts` uses `redeem` rather than `withdraw` for a
full vault exit.

## The proxy boundary

`validateTrustwareRequest` gained a seventh shape, `gold`: anything → XAUt on
Ethereum, delivered to an EVM address. It is narrower than it looks. Native ETH
is deliberately **not** in it, because ETH on Ethereum is already in
`SWAP_TOKENS` and the `swap` shape covers the top-up with both sides curated. The
only thing `gold` adds over `swap` is an **unconstrained source**, which is what
lets a user's GLDx or GLDon fund a deposit without either being in the swap
registry. The recipient is the user's own wallet, so nothing is unrecoverable,
unlike the Ondo margin shape.

`XAUt` and `XAUt0` were also added to `SWAP_TOKENS`, which is what makes gold
buyable. They are different tokens, and the pair is the only place that registry
carries two rows for one underlying: hold gold as **XAUt0 on Solana** (tightest
route, lives with the rest of the portfolio), and mint **XAUt on Ethereum** only
while it is posted as collateral. Same reasoning CLAUDE.md applies to the Ondo
tokens: the EVM side is a waypoint, not a home.

## The buyable catalog

PAXG and XAUt0 were added to `lib/jupiter/xstocks.ts` (2026-08-27) so gold is
buyable on Solana through Jupiter, not only reachable as Morpho collateral. They
are not xStocks, and adding them broke two assumptions the catalog had carried
since v1:

- **Not all 8 decimals.** Both are 6. Nothing hardcoded `8`, so widening
  `XStock.decimals` from the literal type to `number` was a one-line change.
- **Not all Token-2022.** PAXG is Token-2022; **XAUt0 is classic SPL**. They
  disagree with each other. The ATA address is derived *from* the program, so a
  wrong guess derives an account that does not exist and the balance reads as
  **zero rather than as an error**. `XStock.tokenProgram` now carries this per
  entry, and `lib/solana/balances.ts` and `lib/solana/send.ts` read it instead of
  assuming.

Both were verified independently rather than by analogy to the equity rows:
Jupiter `verified` + `rwa` tags with no launchpad (the impostor test), on-chain
mint owner and decimals, and Ultra quotes at $100 / $2,000 / $25,000 showing
under 0.003% price impact, which is better than several equity rows.

`XAUt0` is also a funding source for this market (`gold-sources.ts`), so it is
both something a user can buy and something they can collateralise. That is the
intended shape: **hold gold as XAUt0 on Solana, mint XAUt on Ethereum only while
it is posted as collateral.**

One departure from the registry's stated rule, recorded because the rule is
stated as absolute: `coingeckoId` is normally resolved through
`/coins/solana/contract/<mint>`, and that endpoint answers "coin not found" for
the PAXG mint. `pax-gold` is used instead. It is the correct series rather than a
near-enough one, since PAXG is Paxos issuance redeemable for the same bullion on
every chain, and it was verified by hand: 169 points tracking spot gold, last
$4,618.86 against Jupiter's $4,622.43 for the Solana mint, a 0.08% gap. XAUt0
resolved the normal way to `tether-gold-tokens` (note: **not** `tether-gold`,
which is the Ethereum XAUt).

## Ethereum RPC

`ETHEREUM_RPC_URL`, server-only, falling back to
`https://ethereum-rpc.publicnode.com`. CLAUDE.md says there is no EVM RPC of our
own, and that held while Trustware covered every EVM read we needed: its
`/sdk/rpc/evm` surface proxies ERC-20 allowances **only**. Reading a Morpho Blue
market needs a general `eth_call`, which that proxy does not serve. This is the
second read-only endpoint after `MONAD_RPC_URL` and follows the same shape: a
paid endpoint drops in via env with no code change.

## Open items

- **Report the Solana-gold-to-XAUt 502 to Trustware.** Both legs run
  individually; the solver cannot compose them. Until then every conversion is
  two signatures instead of one.
- The direct route is preferred automatically, so nothing needs changing when it
  is fixed. `scripts/morpho-gold-check.mts` prints `direct=` per source; an
  amount there instead of `HTTP 502` means it landed.
- GLDx and GLDon on Ethereum and BNB are in the registry but unroutable. The
  planner blocks them with a readable reason rather than hiding them, so they
  start working on their own if liquidity appears.
