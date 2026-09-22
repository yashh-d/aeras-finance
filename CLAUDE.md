# Aeras Finance

Aeras Finance is a tokenized asset lending platform built as a thin, opinionated layer on top of established DeFi primitives. Users log in with email or social via Privy, buy tokenized equities (xStocks) through Jupiter, and lend them on Kamino to earn yield. The product thesis is that tokenized RWAs become genuinely useful when they are composable with DeFi money markets, and that most users do not want to touch a wallet UI or bridge to get there.

This file is the source of truth for how to build in this repo. Read it at the start of every session.

## v1 Scope

The first version ships one flow end to end:

1. User lands on the app and logs in with Privy (email, Google, or wallet). Privy provisions an embedded Solana wallet for users without one.
2. User funds the wallet with USDC (manual deposit for v1, on-ramp later).
3. User selects an xStock from a curated list and buys it with USDC via the Jupiter Ultra API.
4. User deposits the xStock into a lending venue (Kamino or Jupiter Lend) and sees their position with live APY. Venue selection is a Stage 3 design decision; both are in scope for v1.
5. User can withdraw at any time.

Anything beyond this (multi-asset positions, fiat on-ramp, mobile) is out of scope for v1. Work built on top of this flow since it shipped is listed under Built Since v1.

## Stack

- Next.js 15 with App Router and TypeScript
- Privy React SDK for auth and embedded wallets, configured for Solana
- Solana web3.js and SPL token for chain interactions
- Jupiter Ultra API for swaps
- Lending: Kamino klend SDK (`@kamino-finance/klend-sdk`) and/or Jupiter Lend — venue chosen in Stage 3
- Tailwind for styling, shadcn/ui for components
- Deploy target: Vercel

Pin all SDK versions in package.json. Do not use caret ranges for Privy, Jupiter, or Kamino packages, since their APIs move quickly.

## Chain Assumptions

Solana mainnet holds every position. All xStocks live on Solana via Backed Finance, and Kamino and Jupiter Lend are both Solana-native. Deposits, borrows, and withdrawals settle on Solana.

EVM chains appear only as a source of funds **for anything that becomes a position**. The Trustware layer in `lib/trustware` lets a user who already holds a tokenized-stock equivalent on Ethereum (chain `1`) or BNB Chain (chain `56`) convert it into the canonical Solana xStock and deposit that. The destination is always the user's Solana address. The supported source tokens are a hardcoded registry in `lib/trustware/equivalents.ts`, not anything the user can pass in.

The swap surface is the one exception, and it is deliberate. A swap may end on an EVM chain: Solana USDC to Ethereum USDT is a supported pair. That is wallet plumbing, not lending, and it does not weaken the rule that a *position* never settles off Solana. Its tokens are a separate hardcoded registry in `lib/trustware/swap-tokens.ts`, and both sides of a pair must be in it.

**Base is a source of USDC and nothing else.** No venue, no position, no tokenized-stock entries in the equivalents registry. It is offered only because `lib/trustware/base.ts` can move USDC off it to Solana, and that is the bar for listing any chain here: a chain a user can receive on but not spend from strands funds, which is exactly what the wallet panel's "cannot be moved" warning exists to say about every chain that is *not* listed. Verified live by `scripts/trustware-base-check.mts` (2026-08-28, 4/4 sizes signable). Two things that fall out of the measurements: the route costs about $0.30 flat, so a $5 move loses 5.4% of itself and the form warns below $25; and gas is ETH on Base with no automatic top-up, because Base USDC arrives from outside the app so there is no inbound leg to attach one to, unlike Monad.

**Ondo tokens live on Solana by default.** An Ondo `...on` token is only ever meant to be on Ethereum for as long as it is posted on Ondo Perps as margin for a trade or a hedge. Ethereum is a waypoint, not a home: sitting in the embedded EVM wallet the token earns nothing, backs nothing, cannot be lent on Kamino or Jupiter Lend, and cannot be sold without another bridge, while the same asset as a Solana xStock trades on Jupiter and works everywhere else in the app. So any surface that shows an Ondo token on Ethereum must offer the way back (`lib/ondo/unwind.ts`, surfaced as "Move to Solana" in the wallet panel). The conversion is never automatic: it needs two Ethereum signatures and costs real money, so it is always the user's call. This is about what the app offers by default, not what it does unasked.

Morpho-on-Monad earn is the second, larger exception, and here a *position* really does live on an EVM chain. Users deposit USDC into a Morpho Vaults V2 (ERC-4626) vault on Monad mainnet (chainId 143) and earn its yield; the shares sit in the user's embedded EVM wallet, not on Solana. `lib/morpho` holds the curated vault registry and Monad constants, `app/api/morpho` serves live APY (Morpho's indexer) and per-wallet positions (Monad RPC reads). Funding runs through Trustware with a Monad-USDC destination, the same universal-deposit machinery the Solana path uses, pointed at an EVM chain instead. This is the one place the "positions settle on Solana" rule is knowingly broken; treat it as venue-scoped, not a general license to settle elsewhere.

**Morpho-on-Ethereum gold borrow is the third exception**, and the only one where a *borrow* settles off Solana. Users post XAUt (Tether Gold, one troy ounce, **6 decimals**) as collateral in a Morpho Blue market on Ethereum mainnet and draw USDT against it at 77% LLTV. `lib/morpho/gold-*.ts` holds it, `app/api/morpho/gold-market` and `gold-position` serve live state read from Ethereum, and `components/GoldBorrowCard.tsx` is the surface. Funding converts gold the user already holds on Solana (GLDx, GLDon, XAUt0) into XAUt through Trustware, and buys ETH for gas because the embedded wallet is born with none.

Two things separate it from the Monad venue and are easy to get backwards. It is a Morpho Blue **market**, not an ERC-4626 vault: different contract, different math, and **collateral in it earns nothing** (only USDT suppliers earn, and they are a different party). And the exit is open in both directions, so it is not a one-way door: Trustware routes Ethereum USDT back to Solana USDC at about 0.3%. Read `docs/morpho-gold.md` before touching any of it, especially the sections on decimals, USDT's non-compliant `approve`, and why a full repayment is sized in shares.

