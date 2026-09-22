# Aeras Vault I: the Blend `aeras-earn` account type as an Earn venue

Read this before touching `lib/blend/`, `app/api/blend/`,
`components/BlendVaultsCard.tsx`, or the Aeras Vault I column in
`components/EarnPanel.tsx`.

**Naming.** The product is "Aeras Vault I" (`BLEND_VENUE_NAME`); that is the
column header, the tab and the venue name everywhere a user reads it, under
the Aeras mark. "Blend" is the infrastructure and the internal identifier
(`lib/blend`, the `"blend"` venue id, the `blend*` props), and it is disclosed
in the expanded panel's copy the way the Morpho form names Morpho and the
curator, not in the label. The portal's own display name for the account type
is still "Aeras Earn"; nothing in the app reads it.

**Started 2026-09-14.** Slice 1 (the column, the yield proxy, the check
script), slice 2 (the deposit, the position read, the panel) and slice 3 (the
withdrawal) are built. No sponsor key is involved anywhere: the user's wallet
pays gas on every chain. Everything below marked *verified* was read live from
Blend's API on 2026-09-14 or 2026-09-21; `scripts/blend-check.mts` re-verifies
it on demand and is the record for anything this file does not yet state:

```bash
set -a; . ./.env.local; set +a; npx tsx scripts/blend-check.mts
```

The script signs in with a throwaway key, so each run leaves one junk user
row in the portal's user list. It signs and submits nothing on chain.

Read CLAUDE.md first, in particular Chain Assumptions: this is the fourth
venue where a position lives off Solana, and it is reached the way
Morpho-on-Monad is, through the embedded EVM wallet and the Trustware
Solana-to-Monad USDC leg in `lib/morpho/fund.ts`.

## The one thing to get right first

**Blend is not a vault. It is a per-user Gnosis Safe plus an allocation
policy.** The account type (`aeras-earn`, set in the portal under Accounts)
names a set of catalog vaults with percentage weights. Every user who signs in
gets a Safe of their own, the same address on every chain, and Blend routes
that Safe's USDC across those vaults and rebalances it as the weights drift
("flow plans", auto-approved for this account type). The user is the Safe's
only signer; Blend can move funds between the whitelisted venues and nowhere
else. Aeras never holds a key.

Four consequences that reach the code:

1. **The frontend SDK, never the server SDK.** `@blend-money/fe` authenticates
   with a SIWE signature from the user's own wallet. The server SDK's model is
   a server-held signer that owns the Safe, which would make Aeras the
   custodian. The server API (`X-API-Key`) is used, but only read-only and
   only from route handlers: yield for the Earn column, and later the
   position read.
2. **A deposit lands on the account type's first configured chain, not the
   chain it is sent from.** Blend's architecture doc: "the destination is the
   first configured chain with vault infrastructure." The portal lists
   Ethereum first for `aeras-earn` today, so a deposit from Monad would bridge
   to Ethereum and then rebalance across all three chains. Which chain that is
   is portal state; the code reads it from the deposit quote
   (`destinationChainId`) and never assumes it. *Verified 2026-09-21:* a
   1 USDC quote from Monad answered `destinationChainId 143`, so it stayed on
   Monad. Whether that is because the portal's chain order changed or because
   an origin that has vault infrastructure keeps the deposit is not
   established; the deposit path reports whichever chain the quote names and
   the result card says "on Monad" or "sent to X" accordingly.
3. **Every frontend endpoint needs a signed-in user, discovery and yield
   included.** *Verified:* `depositChains` without a SIWE bearer answers 401
   `AUTH_NOT_SIGNED_IN`, contrary to the SDK's own `DiscoverModule` comment.
   The Earn table has to draw the Blend column before anyone has signed
   anything, which is why `app/api/blend/yield` reads
   `GET /extern/svr/aeras-earn/yield` with the server key instead.
