# Aave V4 gold: borrowing USDC against tokenized gold

Read this before touching `lib/aave/gold-*.ts`, `app/api/aave/gold-*`,
`components/AaveGoldBorrowCard.tsx`, or the shared pieces in `lib/evm/tx.ts`
and `lib/morpho/gold-fund.ts`.

**Built 2026-09-09**, the same day it was designed, on the decisions recorded
under "Decisions taken" at the end. Every number below was read live from
Ethereum mainnet at block 25938062 and cross-checked against Aave's own
indexer the same hour; `scripts/aave-gold-check.mts` re-verifies it on demand:

```bash
set -a; . ./.env.local; set +a; npx tsx scripts/aave-gold-check.mts [evmAddress]
```

Read CLAUDE.md and `docs/morpho-gold.md` first; this document assumes both,
because the venue is a sibling of the Morpho gold market and most of what it
needs already existed there.

## The one thing to get right first

**This is an Aave V4 Spoke, not Aave V3 and not a Morpho market.** V4 is a hub
and spoke design. The **Core hub** holds the liquidity for every asset and runs
one interest rate per asset. A **Spoke** is a market that draws on the hub under
its own risk parameters, and users only ever talk to the Spoke. The one the
product wants is the **Gold** spoke: it lists XAUt as collateral and seven
stablecoins to borrow, all funded from the Core hub. Reserves are numbered
per spoke, so "reserve 0" means XAUt only inside this spoke, and a user's
position is per spoke too.

Three consequences that reach the code:

1. **Collateral earns nothing here either.** The XAUt reserve is not borrowable
   (`borrowable: false`, hub drawn rate 0), so supplied gold buys borrowing
   power and nothing else. Same disclosure the Morpho card carries.
2. **The approval spender is the Spoke, not the hub.** `Spoke.supply` runs
   `safeTransferFrom(msg.sender, hub, amount)` itself, so the allowance is read
   against the Spoke. Aave's integration guide summarises this as "approve the
   hub", which is wrong for a direct caller, and it fails only after the user
   has signed. The Sourcify-verified source is the reference, not the guide.
3. **The Spoke is an upgradeable proxy and its parameters are governance
   data.** Morpho market params are immutable and the id is their hash; here
   the collateral factor, caps and bonus live in a dynamic config that
   governance can add to. Nothing risk-related is hardcoded; it is read on
   every request, and the check script pins the implementation address and
   `SPOKE_REVISION` so an upgrade is visible.

## The market