**Aave V4's Gold spoke on Ethereum is the same exception a second time**, as of 2026-09-09: the same XAUt collateral on the same chain in the same embedded wallet, borrowing USDC instead of USDT, in `lib/aave/gold-*.ts`, `app/api/aave/gold-*` and `components/AaveGoldBorrowCard.tsx`. It is the gold row of the Borrow tab's loan-options table, with the same four columns the Solana rows carry (market size, liquidity, balance, APY) priced at the spoke's oracle. **The Morpho gold card is no longer mounted** as of the same day; `lib/morpho/gold-*` stays because the funding planner lives there and an existing Morpho position still reads in the positions panel. What separates Aave from that market: a 75% collateral factor that is both the borrowing limit and the liquidation threshold (there is no LTV buffer in the protocol), partial liquidations that restore health to 1.3075, and a dust rule that liquidates positions under $1,000 in full. Read `docs/aave-gold.md` before touching it, especially why the approval spender is the Spoke and not the hub, why a supply is a `multicall` with `setUsingAsCollateral`, and why nothing risk-related is hardcoded.

**Aave-on-Ethereum earn is the fourth exception**, the second *earn* position off Solana. Users deposit USDC or USDT into two kinds of Aave ERC-4626 vault: the stata token (`waEthUSDC`, the Aave V3 Core supply rate, instant exit) and the Umbrella stake token (`stkwaEthUSDC`, the same rate plus safety incentives, in exchange for taking first loss on Aave's bad debt and a **20-day cooldown plus 2-day window** to leave). `lib/aave` holds the registry, the on-chain read layer and the write path; `app/api/aave` serves rates and positions read from Ethereum; `components/AaveVaultsCard.tsx` is the venue inside the Earn table. Funding is the Monad machinery pointed at Ethereum, with ETH for gas bought through `lib/trustware/eth-gas.ts` (shared with the gold market). Read `docs/aave.md` before touching it. **It was built without live verification** (the session could not reach Ethereum), so `scripts/aave-check.mts` must pass before the venue is shown to anyone.

EVM code is confined to four files. `lib/privy/evm.ts` resolves the embedded EVM wallet and hands back its EIP-1193 provider. `lib/trustware/evm-tx.ts` translates a Trustware route payload into `eth_sendTransaction` params. `lib/trustware/execute.ts` grants ERC-20 allowances, switches the wallet's active chain, broadcasts the source leg, and tracks the route to settlement. `lib/ethereum/tx.ts` is the Ethereum-mainnet version of that plumbing for the venues that call contracts directly: chain switch with read-back, send, receipt wait, and a USDT-aware approval. Nothing outside those files should reach for an EVM provider. (The venue modules `lib/morpho/deposit.ts`, `lib/morpho/fund.ts`, `lib/morpho/gold-borrow.ts`, `lib/aave/gold-borrow.ts` and `lib/aave/deposit.ts` also sign EVM transactions, but only through the signer shape `lib/privy/evm.ts` exposes.)

**The Solana RPC is two endpoints, not one**, as of 2026-09-14.
`NEXT_PUBLIC_SOLANA_RPC_URL` is the primary (Alchemy) and serves every read,
including `getPriorityFeeEstimate`, which `lib/solana/priority-fee.ts` needs and
which Alchemy answers Helius-compatibly. `NEXT_PUBLIC_SOLANA_RPC_FALLBACK_URL`
is Helius and serves the two things the primary will not on our plan:
`getProgramAccounts`, refused in under 100ms with a compute-units-per-second 429
whatever the filters narrow it to, and every websocket subscription method,
answered `-32601`. `lib/solana/program-accounts.ts` routes the first and
`lib/privy/provider.tsx` points `rpcSubscriptions` at the second.

Three things about that split. The socket is load-bearing, not cosmetic:
`components/SendComposer.tsx` and `components/WithdrawPanel.tsx` sign through
Privy's `useSignAndSendTransaction`, which confirms over it, so a dead
subscription endpoint strands a send that already landed. Our own broadcast path
is unaffected, because `lib/solana/send-confirm.ts` polls `getSignatureStatuses`
and holds no socket at all. And the fallback is chosen by a **separate cheap
probe** rather than by trying the real call and catching the failure: web3.js's
`Connection` retries a 429 itself, backing off 500ms, 1s, 2s and 4s, so a
refused scan costs 8.7 seconds rather than the 70ms the endpoint takes to say
no, and `lib/borrow/use-borrow-summary.ts` runs thirteen of them behind the
positions card.

Both Solana vars are `NEXT_PUBLIC_`, so both keys reach the browser; set a
domain allowlist at each provider. Do not use the public mainnet-beta endpoint
for anything beyond local prototyping. Re-run `scripts/rpc-endpoints-check.mts`
after any plan change at either provider: it prints what each endpoint serves,
and it says so explicitly if the primary starts serving both, at which point the
split and `lib/solana/program-accounts.ts` can go.

EVM reads have their own endpoints, `ETHEREUM_RPC_URL` and `MONAD_RPC_URL`,
server-only and both on Alchemy (`lib/ethereum/constants.ts`, batched through
`lib/ethereum/rpc.ts`). Unset, they fall back to the public nodes named there
and in `lib/morpho/constants.ts`. They back the Ethereum venues (the two gold
borrow markets and the Aave vaults) and Morpho-on-Monad, and nothing signs
through them; the embedded wallet still signs via Privy. Trustware still
proxies allowance reads and cross-chain balance scans, which is what the
`/sdk/rpc/evm` and `/data` endpoints in `lib/trustware/constants.ts` are for.

## Repo Layout

```
/app                 Next.js App Router routes
  page.tsx           Landing page
  /app               The authenticated product surface
  /api               Server routes. Third-party keys stay on this side.
    /admin/approve   Waitlist approval, guarded by ADMIN_SECRET
    /auth/sync       Verifies the Privy token, upserts the Supabase user row
    /jupiter         Ultra orders, swap quote/build, Lend earn and borrow,
                     prices, charts, sparklines, trigger orders
    /kamino          KTX transaction proxy, reserve and kvault metrics,
                     kvault positions, obligations
    /morpho          Monad vault metrics (indexer) and per-wallet positions
                     (Monad RPC reads); gold-market and gold-position for the
                     Ethereum Blue market (Ethereum RPC reads)
    /aave            Ethereum vault rates (Pool and Umbrella emissions) and
                     per-wallet positions, cooldowns and rewards, plus
                     gold-market and gold-position for the Aave V4 Gold spoke
                     (Ethereum RPC reads)
    /lighter         Lighter perps market catalog
    /news            Headlines for the Terminal: market-wide feeds, or one
                     catalog asset's coverage (?asset=<mint>), read from public
                     RSS server-side and cached per feed
    /ondo            Ondo perps: market catalog, SIWE session, account
                     snapshot, terms, orders, deposit address, withdrawal
                     address book and withdrawals
    /prices/native   Native asset prices
    /spend           Rain card issuance and purchase history
    /strategies/runs Strategies-page run bookkeeping, per user
    /trustware       Route, quote, balances, allowance, receipt, status proxies
    /waitlist        Public signup
/components          UI components
  /ui                shadcn primitives
/lib
  /aave              Aave on Ethereum. The earn vaults: curated stata and
                     Umbrella registry, ABIs, rate and cooldown math, server
                     reads, the write path and Trustware funding. The V4 Gold
                     spoke (gold-*.ts): registry, ABI subset, position math,
                     server reads, write path
  /borrow            Borrow summary and market stats hooks
  /ethereum          Ethereum mainnet constants, batched server-side RPC reads,
                     and the client transaction plumbing shared by the venues
                     that settle there (Morpho gold, Aave gold, Aave vaults)
  /jupiter           Ultra client, Lend earn/borrow, looping, triggers,
                     prices, curated xStock list
  /kamino            Reserve metadata, kvaults, positions, borrow helpers
  /lighter           Lighter perps: markets, sizing, risk, hedge construction
  /ondo              Ondo perps: markets, sizing, risk, hedge routing, the
                     execution core (builder code, orders, SIWE session),
                     margin funding (collateral discovery, Trustware deposit)
                     and withdrawals (address book, per-asset reconstruction)
  /news              Feed registry, a small RSS reader, merge and dedupe, the
                     server cache and the client hook behind the Terminal's rail
  /terminal          The quote model the ticker tape and overview strip share
  /morpho            Two separate Morpho venues. Monad earn: curated USDC vault
                     registry, Monad constants, client read helpers. Ethereum
                     gold borrow (gold-*.ts): the XAUt/USDT Blue market, its
                     position math, Trustware funding and the write path
  /privy             Privy config, auth, Solana and EVM wallet hooks
  /strategies        The Strategies page's math, live rate join, signed legs,
                     step runner and run store. See docs/buy-strategies-plan.md
  /solana            Connection, balances, holdings, sending, activity, plus
                     the shared broadcast path: priority-fee.ts (compute unit
                     pricing) and send-confirm.ts (sendAndConfirm)
  /supabase          Server-only admin client (service role key)
  /trustware         Cross-chain conversion: equivalents, planner, execution,
                     plus the curated swap registry and its pricing, and the
                     ETH gas top-up planner (eth-gas.ts) the Ethereum venues share
  users.ts           Supabase user model (signup, Privy sync, approval)
  waitlist.ts        Waitlist form validation
/spend               Rain virtual card. Sits at the top level, not under /lib,
                     and holds its own panel component and SQL migration.
/scripts             Live-API check scripts. Run these to verify an integration
                     against the real endpoint rather than trusting a doc.
/supabase            SQL migrations. Run by hand in the SQL editor; never
                     `supabase db push`. See supabase/README.md for why.
/docs                Integration docs (read these before writing code)
  aave.md
  aave-gold.md
  asset-catalog.md   Every xStock and Ondo token on every chain, the cross-issuer
                     overlap, and route counts derived from the issuer lists
  asset-routes.md    Every route as one table row, with status. Routes only;
                     the reasoning and sources are in asset-catalog.md
  jupiter-borrow.md
  kamino.md
  morpho-gold.md
  ondo-perps.md
  privy.md
CLAUDE.md            This file
```

## Integration Notes

These are the things that are easy to get wrong. Read the relevant file in `docs/` before writing integration code, and verify against the live docs if anything looks stale. Coverage is partial: there is a doc for Aave (the earn vaults in `aave.md`, the gold spoke in `aave-gold.md`), Jupiter borrow, Kamino, Morpho gold, Ondo perps, and Privy, and none for Trustware or Lighter. For those two, the module comments and the matching script in `scripts/` are the record.

For Jupiter specifically, a project-scoped MCP server is wired up in `.mcp.json` pointing at `https://developers.jup.ag/docs/mcp`. Prefer it over web fetches when checking Jupiter API behavior:

- `mcp__jupiter__search_jupiter` — semantic search across Jupiter docs and OpenAPI specs. Use for conceptual questions ("how does Ultra slippage work").
- `mcp__jupiter__query_docs_filesystem_jupiter` — read-only `rg` / `cat` / `head` / `tree` / `jq` over the docs as `.mdx` files. Use for exact-keyword lookups, reading a specific endpoint spec, or exploring the doc tree.

### Privy

- For Solana wallets, import hooks from the `@privy-io/react-auth/solana` subpath, not the root. The root `useWallets` returns EVM wallets; the Solana subpath's `useWallets` returns Solana wallets. (Older Privy docs reference a `useSolanaWallets` name — that was the v2 API; v3 unified to subpath-scoped `useWallets`.)
- Privy creates two embedded wallets on login, not one. `lib/privy/provider.tsx` sets both `embeddedWallets.solana.createOnLogin` and `embeddedWallets.ethereum.createOnLogin` to `all-users`. The EVM wallet exists to sign the source leg of a Trustware conversion and the two Morpho venues; it is never offered as a login method on its own.
- **External wallets are a login method, never the account the app operates on.** `appearance.walletChainType` is `ethereum-and-solana` and `appearance.walletList` names the offered wallets, so a user can sign in with Phantom, Solflare, Backpack, MetaMask, Coinbase or OKX. That wallet is identity plus a funding source. Positions, balances and every signature still belong to the embedded wallet, which is why `createOnLogin` is `all-users` and not `users-without-wallets`: a user who signs in with Phantom already has a wallet, and the narrower setting would provision nothing and leave them with no account to hold a position in.
- Because of the above, **never index the wallets array**. `useWallets()` is sorted by `connectedAt`, so `wallets[0]` stops being the embedded wallet the moment a user connects an external one, and reads and signatures silently land on the wrong account. Resolve the embedded wallet through `lib/privy/solana.ts` (`useEmbeddedSolanaWallet`) or `lib/privy/evm.ts` (`useEmbeddedEvmWallet`); both pin to `walletClientType === "privy"`. The Solana subpath's `ConnectedStandardSolanaWallet` carries no `walletClientType`, so `lib/privy/solana.ts` reads the embedded address off `user.linkedAccounts` and matches the signer by address.
- A wallet-only login links no email, and email is the merge key for the users table (`users_email_unique` in `0001_waitlist.sql`). `app/app/page.tsx` therefore holds `/api/auth/sync` until an email exists and prompts for one. Do not relax that: syncing first inserts a DID row with a null email, which can never adopt the waitlist row the same person created through the form, and stamping the address on later collides with that row and 500s every subsequent sign-in.
- `supportedChains` is `[mainnet, bsc, monad, base]` with `defaultChain: mainnet`. Privy signs only on chains declared here, so `execute.ts` fails loudly on an undeclared chain instead of signing on the wrong network. Adding a Trustware source chain means adding it both here and to the registry the chain is for: `lib/trustware/equivalents.ts` for tokenized stocks, `lib/trustware/stables.ts` and `native.ts` for a USDC-and-gas chain like Base.
- For Solana signing, use `signTransaction` or `signAndSendTransaction` from the Solana wallet object. For the EVM leg, go through the EIP-1193 provider returned by `useEmbeddedEvmWallet()`. viem is a dependency, but only for calldata encoding (`encodeFunctionData`, `erc20Abi`) and chain constants. There is no wagmi and no viem wallet client.
- To sign on a non-default EVM chain, switch at the WALLET level (`wallet.switchChain(chainId)`, exposed as `useEmbeddedEvmWallet().switchChain`) and then request a FRESH provider. A provider instance is bound to the chain that was active when it was requested, and `wallet_switchEthereumChain` on a provider does not move the wallet's own active chain, which is what the signing confirmation follows. Getting this wrong once presented a Monad approval as an Ethereum transaction. After switching, read back `eth_chainId` on the fresh provider before signing anything.
- The switch lands via React state: Privy rebuilds the wallet object with the new chain on the NEXT render, so any callback that closed over the old wallet object keeps resolving old-chain providers forever. `useEmbeddedEvmWallet` resolves the wallet through a ref for this reason; never capture a Privy wallet object across a chain switch.
- The Privy app ID goes in `NEXT_PUBLIC_PRIVY_APP_ID`. The app secret is server-side only and never exposed to the client.

### Jupiter (Ultra API)

- Use the Ultra API (`https://lite-api.jup.ag/ultra/v1`) for v1. It handles routing, slippage, and RFQ liquidity automatically.
- The flow is two calls: `GET /order` returns a signable transaction, then `POST /execute` submits the signed transaction.
- Sign the returned transaction with the Privy embedded wallet, then send the signed transaction back to Jupiter's execute endpoint. Do not broadcast it yourself.
- xStock mint addresses must be verified against the official Backed Finance list. Hardcode the curated set in `lib/jupiter/xstocks.ts`. Do not let users paste arbitrary mints in v1.
- Verify that a Jupiter route exists for each xStock before adding it to the curated list. Liquidity varies a lot across the xStock set.
- The Lend proxies (`app/api/jupiter/earn/tokens`, `app/api/jupiter/borrow/vaults`) go through `lib/jupiter/lend-server.ts`: they send `JUPITER_API_KEY`, make one 6-second attempt with no retry on a timeout, open a 20-second circuit after a failure so polling panels fail fast instead of hanging, honour a 429's retry-after, and serve a cached payload for up to 30 minutes past its TTL with an `x-aeras-stale: 1` header. Written during a Lend outage on 2026-09-09 when Jupiter's edge returned a CloudFront 504 on those endpoints for over an hour while every other Jupiter endpoint answered. With nothing cached the routes return 503, not 502.

- That circuit now lives in `lib/upstream.ts`, generalised so the other upstreams reuse it rather than each rediscovering it. Its three rules are one attempt with a deadline, never retry a 429, and open a circuit after a failure. It is deliberately **not** `server-only`, because `lib/jupiter/charts.ts` needs the circuit while still being imported by seven client components for its proxy helpers; the guard belongs on the modules that read keys, and `lib/jupiter/price-server.ts` carries its own. Splitting `charts.ts` into server and client halves would let that change, and is worth doing.
- **`app/api/jupiter/prices` is the same treatment applied to prices**, as of 2026-09-14. It was the most exposed route in the app and had none of it: keyless `lite-api`, `no-store`, no timeout, no circuit, no stale-serve, with only a 5-second CDN cache in front. One poll feeds every USD figure on screen at once, so a Jupiter stumble blanked the Markets rows, the Assets tiles, the portfolio total and the ticket together. It now calls keyed `api.jup.ag/price/v3` through the circuit, caches for 5 seconds, and serves stale for 3 minutes past that with `x-aeras-stale: 1`. Three minutes rather than the Lend routes' thirty, because a rate that is half an hour old is still roughly the rate and a price that is half an hour old is a number someone might trade against. `useJupiterPrices` no longer clears its map on a failed poll, and returns `stale` so a surface can say so. The swap routes still call `lite-api.jup.ag` keyless and still need this.
- **Charts are Coingecko, not Jupiter**, and the keyless tier is the tightest budget in the app. Measured 2026-09-14 with no key: six `market_chart` calls in sequence for one asset were enough to 429, which is a user clicking through the timeframe picker once. That is why switching timeframes felt broken. `lib/jupiter/charts.ts` now shares one circuit across every Coingecko call, because the limit is charged per account and treating the endpoints as independent just spends the recovery window three ways; sets each range's TTL from the data's own granularity (60s for 1D, 5 minutes for the hourly ranges, 30 minutes for the daily ones) rather than 60s for everything; and collapses 1Y, 5Y and MAX onto one fetch when keyless, since they already return identical data and previously cost five upstream calls between them. `fetchChartViaProxy` no longer retries a rate limit, which had been turning one 429 into three. `COINGECKO_API_KEY` is set as of 2026-09-15, a **Demo** key, which is what actually made the picker usable: keyless could not serve nine cold timeframes and walled at the fifth, and with the key all nine return in under a fifth of a second each.

  The trap here, and it is easy to get backwards because the rate limit does follow the key: **a Demo key does not raise the 365-day history cap.** That cap follows the plan. Verified 2026-09-15 with the key configured that `days=1825` and `days=max` still answer 401/10012 exactly as they do keyless, so 1Y, 5Y and MAX are still the same 364-day series. Only `COINGECKO_API_KEY_TYPE=pro` with a Pro key changes that. `effectiveRange` therefore tests the plan rather than the presence of a key; keying it off the key would have silently stopped collapsing the long ranges the moment this key was added, spending four requests an hour per asset on data already cached.

### Kamino

- Use `@kamino-finance/klend-sdk`. Initialize a `KaminoMarket` for the main market address.
- Lending reserves for xStocks may or may not exist for every ticker. Before adding an xStock to the v1 curated list, verify a live Kamino reserve exists on mainnet. If a reserve does not exist for a given xStock, exclude it from the list.
- For deposits, use the SDK's `getDepositTxns` helper rather than constructing instructions manually.
- APY values from the SDK are decimal (0.05 = 5%). Format for display, do not pass raw to the UI.
- Always refresh reserve state before showing balances. Kamino state can be a few slots stale.

### xStocks

- xStocks are Backed Finance tokenized equities (AAPLx, TSLAx, SPYx, etc.) issued on Solana.
- They are subject to KYC and geographic restrictions at the issuer level, but the tokens themselves trade permissionlessly on Solana DEXs. v1 does not handle KYC, since we are not the issuer.
- Add a disclosure in the UI that xStocks are tokenized representations and that holders do not have direct shareholder rights. This is non-negotiable for legal reasons.

## Coding Conventions

- TypeScript strict mode. No `any` without a comment explaining why.
- Server components by default. Mark client components explicitly with `"use client"`.
- API keys and RPC URLs that should not be public go in server-only env vars (no `NEXT_PUBLIC_` prefix) and are accessed only from route handlers or server components.
- Error handling on every chain interaction. Surface readable errors to the user. Never show a raw RPC error in the UI.
- Broadcast every Solana transaction through `sendAndConfirm` in `lib/solana/send-confirm.ts`. Never call `connection.confirmTransaction(signature, ...)` with a bare signature string: that selects web3.js's legacy strategy, which is a flat 30-second timer and confirms over a WebSocket subscription with no polling behind it, so it reported failures on transactions that were still in flight and on transactions that had already landed. Never cap `maxRetries` on a send either; capping it at 3 stopped the RPC rebroadcasting after about five seconds. Both were live production bugs.
- Any transaction we build ourselves sets a compute unit PRICE, not just a limit, via `resolvePriorityFee`. A limit alone raises the ceiling without buying a place in the queue. Note that Solana charges the priority fee on the requested limit rather than on units consumed, so an inflated limit is money spent for nothing.
- Prefer small, focused files over large ones. One hook, one helper, one component per file when reasonable.

## Writing Style (for any user-facing copy)

- No em dashes.
- No marketing hyperbole. No "revolutionary," "seamless," "powerful," "unlock."
- Declarative sentences. Active voice.
- Data and mechanics before adjectives. If a sentence does not convey a fact, cut it.
- Neutral-positive tone. Confident but not promotional.

## Workflow

Before writing code for any task:

1. Read this file.
2. Read the relevant file in `docs/` for the integration involved.
3. Summarize back what you understand about the task and the approach you plan to take. Wait for confirmation before generating code.
4. Implement the smallest testable slice. End with manual test instructions.

Do not chain integrations together in a single pass. Build Privy login, verify it works, then add Jupiter, verify it works, then add Kamino. Each step has its own session if needed.

## Built Since v1

These exist in the repo and are past the "do not build" line. They are listed here so a session does not mistake them for scope creep.

- Cross-chain deposits via Trustware. See Chain Assumptions.
- Non-xStock RWAs. Ondo tokens are accepted as a conversion source on Ethereum, BNB Chain, and Solana.
- Leveraged looping and unwinding against the Jupiter Lend borrow vaults (`lib/jupiter/multiply.ts`, surfaced by `components/LoopingPanel.tsx`).
- Kamino borrow against xStock collateral, through Kamino's isolated xStocks Market.
- Perps hedging, so a user long an xStock can open an offsetting short without selling. Two venues, both live, kept deliberately. `lib/lighter` has the shipped hedge tab: USDC margin funded natively from Solana, zero maker and taker fees, permissionless. `lib/ondo` is the second venue as of 2026-08-25: SIWE session in an httpOnly cookie, authenticated reads, market orders carrying builder code `aeras`, margin funding, and a venue toggle on the hedge tab. `components/HedgePanel.tsx` keeps the Lighter body untouched and renders `components/OndoHedgeSection.tsx` beside it rather than behind a shared abstraction, because the venues differ in ways worth showing. Ondo's edge is that it pays builder commission and accepts the tokenized stock itself as margin, so the stock can pay for its own hedge; its cost is that deposits are Ethereum-only. Read `docs/ondo-perps.md` before touching it, especially the builder-code section: every way that field earns nothing is silent. Ondo's `disabled` flags and collateral list are **state, not configuration**, and both changed materially in August 2026, so `lib/ondo/hedge.ts` resolves each route against the live catalog and `lib/ondo/collateral.ts` discovers the credited collateral set from `tokenConfig` rather than hardcoding either. Margin funding (`lib/ondo/fund.ts`) converts a Solana holding into the Ondo collateral token on Ethereum and delivers it straight to the deposit address Ondo provisioned, so the user signs once on Solana and never needs ETH. Two traps that guard it: a provisioned deposit address is **not** proof an asset is credited (Ondo issues one for TSLAon, which earns nothing), and some routes are badly lossy (SNDKon delivers about half its mark), so the plan refuses past a value-loss bound.
- A Perps tab (`components/PerpsPanel.tsx`), trading a venue's markets directly
  rather than offsetting a holding. Two venues behind a toggle, the same shape
  the hedge tab uses and for the same reason. **Lighter is the default**
  (`components/LighterPerpsSection.tsx`, `lib/lighter/use-lighter-perps.ts`,
  `lib/lighter/trade.ts`, as of 2026-08-28): permissionless, zero maker and
  taker fees, USDC margin funded natively from Solana, its own candles. Ondo is
  the second (`lib/ondo/use-perps.ts`): builder commission and the tokenized
  stock accepted as margin, at the cost of a SIWE sign-in and an Ethereum leg.
  Each is a market picker, price chart, dollar-sized long/short ticket and open
  positions. **Both charts are the venue's own data on TradingView's
  Lightweight Charts** as of 2026-09-19: one shared canvas
  (`components/CandleChartCanvas.tsx`, chrome in `components/VenueChartFrame.tsx`,
  bar shape in `lib/charts/bars.ts`), and each venue owns its feed. Lighter
  (`components/LighterPerpsChart.tsx`) is the same candle hook the hedge tab
  uses, with a trades/mark toggle: `/candles` is what printed, with volume,
  and `/markPriceCandles` is what a position is valued and liquidated at,
  with the catalog mark ticked into its live bar. Ondo
  (`components/OndoPerpsChart.tsx`) is the integration guide's two optional
  steps: history from `/api/ondo/history` by range
  (`lib/ondo/use-ondo-candles.ts`) and the mark price over Ondo's WebSocket
  (`lib/ondo/mark-socket.ts`, one shared socket per market, frames read by
  `lib/ondo/mark-stream.ts`) ticking the last bar between polls. The socket
  connects from the browser, so Ondo's CORS allowlist applies to it, and
  without it the chart is the thirty-second poll alone; its frame reader was
  written from the guide's description, not a captured frame, so pin the
  shape once one is captured. The spec says zero values are omitted from a
  Lighter candle, so an untraded bar has no `v` on the wire and
  `parseCandles` reads it as zero. Row sparklines are one
  `/marketPriceCharts` call for the whole catalog. The hedge tab still draws
  the recharts candlestick (`components/LighterChart.tsx`); the recharts plot
  is just not the perps tab's chart
  any more. The Ondo body shares its order route with the hedge path so the
  builder code cannot be dropped from one and kept on the other; the Lighter
  body shares `computeOrderSize` in `lib/lighter/sizing.ts` with `placeHedge`,
  so both enforce the exchange's two minimums and its per-order quote cap in one
  place. Only the venue hook for the selected venue runs, so the tab does not
  poll a catalog nobody is looking at. **The Lighter ticket has a leverage
  control** as of 2026-09-11: a slider from 1x to the market's maximum,
  default 5x, and every order goes out behind an `UpdateLeverage`
  (isolated, at that leverage) through `setMarketLeverage` in
  `lib/lighter/trade.ts`, the one helper the hedge path also uses. Margin
  required and the liquidation estimate are derived from the chosen leverage
  (`lib/lighter/ticket-math.ts`). With a position already open on the market
  the control locks and the order lands under the position's current setting,
  because a margin-mode change with a position open is expected to be refused
  and no endpoint reports the current setting; the Terminal's embedded ticket
  is the same component. This closes the gap noted under Hedge leverage.
- Hedge leverage on Lighter (`lib/lighter/order.ts`), as of 2026-08-31.
  `placeHedge` sends an `UpdateLeverage` (tag 20) setting **isolated 2x** before
  every hedge order. It previously sent none, so the panel drew margin and a
  liquidation price for a 2x isolated position while the exchange opened a cross
  one at the market default: on a $14.62 hedge the panel said $7.31 of margin and
  Lighter reserved $0.97. `HEDGE_LEVERAGE` therefore lives in `order.ts` next to
  the code that signs it, not in the panel that draws it, and everything reads
  that one constant. Verified by `scripts/lighter-leverage-check.mts`, which
  pins its reading of `TxTypeL2UpdateLeverage` to lighter-go commit `cef81af`,
  the commit `public/lighter/main.wasm` was built from, and parses the signed
  `txInfo` back out to prove the argument order.

  Three things to know before touching it. **Cross and isolated are not a
  detail**: under cross, the initial margin fraction changes what is reserved and
  moves the liquidation price not at all, because liquidation runs off the
  maintenance fraction against total account equity, so the panel's margin and
  liquidation figures are only simultaneously true under isolated. **The nonce is
  read once for both transactions** and incremented locally, because
  `fetchLighterAccountState` caches for four seconds and a second read returns the
  nonce the leverage transaction just spent. And **the setting is per account per
  market, not per position**. The gap this once left on the Perps tab, where a
  hedged market stayed isolated 2x while the ticket priced margin at the market
  default, is closed: that ticket now sends its own `UpdateLeverage` before every
  order (see the Perps tab entry above). The send itself is one function,
  `setMarketLeverage` in `lib/lighter/trade.ts`, so the two paths cannot drift.
- Ondo withdrawals (`lib/ondo/withdraw.ts`, `app/api/ondo/withdraw`, `app/api/ondo/address-book`, `components/OndoWithdrawCard.tsx`), closing the one-way door that margin funding had opened. Two steps: register a payout address with a SIWE signature, then `POST /v1/withdraw`, which Ondo executes and pays the Ethereum gas for. **Assets land on Ethereum**, and the leg home is `lib/ondo/unwind.ts` ("Move to Solana"), which the card points at rather than leaving the user on Ethereum wondering. The card is deliberately small: it withdrew nothing that the haircut, the two balance reconstructions and the conditional fee needed explaining above the amount field, and saying all of it made the form unusable. Only what a user can act on stays. Zero rows are filtered too, because a ledger quantity is deposits minus withdrawals and a full exit leaves a float residue, which once made the card open on an asset the user no longer held. Three things to know before touching it, all in `docs/ondo-perps.md`. `withdrawableMargin` is not a token cap and reading it as one tells a user with no positions and no debt they can withdraw nothing, which is backwards. Ondo exposes no per-asset balance anywhere, so held quantity is reconstructed from the deposit and withdrawal ledgers and cross-checked against credited margin, taking the smaller, because auto-exchange sells collateral with no ledger record. And the withdrawal destination is never caller-supplied: the challenge route takes no body and registers only the session's own wallet, which is the mirror of the deposit-address guard in `fund.ts` and means Aeras deliberately cannot withdraw to an external address.
- A Rain virtual card (`/spend`).
- Morpho-on-Monad earn (`lib/morpho`, `app/api/morpho`). Curated USDC Morpho Vaults V2 on Monad mainnet as Earn options (V2, not V1 MetaMorpho — the indexer serves them under `vaultV2s`, and near-empty V1 twins of the same vaults exist; see `lib/morpho/vaults.ts`). All three layers are in: the read layer (live APY, on-chain positions), ERC-4626 deposit/withdraw through the embedded EVM wallet (`lib/morpho/deposit.ts`), and Trustware funding of a deposit from the wallet's Solana USDC, including a one-time native-MON gas top-up because the embedded wallet is born with no gas (`lib/morpho/fund.ts`, verified live by `scripts/morpho-fund-check.mts`). Funding runs both ways: a return leg (`sendMonadUsdcToSolana`, executed by `executeEvmRoute` in `lib/trustware/execute.ts`) brings Monad USDC back to the Solana wallet. This is the exception to Solana-only positions described under Chain Assumptions.
- Morpho-on-Ethereum gold borrow (`lib/morpho/gold-*.ts`, `app/api/morpho/gold-*`,
  `components/GoldBorrowCard.tsx`), as of 2026-08-27. Post XAUt as collateral in the
  Morpho Blue XAUt/USDT market, borrow USDT at 77% LLTV. See Chain Assumptions and
  `docs/morpho-gold.md`. The position math is a direct port of Morpho's own libraries
  (SharesMathLib, the Taylor-series accrual, `_isHealthy`) including rounding direction,
  verified against Morpho's indexer on a live position to the seventh decimal of health.
  Funding is bounded on value loss priced at the market's own oracle, never at a token
  registry: Trustware lists Ethereum GLDx at 17x its real sale price. One upstream
  defect is live and worked around rather than hidden: Trustware cannot route Solana
  gold directly to XAUt even though it runs both halves of that path individually, so
  funding sells to USDC first. The planner tries direct every time and will use it the
  day it works.
- Gold bullion in the buyable catalog: PAXG and XAUt0 on Solana, alongside the existing
  GLDx. These are not xStocks, and adding them broke two assumptions the catalog had
  carried since v1: entries are no longer all 8 decimals (both are 6), and they are no
  longer all Token-2022 (PAXG is, XAUt0 is classic SPL). `XStock.tokenProgram` now
  carries that per entry, because deriving the wrong program yields an associated token
  account that does not exist, so a balance reads as zero rather than as an error.
- Base as a USDC funding source (`lib/trustware/base.ts`, `components/BaseReturnForm.tsx`),
  as of 2026-08-28. See Chain Assumptions: it is a source of funds with a return
  leg, not a venue, and it is listed only because the return leg works.
- Aave V4 gold borrow (`lib/aave/gold-*.ts`, `app/api/aave/gold-*`,
  `components/AaveGoldBorrowCard.tsx`), as of 2026-09-09. XAUt collateral in
  the Gold spoke on Ethereum, USDC debt, one row of the loan-options table;
  it replaced the Morpho gold card there the same day. See Chain Assumptions
  and `docs/aave-gold.md`. The chain returns health
  itself; `lib/aave/gold-math.ts` solves headroom, withdrawable collateral and
  the liquidation price from the same inputs and is pinned by tests to two
  live positions where the contract and Aave's indexer agree. Direct path
  only: the user pays gas, and the ETH top-up in `lib/morpho/gold-fund.ts` is
  sized to this venue's heavier cycle. Aave's signature gateway (relayed
  EIP-712 intents, no ETH needed) is verified active and is the phase-2 route.
  USDT is the second debt asset when USDC's spoke cap binds; not built.
  Verified by `scripts/aave-gold-check.mts`.
- Waitlist signup, Privy-backed user sync, admin approval, and referral codes.
- A Strategies page (`components/strategies/`, `lib/strategies/`), as of
  2026-09-19: Buy + Earn, Buy + Leverage and Buy + Buy more on every asset
  with a borrow market, each run as signed steps with per-step retry, saved
  after every step so a refresh resumes, and each with its close path. Read
  `docs/buy-strategies-plan.md` before touching it. Two things to know: a
  resume reconciles an interrupted step against the chain before re-sending
  it, because a buy that re-ran would buy twice; and the ladder's unwind
  repays and withdraws by the amounts the run recorded, not by what the
  venue reports, because Kamino's obligation reader shows one collateral.
  As of 2026-09-20 the three strategies are also buttons under the chart on
  the Markets row expansion and the Home asset detail
  (`components/strategies/AssetStrategies.tsx`), each carrying one live figure,
  and pressing one opens its ticket in place of the market ticket. The
  Strategies page draws the same strip; the paragraph and mechanics table it
  used to show beside the ticket are gone.
- Aave-on-Ethereum earn (`lib/aave`, `app/api/aave`, `components/AaveVaultsCard.tsx`),
  as of 2026-09-16. USDC and USDT into the Aave V3 Core stata tokens (instant) and
  the Umbrella stake tokens (higher rate, slashable, 20-day cooldown). See Chain
  Assumptions and `docs/aave.md`. Rates are read from the Pool and the Umbrella
  RewardsController on-chain, never from Aave's API. Umbrella deposits and exits go
  through BGD's `UmbrellaBatchHelper` so wrapping and staking is one transaction.
  Building it moved three things into shared homes without changing them: the
  Ethereum chain constants and batched RPC reads (`lib/ethereum`), the client
  transaction plumbing that `gold-borrow.ts` had (`lib/ethereum/tx.ts`), and the ETH
  gas planner that `gold-fund.ts` had (`lib/trustware/eth-gas.ts`, now taking the
  venue's gas budget as an argument). Aave's third "vault" product, Stable Vaults,
  is a B2B fixed-rate offering where Aeras would be the operator; it needs an
  agreement with Aave Labs, not code, and is not here. **Not yet verified live:**
  run `scripts/aave-check.mts` first.
- A Terminal tab (`components/TerminalPanel.tsx`), as of 2026-09-10: the market
  on one screen in the shape Backpack's home uses. A ticker tape
  (`components/TickerTape.tsx`) and an overview strip across the top, the
  selected asset's chart with its ticket beside it, a movers row (gainers and
  losers over 24h), a perps row, the catalog as cards, and a news rail with a
  tab for the selected company and one for the market. Prices, sparklines, the
  chart and the ticket are the hooks and components Home and Markets already
  draw; the perp marks come from the Lighter catalog. Lighter does not say
  which of its markets are equities, so the perps row is derived from the
  catalog by underlying ticker (`equityPerpQuotes` in `lib/terminal/quotes.ts`,
  pinned by a test to every exact route in `lib/lighter/hedge.ts`). Every
  tradeable Lighter market is selectable, as of 2026-09-12: the selection
  (`lib/terminal/selection.ts`) is a catalog asset or a bare market, the
  picker's Perps group lists all markets by volume, the perps row the busiest
  forty, and a market with no catalog asset opens a perp-only view
  (`components/TerminalPerpDetail.tsx`) with the Lighter ticket alone, while a
  perp on a catalog name lands on that asset in perps mode. `PerpsPanel` still
  accepts `initialMarket`; nothing passes it now. Every market has a mark:
  `scripts/market-logos-fetch.mts` fetches one for any Lighter market the
  registry in `lib/tokens/market-logos.ts` lacks (crypto from CoinGecko by
  symbol, largest market cap among namesakes; equities from a stock-logo
  source) and prints the registry lines; what has no mark anywhere, FX pairs,
  commodities and private companies, is a lettered badge there, and the
  Terminal draws perp marks through `MarketLogo` so those badges show.
  Headlines are public RSS with no key, read server-side through
  `app/api/news`: Yahoo Finance's per-ticker feed (needs a User-Agent or it
  answers 404, and has nothing for the bullion tokens) merged with a Google
  News search per asset, and five market-wide feeds. `lib/news/feeds.ts` maps
  every catalog asset to its ticker and query and a test fails when an asset is
  added without one; `scripts/news-feeds-check.mts` is the live check. The RSS
  reader is hand-written and pinned by tests to excerpts of each feed rather
  than a dependency, because the fields the rail shows are four. The rail also
  carries an earnings card and a macro events card (`lib/calendar`,
  `app/api/calendar`), both keyless. Earnings come from Nasdaq's public site
  API, two calls per catalog company (`analyst/<t>/earnings-date`, whose date
  and consensus are sentences the parser reads, and
  `company/<t>/earnings-surprise`), which wants browser-like headers and
  answers 400 for the funds and bullion, so only `category: "stocks"` rows are
  asked. Next dates are the vendor's projections until a company announces,
  and the row marks them with a tilde. The calendar is ForexFactory's public
  weekly JSON (forecast and previous, no actuals, this week only), filtered to
  US medium and high impact and foreign high. FOMC dates are a registry
  (`FOMC_MEETINGS_2026`) checked against the Fed's page by
  `scripts/calendar-check.mts`, and the news rail has a Fed tab on the Board's
  monetary-policy and speeches RSS. Both cards link to a full month calendar
  (`components/TerminalCalendar.tsx`, an overlay; the date maths in
  `lib/calendar/month.ts` is tested): every company's last report with its
  beat or miss and next date with its estimate, the current week's releases,
  and every FOMC meeting of the year on both its days. Earnings days are
  keyed by UTC date and releases by the viewer's local day, on purpose. Both the detail header and the ticket header are an asset picker
  (`components/TerminalAssetPicker.tsx`, the perps tab's market selector in
  shape): search, tabs for the catalog's groups plus Perps, and rows priced
  live; a perp row selects its underlying with the ticket in perps mode, and
  the two triggers pick into one state. The ticket (`components/TerminalTicket.tsx`)
  has three modes and offers only the ones the asset has. Spot is `SwapForm`
  in its `variant="hero"` layout (full-width buy/sell, the figure centred with
  its unit above, 25/50/75/Max chips), the same state and money path as the
  inline ticket. Perps is `LighterPerpsSection` with `embedded`, on the Lighter
  market whose symbol is the asset's underlying ticker, and the chart column
  switches to `PerpChart` (exported from `HomeCharts`) at Lighter's mark,
  because the perp and the xStock are two markets with two prices. Borrow
  mounts the Borrow tab's own card for the venue that takes the asset
  (`VaultCard`, exported from `BorrowPanel`, and `KaminoBorrowCard`), with a
  venue toggle where both list it, fed the same hooks the tab feeds them, so
  the loan is opened, added to, repaid and closed in the rail through the one
  copy of that path: live vault state, the existing-position read, the
  first-position sheet and, on Kamino, two signed transactions. The chart card is an asset
  detail (`components/TerminalAssetDetail.tsx`): the exchange's session figures
  beside the on-chain 24h move, and tabs for the chart, financials, news,
  profile, dividends, insider trades and filings. The company data is
  Nasdaq's site API again (`lib/company`, `app/api/company`, one cached
  section per request, the ticker resolved through the catalog so nothing
  arbitrary is proxied); equities get every section, the three funds a quote
  and summary as `etf`, bullion nothing. Financials are Nasdaq's four quarters
  in thousands, scaled to dollars; the highlight tiles are trailing sums for
  flows and the latest quarter for stocks and margins, P/E off the last four
  reported EPS and forward P/E off the next four consensus figures
  (`lib/company/highlights.ts`, pinned by tests). The candles toggle is
  TradingView's advanced-chart embed (`components/TradingViewChart.tsx`) on
  the underlying's own exchange symbol (`tradingViewSymbol`, spot gold for the
  metal tokens), which is TradingView's data and not the xStock; the line
  chart stays ours. next.config.ts lists the embed's script and frame origins.
  In perps mode the candles are Lighter's own through `LighterChart`. Beside
  the ticket sit a "Trade X-PERP" pointer (Lighter's max leverage, switches the
  ticket to perps) and related assets by a sector registry in
  `lib/company/listing.ts`. `scripts/company-check.mts` is the live check for
  every Nasdaq section and every TradingView symbol.