4. **The user's wallet pays gas, on every chain, and no paymaster exists.**
   A deposit is a `direct` plan: *verified 2026-09-21*, zero approvals and one
   ERC-20 `transfer` of USDC from the EOA to the Safe's own address on Monad,
   paid in MON (the top-up in `lib/morpho/fund.ts` covers it). Blend deploys
   the Safe at first deposit on its own side. A withdrawal is a `multisend`
   plan per source chain, which Blend's SDK would send as an ERC-4337
   UserOperation paid by a Pimlico paymaster (its constructor insists on a
   registry). This app does not: the embedded wallet is the Safe's sole owner
   at threshold 1 and the Safe carries no transaction guard (*verified on the
   user's own Safe, all three chains, 2026-09-22*), so the wallet calls the
   Safe's `execTransaction` itself with Safe's pre-validated signature (v = 1,
   r = the owner; accepted when `msg.sender` is that owner, GS026 otherwise)
   and the batch runs as a delegatecall into MultiSend. One ordinary
   transaction per chain, paid by the wallet: MON on Monad, ETH on Ethereum,
   ETH on Base. `lib/blend/safe.ts` is the encoding, `lib/blend/execute.ts`
   the submission, and `lib/blend/gas.ts` buys what is missing from Solana
   USDC first. The SDK is still used for sessions, quotes and settlement
   polling, through its public session module with our submission step; its
   own `execute` is never called and it is constructed with an empty
   registry.

## Facts, as of 2026-09-14

| | |
|---|---|
| Account type | `aeras-earn` ("Aeras Earn"), created 2026-09-10 |
| Chains Blend is deployed on | Base 8453, Ethereum 1, Arbitrum 42161, Polygon 137, Scroll 534352, HyperEVM 999, Botanix 3637, Monad 143. No Solana. |
| Deposit source chains | *verified:* 51, bridge sources included; Monad is one |
| App chain | Monad 143 (`BLEND_APP_CHAIN_ID`), USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Allocation (portal) | 7 vaults at ~14.3% each: Aave Ethereum USDC, Yearn OG USDC (Morpho, Ethereum), Steakhouse Prime Instant and Gauntlet USDC Prime (Morpho, Base), August USDC V2 and Hyperithm USDC Apex (Morpho, Monad), Aave Monad USDC |
| Strategy status | pending on 2026-09-14 (withdraw destinations, yield and quotes all 404 "No vault config deployed for this account type"); **provisioned by 2026-09-21**, when yield returned three vault rows (chains 1, 143, 8453) and the deposit quote answered |
| Deposit quote, 1 USDC from Monad | *verified 2026-09-21:* origin 143, destination 143, output 1 USDC, fees $0.000065, `estimatedSeconds 0`, expiry about **15 minutes** after the quote. Plan `direct`, one `transfer` from the EOA to the Safe's own (counterfactual) address, no approval |
| Withdraw quote, everything to Monad, empty account | *verified 2026-09-21:* Blend does not refuse it. `totalAmount 0`, `totalFeesUsd $0`, `sourceChainIds []`, `estimatedSeconds 0`, a session that then has to be cancelled. The form gates on the position instead |
| Withdraw quote, everything to Monad, funded account | *verified 2026-09-22* on a $10.04 position spread across Ethereum, Monad and Base: three payloads, one `liquidityReset` delegatecall step each ("Atomic withdrawal via UserWithdrawController"), bridge fees $0.05 (Ethereum) and $0.03 (Base), `timeEstimate 1s`. Simulated from the owner: Ethereum 1.91M gas ($0.85 at 0.10 gwei), Base 1.67M gas (under a cent), **Monad reverts** for the full slice, see below. Where the USDC lands, by trace: on Monad the step redeems to the Safe and the Safe transfers to the wallet in the same transaction; the Ethereum and Base steps hand the bridge the Safe on Monad as recipient |
| The Monad revert | *verified by `debug_traceCall` on the public Monad node, 2026-09-22:* the full-slice withdrawal fails inside Morpho's Monad vault with `ERC20: transfer amount exceeds balance` on USDC, that is, the vault did not hold enough idle USDC to redeem the whole position (43% of it deployed that day). Not an app defect: Blend's own module path fails identically. Bisected the same evening: 3.53 USDC of the 4.30 USDC slice simulated OK, 3.56 did not. **Blend fills a partial withdrawal from the destination chain first**: 1 USDC, 4.30 USDC and 6 USDC requests all produced a Monad-only payload, so the Monad vault's idle liquidity caps the whole withdrawal, not just its slice, until it refills. The review detects the revert by simulation, then bisects the largest amount that simulates (seven quotes, each cancelled) and offers to review that instead |
| Safe | *verified 2026-09-22* on chains 1, 143 and 8453: Safe v1.5.0, owners `[the embedded wallet]`, threshold 1, modules `[Safe4337Module, a Blend module per chain]`, fallback handler Safe4337Module, guard slot zero. Owner `execTransaction` with the pre-validated signature simulates OK on Ethereum and Monad; Base's public node rate-limited the probe |
| Yield rows | *verified 2026-09-21:* Ethereum 6.60% overall (aEthUSDC, ymvOG-USDC), Monad 5.90% (AugustUSDCv2, hyperUSDCa, aMonUSDC), Base 4.40% (steakUSDC, gtUSDCp). One row per chain, not per vault: the seven portal vaults collapse into three chain vaults |
| SIWE domain | `aeras.finance`. *Verified:* sign-in works from Node with no browser origin, so origin is not enforced and local dev uses the same value |
| Safe for a new account | *verified:* `not-deployed` on every chain; `execute()` deploys it on the destination chain at first deposit |
| API host | `https://api.portal.blend.money`; `/extern/fe` (publishable key + SIWE bearer), `/extern/svr/{accountTypeId}` (API key) |
| SDK | `@blend-money/fe` 3.0.1, which bundles viem 2.55.8; the repo's viem was raised to match so `deriveSigner` returns the same `WalletClient` type |
| Paymaster | None. The SDK's registry is passed empty and never read (consequence 4) |
| Billing | none yet; the portal gates production on it |

## Keys

| Variable | Where | What |
|---|---|---|
| `NEXT_PUBLIC_BLEND_PUBLISHABLE_KEY` | client | `pk_live_` + 64 hex. Per account type, on its Settings page. Blend documents it as safe to embed: it identifies the account type and authorises nothing without the user's SIWE bearer |
| `BLEND_API_KEY` | server only | `sk_live_…`, Credentials page, shown once. Read only by `app/api/blend/*` |
| `BLEND_ACCOUNT_TYPE_ID` | server, optional | overrides `BLEND_ACCOUNT_TYPE_ID` in `lib/blend/constants.ts` |
| `PIMLICO_API_KEY` | not used | A paymaster proxy was built and removed the same day (2026-09-22) in favour of the user's wallet paying its own gas. Nothing reads this variable |

## What is built

- `lib/blend/constants.ts`: account type, host, app chain, publishable key
  accessor, and the header comment that holds the four consequences above.
- `app/api/blend/yield/route.ts`: the server-key yield read. 60-second TTL,
  30-minute stale grace with `x-aeras-stale: 1`, 503 with Blend's own sentence
  when nothing is cached (a missing key and an unprovisioned strategy both
  land there, each with its reason).
- `lib/blend/client.ts`: the browser reader for that route.
- `components/BlendVaultsCard.tsx`: `useBlendEarn`, polled on the table's
  60-second cadence, and `blendStrategyApy`. The yield endpoint returns one
  row per vault and no weights; with every vault at an equal weight, the
  unweighted mean of the rows' `theoreticalOverall` is the strategy's rate.
  Revisit if the weights diverge. *Pending: which of Blend's four rates the
  column should show, decided against live numbers.*
- `components/EarnPanel.tsx`: a fourth venue column. The grid went from
  twelve columns to fourteen (asset 3, four venues at 2, deposit 2, chevron
  1), `VenueTabs` from three to four, and `usableByVenue.blend` is `false`
  until the deposit panel exists, with the suggested venue now checked for
  usability so a venue that leads on rate but has no form cannot become the
  expanded selection.
- `public/logos/blend.png`: Blend's leaf mark, from docs.blend.money's
  favicon, at 128px.
- `scripts/blend-check.mts`: the live check. It now decodes the deposit
  plan's `transfer` recipient and says whether it is the Safe, and prints the
  quote's time to expiry.

Slice 2, 2026-09-21:

- `lib/blend/session.ts`: the SIWE session in sessionStorage keyed by
  address (Blend's guidance), and the account marker in localStorage that
  gates the position read. Read the header comment for the trade-off.
- `lib/blend/signer.ts`: the embedded wallet as the viem `WalletClient` and
  `PublicClient` the SDK's `deriveSigner` wants, built over `custom(provider)`
  on the provider `connectMonad` returns after its chain read-back. The only
  viem wallet client in the app; CLAUDE.md records the exception. Monad only:
  any other chain id throws before anything is signed.
- `lib/blend/sdk.ts`: loads `@blend-money/fe` on demand (axios, permissionless
  and viem's account-abstraction code stay out of the Earn tab's bundle),
  restores the tab's session or signs in, marks the address as having an
  account, and persists the session.
- `lib/blend/deposit.ts`: fund, sign in, quote, guard, execute. The order
  matters: funding can take minutes and a quote lives fifteen, so the quote
  is taken after the Trustware legs settle. The guard refuses when fees
  exceed 1% of the amount, two orders of magnitude above the measured fee.
  Every quote passes `forceReset: true`, because Blend allows one open
  session per account and a closed tab would otherwise wedge the next
  deposit.
- `lib/morpho/fund.ts` `ensureMonadUsdc`: the fresh-read, plan and execute
  half of `depositUsdcWithFunding`, lifted out so the Blend deposit funds the
  Monad wallet through exactly the code the Morpho deposit does.
  `connectMonad` in `lib/morpho/deposit.ts` is exported for the same reason.
- `app/api/blend/position/route.ts`: account by EOA address, then that
  account's balance across chains, summed into 6-decimal USDC. 15-second
  TTL, 5-minute stale grace. The account lookup creates the record when
  there is none, which is why the client only asks for marked addresses.
- `lib/blend/client.ts`: `fetchBlendPosition`.
- `components/BlendVaultsCard.tsx`: `useBlendEarn` now also owns the
  embedded EVM wallet, the Solana signer and the position; `BlendVenuePanel`
  lists the strategy's chain vaults with the position's share of each and
  mounts the deposit form, or a one-line notice in withdraw mode.
- `components/EarnPanel.tsx`: the venue is selectable, the row opens on it,
  the position column includes it, and a settled deposit refreshes the Blend
  position and the Monad balances together.

Slice 3, 2026-09-22, withdrawals, owner-paid:

- **What a withdrawal is.** `quoteWithdraw` to Monad (a withdraw
  destination, verified) makes Blend build one `multisend` plan per chain
  the position sits on, each a single delegatecall step into Blend's
  UserWithdrawController: redeem the vault shares and, off the destination
  chain, hand the USDC to a bridge addressed to the Safe on Monad. The owner
  sends each plan as one `execTransaction` on the Safe there and pays that
  chain's gas. Blend gets the hashes through the SDK's session module and is
  polled to settlement. The destination slice lands in the wallet directly;
  the bridged slices land in the Safe on Monad, and one more owner
  transaction sweeps them into the wallet. The wallet panel's Monad-to-Solana
  leg takes it home.
- `lib/blend/safe.ts`: the Safe as its owner drives it. MultiSend packing,
  the pre-validated signature, `execTransaction` with every gas field zero
  (the Safe then reverts the whole transaction if the batch fails, bubbling
  the inner reason on v1.5.0), and `encodeOwnerBatch`. Tested against
  hand-packed bytes.
- `lib/blend/execute.ts`: `ownerTransactionsOf` (a Safe plan is one
  transaction to the Safe; a direct plan is its transactions in order),
  `submitBlendActionPlan` (switch and read back the chain, `eth_estimateGas`
  first so a reverting batch is refused unsigned, send with the estimate plus
  a quarter as the limit, wait for the receipt) and `runBlendQuote`
  (`sdk.sessions.execute` with that as `submitActionPlan`, mapped through
  the SDK's own `toExecuteResult`). Deposits run through the same path.
- `lib/blend/gas.ts`: `reviewPlansGas` simulates every plan where it runs
  and prices it (gas units times `eth_gasPrice`, the wallet must hold 1.5x),
  and `ensureGasForChain` buys what is missing from Solana USDC: the Monad
  leg from `lib/morpho/fund.ts` (0.5 USDC of MON), the Base leg from
  `lib/glider/exit.ts` (2 USDC of ETH), and the Ethereum leg sized by
  `lib/trustware/eth-gas.ts` from the live estimate under its allowance
  rule. Each waits for the balance to be readable on the chain.
- `lib/blend/withdraw.ts`: `quoteBlendWithdraw` (sign in, quote, read the
  plans off the session, simulate, price) returns a review with one row per
  chain: amount, bridge fee, gas in native units and USD (from
  `/api/prices/native`), whether gas must be bought, and the revert sentence
  when the step would fail; `blocked` is set when any chain would.
  `executeBlendWithdraw` buys the gas, re-quotes if less than 90 seconds of
  the quote remain, runs the session, then sweeps the Safe's USDC on Monad.
  When a chain's step reverts, `findWithdrawableNow` bisects between zero
  and the failed amount (quote, simulate, cancel, seven steps to a cent) and
  the review carries `withdrawableNowAtomic`.
- `lib/blend/revert.ts`: the revert reason out of a provider's error. Privy's
  provider throws viem-shaped errors, several lines ending in `Version:
  viem@x.y.z`, and the first parser showed that trailer as the reason on the
  review card (2026-09-22). Reasons are found by name now and anything that
  is not a sentence falls back to the chain's name. Tested against both
  shapes.
- `lib/blend/signer.ts` is now the SIWE `personal_sign` alone; there is no
  viem wallet client anywhere in the app again.
- `components/BlendVaultsCard.tsx`: `BlendWithdrawForm`, two steps. Review
  shows the per-chain rows. A blocked review leads with the ceiling ("that
  vault can only redeem about 3.53 USDC at the moment"), offers a "Review
  3.53 USDC instead" button that re-runs the review at that amount, and
  shows Back alone; Confirm is not drawn. Confirm runs an unblocked review.
  Back cancels the quote's session. The amount control is shared with the
  deposit form.
- `scripts/blend-withdraw-sim.mts`: the live check for all of this. Takes
  an embedded EVM address, quotes everything to Monad on the server API,
  assembles each chain's owner transaction exactly as the app does, and asks
  each chain to estimate it from the owner, then cancels the session. A
  revert here is the proof of a step that would fail; the public Monad node
  answers `debug_traceCall`, which is how the liquidity revert was read.
- `lib/blend/server.ts`: the server-key `fetch` the position route uses.

What was removed the same day: a paymaster proxy (`app/api/blend/paymaster`,
a Privy-verified session cookie binding the wallet to its Safe, an HMAC
token) that would have let a Pimlico key sponsor the SDK's UserOperations.
It needed a Pimlico account and billing, and nothing about the Safe required
it.

**Not verified live:** a withdrawal that signs. It needs a signed-in
browser. The first run should watch two things: that Privy sends the owner
transaction on each switched chain without a modal, and where the bridged
USDC lands after Blend reports settled (the sweep expects the Safe on
Monad). The full-position withdrawal will be refused at review until the
Monad vault holds enough idle USDC; a partial amount is the way to test.

## Decisions taken

- **Monad as the app chain**, because the Solana-to-Monad USDC funding leg,
  the Monad-to-Solana return leg and the MON gas top-up already exist and are
  verified, and Monad is already in Privy's `supportedChains`. Where the
  position then settles is Blend's decision (consequence 2), which is a
  separate, still-open question: keep all seven vaults across three chains
  and write a Chain Assumptions exception for Base and Ethereum positions, or
  trim the allocation to the three Monad vaults so nothing bridges.
- **No second SDK.** The server API's two read endpoints are plain `fetch`
  from route handlers, the same way the Kamino and Jupiter proxies are built.
- **Rotate `BLEND_API_KEY`** once the integration is stable; the first one
  was pasted into a chat.
- **Quote after funding, not before.** A preview quote would need the
  sign-in first and would be stale by the time a bridge settled; the fee is
  bounded by the guard instead and shown on the result card.
- **The position read is gated, not free.** Blend's by-address lookup creates
  an account, so the table only asks for addresses that have signed in from
  this browser. A user who deposited elsewhere sees the position after the
  panel's next sign-in here. The alternative, a Blend account for every Aeras
  wallet, was judged worse.
- **One viem wallet client**, in `lib/blend/signer.ts`, because the SDK's
  `execute()` takes nothing else. It is created after the chain read-back and
  viem asserts `eth_chainId` again before it sends.
- **The wallet pays its own gas; no sponsor.** Blend's SDK sponsors Safe
  operations through a paymaster because its customers' users hold no gas.
  Ours does, or can buy it from Solana USDC in one leg, and the Safe's owner
  can send `execTransaction` directly. That removed a Pimlico account, a key
  in production, an authorised proxy and a signed cookie, and left one
  ordinary transaction per chain that any explorer shows. The cost is that
  Ethereum gas is the user's: about $0.85 at 0.10 gwei for a slice, shown on
  the review, and `lib/trustware/eth-gas.ts`'s allowance refuses to buy gas
  that would swamp the amount.
- **Simulate before signing, and show the result.** Every chain's
  transaction is estimated from the owner at review. A step that would
  revert is a sentence on that chain's row and Confirm is disabled, because
  the alternative is a transaction the user paid for that reverted.
- **Review before confirm on withdrawals, one click on deposits.** A deposit
  may need a bridge that outlives the quote; a withdrawal does not, so its
  fee, sources and gas can be shown inside the quote's fifteen minutes, and
  the gas legs re-quote if they use it up.

## Next

1. One partial withdrawal from a signed-in browser (a few USDC to Monad,
   which Blend draws from the Monad slice with no bridge), then one that
   touches Ethereum or Base, watching the two things under "Not verified
   live".
2. The positions panel (`lib/positions/use-positions.ts`) should list the
   position; today only the Earn table does.
3. Rotate `BLEND_API_KEY`.
