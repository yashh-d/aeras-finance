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

EVM code is confined to three files. `lib/privy/evm.ts` resolves the embedded EVM wallet and hands back its EIP-1193 provider. `lib/trustware/evm-tx.ts` translates a Trustware route payload into `eth_sendTransaction` params. `lib/trustware/execute.ts` grants ERC-20 allowances, calls `wallet_switchEthereumChain`, broadcasts the source leg, and tracks the route to settlement. Nothing outside those files should reach for an EVM provider.

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
    /lighter         Lighter perps market catalog
    /ondo            Ondo perps market catalog
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
  /ondo              Ondo perps, same module shape as lighter
  /privy             Privy config, auth, Solana and EVM wallet hooks
  /solana            Connection, balances, holdings, sending, activity
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
- Perps hedging, so a user long an xStock can open an offsetting short without selling. Two implementations exist. `lib/lighter` is the current one and `lib/lighter/constants.ts` records the 2026-08-16 measurements that chose it: share-level SPY and QQQ markets, zero maker and taker fees, permissionless access. `lib/ondo` is the superseded route, kept for its index-proxy and sandbox-versus-production notes. Neither is wired into a component yet. Both stop at an API route.
- A Rain virtual card (`/spend`).
- Waitlist signup, Privy-backed user sync, admin approval, and referral codes.

## Out of Scope

These will come later. Do not build them now, even if it seems easy.

- Fiat on-ramp
- Additional lending venues beyond Kamino and Jupiter Lend (Morpho, MarginFi, etc.)
- Portfolio analytics beyond a single position view
- Mobile-specific UI
- EVM chains as a destination **for a position**. A position never settles off Solana. Swapping out to an EVM chain is allowed and is described under Chain Assumptions.
- Notifications and email