## Out of Scope

These will come later. Do not build them now, even if it seems easy.

- Fiat on-ramp, **except** the one-time position setup cost. Opening a first
  position at a lending venue allocates accounts the user pays Solana rent for
  (0.030500 SOL on Kamino, 0.004446 on Jupiter Lend), and a wallet that cannot
  cover it used to get a raw simulation error. `components/FirstPositionSheet`
  prices it, and covers a shortfall from the wallet's own USDC through Jupiter
  Ultra where it can. Where it cannot, it opens Privy's hosted funding flow
  (`useFundWallet` from the Solana subpath) for native SOL, sized to the
  shortfall. **Do not pin `defaultFundingMethod`.** Privy offers four routes in,
  a card through MoonPay or Coinbase, a transfer from another wallet, an exchange
  withdrawal, and sending SOL by hand, and pinning it to `card` hides the three
  free ones behind rails that charge a fee and enforce a $20 to $30 minimum
  against a $3.17 setup. `card.preferredProvider` still names MoonPay, which
  only decides which card provider is used if the user picks a card.
  `onUserExited` reports the method chosen and it is recorded on the setup row.
  This is not a general on-ramp: it is reachable only from that sheet, it funds
  only native SOL, and it is sized to the shortfall. No MoonPay SDK, no card
  data, no KYC and no webhooks touch this app. Anything wider, funding the buy
  flow or the wallet panel from fiat, is still out of scope.
- Additional lending venues beyond Kamino, Jupiter Lend, Morpho-on-Monad, the
  Morpho-on-Ethereum gold market, the Aave V4 Gold spoke and the Aave vaults on
  Ethereum (MarginFi, Save, etc.)
- Portfolio analytics beyond a single position view
- Mobile-specific UI
- EVM chains as a destination for a position, **except** the venues described under Chain Assumptions: Morpho earn on Monad, the two gold borrow markets on Ethereum (Morpho Blue and the Aave V4 Gold spoke), and the Aave vaults on Ethereum. Outside those, a position never settles off Solana. Swapping out to an EVM chain is also allowed and is described under Chain Assumptions.
- Notifications and email