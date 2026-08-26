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

Morpho-on-Monad earn is the second, larger exception, and here a *position* really does live on an EVM chain. Users deposit USDC into a Morpho Vaults V2 (ERC-4626) vault on Monad mainnet (chainId 143) and earn its yield; the shares sit in the user's embedded EVM wallet, not on Solana. `lib/morpho` holds the curated vault registry and Monad constants, `app/api/morpho` serves live APY (Morpho's indexer) and per-wallet positions (Monad RPC reads). Funding runs through Trustware with a Monad-USDC destination, the same universal-deposit machinery the Solana path uses, pointed at an EVM chain instead. This is the one place the "positions settle on Solana" rule is knowingly broken; treat it as venue-scoped, not a general license to settle elsewhere.

EVM code is confined to three files. `lib/privy/evm.ts` resolves the embedded EVM wallet and hands back its EIP-1193 provider. `lib/trustware/evm-tx.ts` translates a Trustware route payload into `eth_sendTransaction` params. `lib/trustware/execute.ts` grants ERC-20 allowances, switches the wallet's active chain, broadcasts the source leg, and tracks the route to settlement. Nothing outside those files should reach for an EVM provider. (The Morpho earn modules `lib/morpho/deposit.ts` and `lib/morpho/fund.ts` also sign EVM transactions, but only through the signer shape `lib/privy/evm.ts` exposes.)

Use a paid RPC (Helius or Triton) via env var `NEXT_PUBLIC_SOLANA_RPC_URL`. Do not use the public mainnet-beta endpoint for anything beyond local prototyping. There is no EVM RPC of our own. Trustware proxies allowance reads and cross-chain balance scans, which is what the `/sdk/rpc/evm` and `/data` endpoints in `lib/trustware/constants.ts` are for.

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
    /morpho          Monad Morpho vault metrics (indexer) and per-wallet
                     positions (Monad RPC reads)
    /lighter         Lighter perps market catalog
    /ondo            Ondo perps: market catalog, SIWE session, account
                     snapshot, terms, orders, deposit address, withdrawal
                     address book and withdrawals
    /prices/native   Native asset prices
    /spend           Rain card issuance and purchase history
    /trustware       Route, quote, balances, allowance, receipt, status proxies
    /waitlist        Public signup
/components          UI components
  /ui                shadcn primitives
/lib
  /borrow            Borrow summary and market stats hooks
  /jupiter           Ultra client, Lend earn/borrow, looping, triggers,
                     prices, curated xStock list
  /kamino            Reserve metadata, kvaults, positions, borrow helpers
  /lighter           Lighter perps: markets, sizing, risk, hedge construction
  /ondo              Ondo perps: markets, sizing, risk, hedge routing, the
                     execution core (builder code, orders, SIWE session),
                     margin funding (collateral discovery, Trustware deposit)
                     and withdrawals (address book, per-asset reconstruction)
  /morpho            Monad Morpho earn: curated USDC vault registry, Monad
                     constants, client read helpers
  /privy             Privy config, auth, Solana and EVM wallet hooks
  /solana            Connection, balances, holdings, sending, activity, plus
                     the shared broadcast path: priority-fee.ts (compute unit
                     pricing) and send-confirm.ts (sendAndConfirm)
  /supabase          Server-only admin client (service role key)
  /trustware         Cross-chain conversion: equivalents, planner, execution,
                     plus the curated swap registry and its pricing
  users.ts           Supabase user model (signup, Privy sync, approval)
  waitlist.ts        Waitlist form validation
/spend               Rain virtual card. Sits at the top level, not under /lib,
                     and holds its own panel component and SQL migration.
/scripts             Live-API check scripts. Run these to verify an integration
                     against the real endpoint rather than trusting a doc.
/supabase            SQL migrations
/docs                Integration docs (read these before writing code)
  jupiter-borrow.md
  kamino.md
  ondo-perps.md
  privy.md
CLAUDE.md            This file
```

## Integration Notes

These are the things that are easy to get wrong. Read the relevant file in `docs/` before writing integration code, and verify against the live docs if anything looks stale. Coverage is partial: there is a doc for Jupiter borrow, Kamino, Ondo perps, and Privy, and none for Trustware or Lighter. For those two, the module comments and the matching script in `scripts/` are the record.

For Jupiter specifically, a project-scoped MCP server is wired up in `.mcp.json` pointing at `https://developers.jup.ag/docs/mcp`. Prefer it over web fetches when checking Jupiter API behavior:

