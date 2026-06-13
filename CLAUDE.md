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

Anything beyond this (multi-asset positions, leveraged loops, fiat on-ramp, mobile, EVM chains) is out of scope for v1.

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

Solana mainnet only for v1. All xStocks live on Solana via Backed Finance. Kamino is Solana-native. There is no EVM code in this repo.

Use a paid RPC (Helius or Triton) via env var `NEXT_PUBLIC_SOLANA_RPC_URL`. Do not use the public mainnet-beta endpoint for anything beyond local prototyping.

## Repo Layout

```
/app                 Next.js App Router routes
  /api               Server routes (Jupiter quote proxy, Kamino reads)
  /(auth)            Privy-gated routes
/components          UI components
  /ui                shadcn primitives
/lib
  /privy             Privy config and hooks
  /jupiter           Ultra API client and swap helpers
  /kamino            klend SDK wrappers, reserve metadata
  /solana            Connection, signing helpers
/docs                Integration docs (read these before writing code)
  /privy
  /jupiter
  /kamino
  /xstocks
CLAUDE.md            This file
```

## Integration Notes

These are the things that are easy to get wrong. Read the relevant `docs/` subfolder before writing integration code, and verify against the live docs if anything looks stale.

For Jupiter specifically, a project-scoped MCP server is wired up in `.mcp.json` pointing at `https://developers.jup.ag/docs/mcp`. Prefer it over web fetches when checking Jupiter API behavior:

- `mcp__jupiter__search_jupiter` — semantic search across Jupiter docs and OpenAPI specs. Use for conceptual questions ("how does Ultra slippage work").
- `mcp__jupiter__query_docs_filesystem_jupiter` — read-only `rg` / `cat` / `head` / `tree` / `jq` over the docs as `.mdx` files. Use for exact-keyword lookups, reading a specific endpoint spec, or exploring the doc tree.

### Privy

- For Solana wallets, import hooks from the `@privy-io/react-auth/solana` subpath, not the root. The root `useWallets` returns EVM wallets; the Solana subpath's `useWallets` returns Solana wallets. (Older Privy docs reference a `useSolanaWallets` name — that was the v2 API; v3 unified to subpath-scoped `useWallets`.)
- Configure Privy in the dashboard to create embedded Solana wallets on login, not Ethereum.
- For signing, use `signTransaction` or `signAndSendTransaction` from the Solana wallet object. Do not try to use viem or wagmi patterns.
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
2. Read the relevant `docs/` subfolder for the integration involved.
3. Summarize back what you understand about the task and the approach you plan to take. Wait for confirmation before generating code.
4. Implement the smallest testable slice. End with manual test instructions.

Do not chain integrations together in a single pass. Build Privy login, verify it works, then add Jupiter, verify it works, then add Kamino. Each step has its own session if needed.

## Out of Scope for v1

These will come later. Do not build them now, even if it seems easy.

- Fiat on-ramp
- Additional lending venues beyond Kamino and Jupiter Lend (Morpho, MarginFi, etc.)
- Leveraged or looped positions
- Portfolio analytics beyond a single position view
- Mobile-specific UI
- EVM chains
- Non-xStock RWAs (Ondo, etc.)
- Notifications, email, referrals