| | |
|---|---|
| Spoke ("Gold") | `0x65407b940966954b23dfA3caA5C0702bB42984DC`, proxy to `SpokeInstance` `0x70ed94a65df287dc54184963d7a9edc83dd34223`, revision 1 |
| Hub ("Core") | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9`, proxy to `HubInstance` `0xfe89fd96f270ac3c0f11921af0390dbb1340f704` |
| Oracle | `0x0083421fd178749af2201ddA5A7C3feB5790B80c`, **8 decimals**, USD |
| XAUt reserve | id **0**, hub asset id 14, `0x68749665FF8D2d112Fa859AA293F07A622782F38`, **6 decimals** |
| XAUt price source | Chainlink XAU/USD `0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6`, read 4,398.51 |
| Collateral factor | **75.00%** (dynamic config key 0) |
| Liquidation bonus | max 6.66%, min 5.99% (max × 90% bonus factor), 10% of the bonus is protocol fee |
| Target health factor | **1.3075**; max bonus below HF 0.90 |
| Collateral risk | 0 bps, so no risk premium on top of the rate |
| Supply cap | 4,500 XAUt (spoke `addCap`); 2,109 supplied, ~2,378 free |
| Signature gateway | `0xfbC184337Dc6595D8bf62968Bda46e7De7AF9c3d`, active on this spoke |

The spoke's pro.aave.com id is base64 of `1::<spoke address>`; a reserve's is
base64 of `1::<spoke>::<reserveId>`. Those are indexer ids, not on-chain ones.

### What can be borrowed

Every reserve except XAUt is a debt asset. Two caps bound a borrow: the hub's
free liquidity for the asset and the spoke's own `drawCap` less what the spoke
has already drawn. The smaller wins, and the indexer's `borrowable` is exactly
that minimum. Measured 2026-09-09:

| id | asset | decimals | rate | spoke cap | drawn | borrowable now | hub liquidity | $1,000 home to Solana USDC |
|---|---|---|---|---|---|---|---|---|
| 1 | USDC | 6 | 3.83% | 500,000 | 269,429 | **230,571** | 2,600,048 | 997.25 |
| 7 | USDT | 6 | 4.23% | 2,500,000 | 1,272,421 | **1,227,579** | 1,355,665 | 997.46 |
| 3 | USDG | 6 | 3.43% | 2,000,000 | 1,280,878 | 719,122 | 14,676,082 | 997.32 |
| 4 | frxUSD | 18 | 3.24% | 2,000,000 | 1,390,564 | 609,436 | 7,890,853 | not quoted |
| 6 | GHO | 18 | 6.72% | 1,000,000 | 131,923 | 66,842 | 66,842 | 995.87 |
| 5 | EURC | 6 | 2.93% | 200,000 | 30,215 | 169,785 | 355,268 | not quoted (EUR) |
| 2 | RLUSD | 18 | 2.59% | 125,000 | 0 | **10** | 10 | not quoted |

Rates are the hub's `drawnRate`, an annual rate in RAY, which is what
pro.aave.com labels "APY". Compounded the way `borrowApyFromRate` does for
Morpho, 3.83% reads as 3.90%; the check script prints both.

**Recommendation: USDC as the default debt asset, USDT as the second.** USDC is
the cheapest rate, it is what the rest of the app speaks, and it supports
permit, which is what makes a gasless repay possible later (below). USDT has
five times the headroom and is the fallback when USDC's spoke cap is close.
Both are already in `SWAP_TOKENS`, so the wallet panel can bring either home,
and both return legs quoted at about 0.27% on the day. RLUSD has ten dollars of
liquidity and GHO is bounded by hub liquidity at 6.7%; neither belongs in v1.

Contract addresses for the two: USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
(hub asset 5), USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7` (hub asset 4).

## The contract surface

Everything is on the Spoke. Every write takes `(reserveId, amount, onBehalfOf)`
and `onBehalfOf` must be the caller or a position manager the caller has been
approved as; the embedded wallet passes its own address.

| call | what it does | note |
|---|---|---|
| `supply(id, amount, self)` | pulls XAUt from the caller into the hub, credits supply shares | needs allowance on the **Spoke** |
| `setUsingAsCollateral(id, true, self)` | flags the reserve as collateral | **not automatic**; a supply without it backs nothing |
| `borrow(id, amount, self)` | draws from the hub to the caller | health checked at the end, at exactly 1.0 |
| `repay(id, amount, self)` | pulls the asset and restores debt | **any amount at or above the debt repays it exactly**, pulling only what is owed |
| `withdraw(id, amount, self)` | returns collateral to the caller | **any amount above the balance is a full withdrawal** |
| `multicall(bytes[])` | runs several of the above in one transaction | supply and enable-as-collateral go together; every real supply on this spoke does this |
| `permitReserve(...)` | consumes an EIP-2612 permit with the Spoke as spender | XAUt and USDC support permit, **USDT does not** |

Full repayment and full withdrawal are therefore an amount, not a share
count. That removes the Morpho `repayAll`-in-shares dance, though the repay
approval still needs headroom for the interest that accrues between the read
and the block.

### Reads