- `mcp__jupiter__search_jupiter` — semantic search across Jupiter docs and OpenAPI specs. Use for conceptual questions ("how does Ultra slippage work").
- `mcp__jupiter__query_docs_filesystem_jupiter` — read-only `rg` / `cat` / `head` / `tree` / `jq` over the docs as `.mdx` files. Use for exact-keyword lookups, reading a specific endpoint spec, or exploring the doc tree.

### Privy

- For Solana wallets, import hooks from the `@privy-io/react-auth/solana` subpath, not the root. The root `useWallets` returns EVM wallets; the Solana subpath's `useWallets` returns Solana wallets. (Older Privy docs reference a `useSolanaWallets` name — that was the v2 API; v3 unified to subpath-scoped `useWallets`.)
- Privy creates two embedded wallets on login, not one. `lib/privy/provider.tsx` sets both `embeddedWallets.solana.createOnLogin` and `embeddedWallets.ethereum.createOnLogin` to `users-without-wallets`. Solana is still the primary wallet: `appearance.walletChainType` is `solana-only`, so the EVM wallet is never offered as a login method. It exists to sign the source leg of a Trustware conversion.
- `supportedChains` is `[mainnet, bsc]` with `defaultChain: mainnet`. Privy signs only on chains declared here, so `execute.ts` fails loudly on an undeclared chain instead of signing on the wrong network. Adding a Trustware source chain means adding it both here and to `lib/trustware/equivalents.ts`.
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
- A Perps tab (`components/PerpsPanel.tsx`, `lib/ondo/use-perps.ts`), trading Ondo's markets directly rather than offsetting a holding. Market picker over every tradeable Ondo market, price chart, dollar-sized long/short ticket with per-market leverage, and open positions. Shares the order route with the hedge path so the builder code cannot be dropped from one and kept on the other.
- Ondo withdrawals (`lib/ondo/withdraw.ts`, `app/api/ondo/withdraw`, `app/api/ondo/address-book`, `components/OndoWithdrawCard.tsx`), closing the one-way door that margin funding had opened. Two steps: register a payout address with a SIWE signature, then `POST /v1/withdraw`, which Ondo executes and pays the Ethereum gas for. **Assets land on Ethereum; the bridge back to Solana is not built.** Three things to know before touching it, all in `docs/ondo-perps.md`. `withdrawableMargin` is not a token cap and reading it as one tells a user with no positions and no debt they can withdraw nothing, which is backwards. Ondo exposes no per-asset balance anywhere, so held quantity is reconstructed from the deposit and withdrawal ledgers and cross-checked against credited margin, taking the smaller, because auto-exchange sells collateral with no ledger record. And the withdrawal destination is never caller-supplied: the challenge route takes no body and registers only the session's own wallet, which is the mirror of the deposit-address guard in `fund.ts` and means Aeras deliberately cannot withdraw to an external address.
- A Rain virtual card (`/spend`).
- Morpho-on-Monad earn (`lib/morpho`, `app/api/morpho`). Curated USDC Morpho Vaults V2 on Monad mainnet as Earn options (V2, not V1 MetaMorpho — the indexer serves them under `vaultV2s`, and near-empty V1 twins of the same vaults exist; see `lib/morpho/vaults.ts`). All three layers are in: the read layer (live APY, on-chain positions), ERC-4626 deposit/withdraw through the embedded EVM wallet (`lib/morpho/deposit.ts`), and Trustware funding of a deposit from the wallet's Solana USDC, including a one-time native-MON gas top-up because the embedded wallet is born with no gas (`lib/morpho/fund.ts`, verified live by `scripts/morpho-fund-check.mts`). Funding runs both ways: a return leg (`sendMonadUsdcToSolana`, executed by `executeEvmRoute` in `lib/trustware/execute.ts`) brings Monad USDC back to the Solana wallet. This is the exception to Solana-only positions described under Chain Assumptions.
- Waitlist signup, Privy-backed user sync, admin approval, and referral codes.

## Out of Scope

These will come later. Do not build them now, even if it seems easy.

- Fiat on-ramp
- Additional lending venues beyond Kamino, Jupiter Lend, and Morpho-on-Monad (MarginFi, Save, etc.)
- Portfolio analytics beyond a single position view
- Mobile-specific UI
- EVM chains as a destination for a position, **except** the Morpho-on-Monad earn venue described under Chain Assumptions. Outside that one venue, a position never settles off Solana. Swapping out to an EVM chain is also allowed and is described under Chain Assumptions.
- Notifications and email