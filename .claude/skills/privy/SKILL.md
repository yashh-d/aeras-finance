---
name: Privy
description: Use when building authentication systems, embedded wallets, transaction signing, wallet controls, and policies. Agents should reach for this skill when implementing user onboarding, creating wallets, signing transactions, managing wallet permissions, or setting up transaction approval workflows.
metadata:
    mintlify-proj: privy
    version: "1.0"
---

# Privy Skill Reference

## Product summary

Privy is a wallet infrastructure and authentication platform that enables developers to embed wallets and user authentication directly into applications. It provides three core layers: **authentication** (email, social, passkeys, wallet-based login), **wallets** (embedded wallets managed by Privy or external wallets users bring), and **controls** (owners, signers, and policies that define who can do what with wallets).

Key files and entry points:
- **React SDK**: `@privy-io/react-auth` — wrap your app with `PrivyProvider` and use hooks like `usePrivy()`, `useCreateWallet()`, `useSignTransaction()`
- **Server SDKs**: `@privy-io/node` (Node.js), `@privy-io/python`, `@privy-io/java`, `@privy-io/go`, `@privy-io/rust`, `@privy-io/ruby` — instantiate `PrivyClient` with app ID and app secret
- **REST API**: `https://api.privy.io/v1/` — authenticate with app ID and app secret via HTTP Basic Auth
- **Dashboard**: `https://dashboard.privy.io` — configure apps, login methods, policies, and view wallets

Primary docs: https://docs.privy.io

## When to use

Reach for this skill when:
- **Building authentication flows**: Implementing email, SMS, social, passkey, or wallet-based login
- **Creating wallets**: Provisioning embedded wallets for users or servers, importing wallets, exporting keys
- **Signing transactions**: Signing messages, transactions, or typed data on Ethereum, Solana, Bitcoin, or other chains
- **Managing wallet permissions**: Setting up owners, signers, and policies to control who can do what
- **Handling transaction approvals**: Implementing multi-sig, quorum-based, or policy-enforced transaction workflows
- **Monitoring wallet activity**: Setting up webhooks for user events, transaction status, or wallet actions
- **Funding wallets**: Configuring fiat onramps, bank deposits, or gas sponsorship
- **Building agent wallets**: Creating wallets controlled by servers with strict policy guardrails

## Quick reference

### SDK initialization

| Platform | Code |
|----------|------|
| **React** | `<PrivyProvider appId="..." clientId="..." config={{...}}>` |
| **React Native** | `<PrivyProvider appId="..." clientId="..." config={{...}}>` |
| **Node.js** | `new PrivyClient({appId: '...', appSecret: '...'})` |
| **Python** | `PrivyClient(app_id='...', app_secret='...')` |
| **REST API** | `curl -u "app-id:app-secret" https://api.privy.io/v1/...` |

### Common hooks (React)

| Hook | Purpose |
|------|---------|
| `usePrivy()` | Access user state, login/logout, ready status |
| `useCreateWallet()` | Create embedded wallets for users |
| `useSignTransaction()` | Sign transactions on Ethereum or Solana |
| `useWallets()` | Get connected wallets and wallet state |
| `useLogin()` | Trigger login modal or direct login methods |

### Common server methods (Node.js)

| Method | Purpose |
|--------|---------|
| `privy.wallets().create({...})` | Create wallet owned by user or authorization key |
| `privy.wallets().get(walletId)` | Fetch wallet details |
| `privy.wallets().ethereum().sendTransaction({...})` | Send transaction from wallet |
| `privy.users().create({...})` | Create user and optionally pregenerate wallets |
| `privy.users().get(userId)` | Fetch user object with linked accounts |

### Wallet ownership models

| Model | Owner | Use case |
|-------|-------|----------|
| **User-owned** | User ID | Self-custodial consumer wallets |
| **User + server** | User ID + authorization key | Automated trading, limit orders |
| **Application-owned** | Authorization key | Treasury, trading bots, agents |
| **Custodial** | Licensed custodian | FBO banking-like model |

### Chain support

**Tier 1 (full support)**: Ethereum, Solana, Base, Polygon, Arbitrum, Optimism, Avalanche, Fantom, Gnosis, Celo, Harmony, Moonbeam, Moonriver, Linea, Scroll, Mantle, Blast, Fraxtal, Zora, Mode, Taiko, Sei, Aptos, Movement, Sui, Cosmos, Stellar, TRON, Bitcoin (Segwit/Taproot), TON, Starknet, Near, Spark (Bitcoin L2)

**Tier 2 (extended)**: 50+ additional chains via extended SDKs

## Decision guidance

### When to use embedded wallets vs external wallets

| Scenario | Embedded | External |
|----------|----------|----------|
| New users, no crypto experience | ✓ | |
| Users have existing wallets | | ✓ |
| Seamless onboarding required | ✓ | |
| User controls keys directly | | ✓ |
| Cross-app wallet usage | | ✓ |
| Automatic wallet creation | ✓ | |

### When to use Privy auth vs JWT-based auth

| Scenario | Privy Auth | JWT-based |
|----------|-----------|-----------|
| Building from scratch | ✓ | |
| Existing auth system | | ✓ |
| Multiple login methods needed | ✓ | |
| Custom auth provider | | ✓ |
| Social + wallet login | ✓ | |