`getUserAccountData(user)` returns health factor (WAD), weighted collateral
factor (WAD), `totalCollateralValue`, `totalDebtValueRay`, risk premium and
counts. `getUserSuppliedAssets(0, user)` is the gold in the position;
`getUserTotalDebt(id, user)` is drawn plus premium debt per reserve, and both
are computed against the hub's live index, so **there is no accrue-forward step**
the way the Morpho read needs. Health with no debt reads as `uint256` max.

**Value units are USD scaled by 10^(oracle decimals + 18), so 1e26.** That is
`amount × price × 1e18 / 10^decimals`, and the hard-coded liquidation dust
threshold `1000e26` is exactly $1,000 in those units. `totalDebtValueRay` is
that times 1e27. Getting this wrong misreads a $55k position by twenty-six
orders of magnitude, which is why the check script asserts it against the
indexer.

Verified on two live positions (chain and indexer agree to the eighteenth
decimal of health):

| user | gold | debt | health | liquidation price |
|---|---|---|---|---|
| `0xbE0c…3f89` | 12.697666 XAUt | $15,034.92 frxUSD | 2.786054 | $1,578.76 |
| `0xF87e…00a5` | 0.414887 XAUt | $299.99 USDC + dust frxUSD | 4.562308 | $964.10 |

The liquidation price is `debtValue / (collateralUnits × collateralFactor)`,
and maximum borrowing power is `collateralValue × collateralFactor`, both of
which the indexer reports and both of which the first row reproduces exactly.

### There is no LTV buffer in the protocol

Aave V4 has a single collateral factor. It is both the borrowing limit and the
liquidation threshold: a borrow succeeds if health stays at or above 1.0, so
the protocol lets a user borrow to the exact edge of liquidation. Morpho does
the same with its LLTV. The card's own buffer (today a default at 80% of
headroom) is the only thing between a user and a position that is liquidatable
on the next oracle tick, and it must not be presented as a protocol limit.

### Dynamic risk configuration

Governance changes to the collateral factor add a new config key rather than
replacing the old one. A position keeps the key it was last bound to and is
rebound to the latest key on `borrow`, `withdraw` and when enabling collateral,
never on `supply` or `repay`. `getUserAccountData` uses the user's own key. So
an existing borrower can show 75% while a new one gets whatever governance set
last week, and the two numbers are both right. The market read reports the
reserve's latest key; the position read reports the user's; the card shows the
user's and warns if they differ, because the next borrow will rebind.

## Liquidation is different from Morpho, in the user's favour and against it

**For it:** liquidators repay only enough to bring health back to 1.3075, not
the whole position, and the bonus starts at 5.99% instead of a flat figure.

**Against it:** the dust rule. A liquidation may not leave less than **$1,000**
of collateral or debt behind; if it would, the whole position goes. A $600
gold position that dips below health 1.0 is therefore liquidated in full, not
trimmed. The card states this for positions under about $1,300, which is the
size at which a partial liquidation can leave $1,000 standing.

## Gas

Measured from receipts of the last fifty actions on this spoke:

| action | gas | via |
|---|---|---|
| supply + enable as collateral | 163,777 to 180,894 | `multicall` |
| borrow | 260,802 to 276,733 | direct |
| repay | 153,463 to 155,660 | direct |
| withdraw | 174,173 | direct |

A full cycle (XAUt approve, supply with collateral, borrow, USDC approve, repay,
withdraw) is about **900,000 gas**, against 700,000 on Morpho. The gas planner
in `lib/morpho/gold-fund.ts` is reused with `GAS_UNITS_FULL_CYCLE` at
**950,000** for this venue; the floor, target, probe and the 2%-of-position
rule do not change.

## Funding and the way home

Identical to the Morpho venue, because the destination is the same token on
the same chain to the same wallet. `validateTrustwareRequest`'s `gold` shape
already admits it, the ETH top-up rides the `swap` shape, and every source in
`gold-sources.ts` is priced by the same planner. The two things that are
venue-specific in `planGoldFunding` are the oracle used to value the delivered
gold (here Chainlink through the Spoke's oracle, not a Morpho oracle) and the
gas cycle constant. The Solana-gold-to-XAUt direct route was still a 502 on
2026-09-09; the two-hop fallback applies here exactly as it does there. The
value bound is the planner's too: above 3% the card shows the cost and waits
for the user to accept it, above 25% it refuses. See `docs/morpho-gold.md`.

Return legs, measured the same day: Ethereum USDC and USDT both reach Solana
USDC at about 0.27% ($2.83 on $1,000, $25.33 on $10,000).

## The gasless path, and why it is phase 2

Aave V4 ships a **SignatureGateway**: a position manager that executes EIP-712
signed intents (`supplyWithSig`, `borrowWithSig`, `repayWithSig`,
`withdrawWithSig`, `setUsingAsCollateralWithSig`) on the user's behalf, sends
borrowed or withdrawn funds to the user, and has its own `multicall`. It is
active on the Gold spoke and the spoke is registered on it. Combined with
XAUt's permit, a user with **no ETH at all** can open a position: one signature
approving the gateway as their position manager, a permit, and the three
action intents, relayed in one transaction by whoever pays gas. USDC's permit
closes the loop on repay. USDT's lack of one is the reason it is the second
debt asset, not the first.

This is not v1 for three reasons. It needs a relayer, which is a server-held
Ethereum key funded with ETH (it cannot move user funds, but it is a hosted
key and belongs with the hosted-wallet review in `docs/partner-api.md`). It
needs `signTypedData` through the embedded wallet, which Privy exposes and this
app has never used. And the direct path reuses every line of the Morpho
plumbing, including the ETH top-up, so it is the smaller first slice. The
module is laid out so the gateway is a second signing strategy behind the same
plan shape, and for the partner API it is the natural EVM step kind: the
partner relays, or Aeras does.

## What is where

**Reused unchanged:** `lib/privy/evm.ts`, the `EvmSigner` shape and the
Trustware execution helpers, `ETHEREUM_RPC_URL`, `XAUT`,
`ETHEREUM_NATIVE_TOKEN`, `GOLD_COLLATERAL_SOURCES`, the `gold` proxy shape in
`validateTrustwareRequest` (same token, same chain, same wallet), and
`SwapForm` for the exit, since Ethereum USDC is already in `SWAP_TOKENS`.

**Extracted and shared:** `lib/evm/tx.ts` now holds `ethCall`, `sendTx`,
`connectEthereum`, `waitForReceipt`, `readAllowance` and `approveIfShort`
(with the USDT zero-reset), and `lib/morpho/gold-borrow.ts` imports them.
`approveIfShort` takes the spender, which is the one thing the two venues
disagree on. `lib/morpho/gold-fund.ts` takes two venue parameters,
`gasUnitsFullCycle` on the plan and `positionRoute` on execution, and defaults
both to Morpho's, so the Morpho card is unchanged. `rpcBatch` and `call` in
`lib/morpho/gold-server.ts` are exported for the Aave reader. The Morpho card's
presentation helpers moved to `components/gold/shared.tsx`; the Aave card takes
the Jupiter and Kamino shape and its field and stat primitives from
`components/borrow-fields.tsx`, with the table's column geometry in
`components/borrow-table.ts`.

**New, under `lib/aave/`:** `gold-market.ts` (spoke, hub, pinned
implementations and revision, oracle, reserve and asset ids, the USDC token),
`gold-abi.ts` (generated from the Sourcify full-match ABIs of the two
implementations; the subset of `ISpoke`, `IHub` and the oracle we call),
`gold-server.ts` (two batched round trips for the market, one plus one for a
wallet: reserve and dynamic config, liquidation config, hub rate, liquidity
and caps, oracle prices, account data, the user's own config key, and debt on
every other reserve of the spoke), `gold-math.ts` (the Value scale, health,
borrow headroom, withdrawable collateral, liquidation price, both rate
conventions, the bonus band) with `gold-math.test.ts` pinned to the two live
positions above, `gold-borrow.ts` (approve the Spoke, `multicall` supply and
enable, enable alone, borrow, repay by amount or maximum, withdraw) and
`gold-client.ts`. Routes `app/api/aave/gold-market` and `gold-position`, same
caching as the Morpho ones. `components/AaveGoldBorrowCard.tsx`, mounted under
the Morpho card in `components/BorrowPanel.tsx`. A branch in
`lib/positions/use-positions.ts`, an `aave` entry in `VENUE_LOGOS`.
`scripts/aave-gold-check.mts`, 29 assertions, all passing on 2026-09-09.

## What the card handles that Morpho's does not

- **Collateral supplied but not enabled**, which is possible through Aave's
  own UI. The position route reports `usingAsCollateral`; the math counts
  nothing for a disabled supply; the card offers the one call that fixes it.
- **The supply cap.** The market route reports the spoke's remaining
  `addCap`. A plain supply is clamped to it before signing; a converted supply
  is clamped after the conversion lands, because the delivered amount is not
  known until then, and the surplus stays in the wallet with a message rather
  than failing the transaction after the bridge has already run.
- **Debt on other reserves.** A user who borrowed frxUSD through Aave's UI has
  it counted in health here, shown in USD, and pointed back at Aave to repay.
- **Frozen or paused reserves.** Supply and borrow are disabled with a message
  when governance freezes the reserve; repay and withdraw stay open, as the
  contract allows.
- **Dynamic config drift.** When the user's config key lags the reserve's, the
  card names both factors and says the next borrow or withdraw rebinds.
- **The dust rule.** Under about $1,300 of collateral with debt, the card says
  a liquidation would take the whole position.

## Decisions taken

1. **USDC only.** The registry carries one market. USDT is the second debt
   asset when USDC's spoke cap binds; adding it is a registry row plus a
   second entry in the routes' market loop.
2. **Direct path only.** The user pays gas; the ETH top-up in
   `lib/morpho/gold-fund.ts` is sized to this venue's 950,000-gas cycle. The
   signature gateway is verified active by the check script and is the
   phase-2 route.
3. **One row in the loan-options table**, with the table's own columns
   (market size, liquidity, balance, APY) priced at the spoke's oracle, and on
   expand the same card the Jupiter Lend and Kamino markets open: the
   available-to-borrow figure with Repay and Borrow pills, the position card
   with its status badge, a deposit-and-borrow form with the slider and the
   safety-floor chart on the gold series, and one close control that repays
   in full and withdraws. Partial repay and partial withdraw exist in
   `lib/aave/gold-borrow.ts` but have no surface, the same as the other two
   cards. It started as a second card under the Morpho gold card; the same day
   the Morpho card was unmounted and the Aave row took the table's shape.
   Balance is the user's XAUt on Ethereum, supplied plus in the wallet, since
   both are the same token.
4. **No fee mechanism**, the same as the Morpho row in `docs/partner-api.md`.

## Not yet done

- **Live signing.** Supply, borrow, repay and withdraw are typechecked, and
  the read side is verified live, but no transaction has been signed from the
  app against this spoke yet. The first live test is 0.01 XAUt in and out and
  a $20 USDC borrow repaid with the maximum, watching that the position
  closes with zero dust.
- **Phase 2, the gasless path.** Needs Privy's embedded EVM wallet signing
  `eth_signTypedData_v4` for the gateway domain (name `SignatureGateway`,
  version `1`, chain 1), a relayer, and a check that `permitReserve` accepts
  XAUt's permit in practice, since the token predates the EIP-2612 final
  text.
- **The exact revert when the spoke `addCap` is reached** has not been
  provoked; the card clamps before signing instead.
- **The 12 XAUt gap** between the on-chain reserve total (2,109.46) and the
  indexer's (2,121.83) on the day of measurement is still unexplained. Likely
  a withdrawal between reads.