### When to use policies vs signers

| Scenario | Policies | Signers |
|----------|----------|---------|
| Enforce spending limits | ✓ | |
| Restrict recipient addresses | ✓ | |
| Delegate transaction signing | | ✓ |
| Multi-party approval | | ✓ |
| Time-based constraints | ✓ | |
| Smart contract allowlists | ✓ | |

## Workflow

### 1. Set up a Privy app
- Go to https://dashboard.privy.io and create a new app
- Copy your **app ID** and **app secret** (keep secret safe)
- Configure login methods (email, social, passkeys, wallets)
- Set allowed domains and OAuth redirect URIs
- Note your **client ID** for client-side SDKs

### 2. Initialize Privy in your app
- **Client-side (React)**: Wrap your app with `PrivyProvider` using app ID and client ID
- **Server-side (Node.js)**: Instantiate `PrivyClient` with app ID and app secret
- Wait for `ready` status before consuming Privy state

### 3. Authenticate users
- Use Privy's built-in login modal or implement custom login UI
- Call `login()` to trigger authentication
- Access authenticated user via `usePrivy()` hook or `privy.users().get()`
- User object contains linked accounts (email, social, wallets, etc.)

### 4. Create or access wallets
- **Automatic**: Configure `createOnLogin` in `PrivyProvider` config to auto-create wallets
- **Manual**: Call `createWallet()` hook (React) or `privy.wallets().create()` (server)
- Specify owner (user ID for user wallets, authorization key for app-owned wallets)
- Optionally attach policies and signers at creation time

### 5. Sign transactions
- **React**: Use `useSignTransaction()` hook with transaction details
- **Server**: Call `privy.wallets().ethereum().sendTransaction()` or chain-specific method
- Provide wallet ID (not address), transaction data, and optional authorization signatures
- Handle policy violations and insufficient funds errors

### 6. Monitor activity
- Set up webhooks in dashboard (Configuration > Webhooks)
- Subscribe to user events (created, authenticated, wallet_created)
- Subscribe to transaction events (broadcasted, confirmed, failed)
- Verify webhook signatures using Privy's signing key
- React to events in real-time without polling

### 7. Manage permissions
- Create policies via API or dashboard to enforce spending limits, recipient allowlists, contract restrictions
- Add signers to wallets to delegate transaction signing with scoped permissions
- Use key quorums for multi-party approval workflows
- Test policies in development before deploying to production

## Common gotchas

- **Forgetting to wait for `ready`**: Always check `usePrivy().ready` before accessing user state or wallets. Privy initializes asynchronously.
- **Using wallet address instead of wallet ID**: APIs require wallet ID (from creation response), not the wallet's blockchain address.
- **Policy violations silently blocking transactions**: Transactions rejected by policies return `policy_violation` error. Review policy rules in dashboard or via API before retrying.
- **Missing authorization signatures**: Server-side wallet operations may require authorization signatures from the wallet owner. Use `AuthorizationContext` in SDKs to auto-sign.
- **Expired user session keys**: User signing keys are time-bound. Request fresh keys via `/wallets/authenticate` endpoint; SDKs handle this automatically.
- **Rate limits on wallet creation**: Batch wallet creation is subject to rate limits (HTTP 429). Implement exponential backoff for retries.
- **Whitelabel login incompatible with auto-wallet creation**: Automatic wallet creation only works with Privy's modal login, not custom whitelabel UIs. Create wallets manually in whitelabel flows.
- **External wallet chain mismatch**: External wallets must be configured for the chains you're using. Configure chains in dashboard under External Wallets.
- **Forgetting to configure app clients**: If deploying across multiple domains/environments, create app clients in dashboard to customize Privy behavior per environment.
- **Not verifying webhook signatures**: Always verify webhook payload signatures using Privy's public signing key before processing events.

## Verification checklist

Before submitting work with Privy:

- [ ] App ID and app secret are correctly configured (secret not exposed in client code)
- [ ] `PrivyProvider` wraps the entire app and `ready` status is checked before using Privy
- [ ] Wallet creation specifies correct owner (user ID for user wallets, authorization key for app wallets)
- [ ] Policies are tested in development and match intended transaction constraints
- [ ] Transaction signing includes proper error handling for `policy_violation` and `insufficient_funds`
- [ ] Webhooks are configured and signatures are verified before processing
- [ ] Authorization signatures are included for server-side wallet operations requiring them
- [ ] Wallet addresses are used only for display; wallet IDs are used in all API calls
- [ ] External wallets are configured for all chains being used
- [ ] Rate limit handling with exponential backoff is implemented for batch operations

## Resources

**Comprehensive navigation**: https://docs.privy.io/llms.txt

**Critical documentation pages**:
1. [Key Concepts](https://docs.privy.io/basics/key-concepts) — Understand authentication, wallets, and controls
2. [React Setup](https://docs.privy.io/basics/react/setup) — Initialize Privy in React apps
3. [API Reference](https://docs.privy.io/api-reference/introduction) — Complete REST API documentation

---

> For additional documentation and navigation, see: https://docs.privy.io/llms.txt