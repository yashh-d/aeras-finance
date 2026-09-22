# Privy policy inventory

Working notes for building the wallet allowlists. This is what the app asks the
embedded wallets to sign today, pulled from the code on 2026-09-07, organised
the way a Privy policy is organised rather than the way a user flow is.

Read the "Map by signature, not by path" section first. It changes how the
mapping should be done.

## Map by signature, not by path

A user path like "USDC on Ethereum to USDC on Solana to a Jupiter Lend vault"
feels like one thing. To the policy engine it is two unrelated events on two
wallets:

1. The EVM wallet signs an ERC-20 approve and a bridge transaction on Ethereum.
   Governed by the **EVM wallet's** policy.
2. USDC lands on Solana. Nothing is signed.
3. The Solana wallet signs a Jupiter Lend deposit.
   Governed by the **Solana wallet's** policy.

There is one policy per wallet, and this app has two embedded wallets per user.
So the whole mapping collapses into two lists: everything the EVM wallet may
sign, and everything the Solana wallet may sign. The "path" is a UI concept and
does not survive into the rules.

Privy denies by default once a policy is attached. Every method the wallet uses
needs a rule or that method stops working. That includes message signing, which
four flows depend on (see below), and which is easy to forget because it moves
no money.

## EVM wallet

### eth_sendTransaction, static destinations

These are hardcoded and stable. An allowlist on `ethereum_transaction.to` covers
them directly. Source files noted so the list can be regenerated.

| Chain | Contract | Address | Source |
|---|---|---|---|
| Ethereum (1) | Morpho Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | lib/morpho/gold-market.ts |
| Ethereum (1) | XAUt (approve target) | `0x68749665FF8D2d112Fa859AA293F07A622782F38` | lib/morpho/gold-market.ts |
| Ethereum (1) | USDT (approve target) | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | lib/morpho/gold-market.ts |
| Monad (143) | USDC (approve target) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | lib/morpho/constants.ts |
| Monad (143) | Vault | `0x78999cc96d2Ba0341588C60CcB0E91c6C33CF371` | lib/morpho/vaults.ts |
| Monad (143) | Vault | `0x80017bF0f793EBbE9679Cd61ff0e395B62CAbB59` | lib/morpho/vaults.ts |
| Monad (143) | Vault | `0xbeEFf443C3CbA3E369DA795002243BeaC311aB83` | lib/morpho/vaults.ts |
| Base (8453) | USDC (approve target) | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | lib/trustware/base.ts |

Approve calldata rules worth adding on top of the `to` allowlist, because the
`to` of an approve is the token, and the token is on every list:

- `approve.spender` must be Morpho Blue (Ethereum), one of the three vaults
  (Monad), or a Trustware provider contract (see dynamic below).
- The app never grants an unlimited allowance. Every approve is sized to the
  amount in hand (lib/trustware/execute.ts `grantApprovals`, lib/morpho/deposit.ts,
  lib/morpho/gold-borrow.ts `approveIfShort`). A cap on `approve.amount` is
  therefore free to add and would have caught any regression to `maxUint256`.

### eth_sendTransaction, DYNAMIC destinations

**This is the first thing to test tomorrow, before writing anything else.** Three
destinations come from an API at runtime, not from a constant, and a fixed `to`
allowlist blocks them unless the set turns out to be stable.

| What | Where it comes from | Why it is dynamic |
|---|---|---|
| Trustware `transaction.to` | route response, lib/trustware/evm-tx.ts | The bridge provider's router. Comments name the LI.FI Diamond. |
| Trustware `approval.spender` | route response, lib/trustware/execute.ts:502 | "Re-quoting can change the provider, so this is read from the route response rather than cached." |
| Ondo deposit address | Ondo provisions one per user, lib/ondo/fund.ts | Per-user. Cannot be enumerated. |
| Lighter intent address | Lighter derives one per user, lib/lighter/margin-fund.ts:323 | Per-user. Cannot be enumerated. |

For Trustware, **measured 2026-09-07 across 12 live routes plus re-quotes**: it
is NOT one router per chain. Trustware runs a provider auction per route, and
the winner decides both `transaction.to` and `approval.spender` (which were
identical in every route seen). Three routers appeared:

| Router | Address | Seen on |
|---|---|---|
| LI.FI Diamond | `0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae` | Ethereum, BNB Chain, Base (canonical, same address on all three) |
| Squid Router | `0xce16f69375520ab01377ce7b88f5ba8c48f8d666` | Ethereum and Base, for same-chain swaps and every route into Arbitrum |
| LI.FI on Monad | `0x026f252016a7c47cdef1f05a3fc9e20c92a49c37` | Monad |

The flip is real and it is per size, not only per pair: Base USDC to Solana
USDC chose LI.FI at $25 and $100 and Squid at $1,000, in the same minute. So
the EVM policy has to allowlist **both** routers on every chain, and
`approve.spender` has to accept both too. That is a closed, small set today, and
the consequence is worth stating: the day Trustware adds a third provider,
every bridge from that provider fails to sign until the policy is updated.
That is the policy failing closed, which is the correct direction, and it wants
a check script that re-runs this capture so the change is noticed as a failed
check rather than as a user report.

For Ondo and Lighter: the destination is a per-user address a third party
controls. A policy cannot list it. What it can do is bound the token and chain
(`to` in the Ondo collateral set on chain 1; USDC on Arbitrum or Base for
Lighter), which is what the server proxy already enforces. Accept that the
address itself is enforced by the proxy, not the enclave, and write that down.

### personal_sign

Two flows sign a message with the EVM wallet. Under default DENY both stop
working without a rule.

| Flow | Message | Rule shape |
|---|---|---|
| Lighter key derivation, lib/lighter/keys.ts | Fixed text beginning `Aeras Finance\n\nDerive Lighter trading key` | `message.content` `starts_with` that prefix |
| Lighter key registration, lib/lighter/onboarding.ts | Lighter's `Register Lighter Account` text, produced by the WASM signer | `starts_with` on Lighter's prefix, confirm the exact bytes from `createSignerClient().registerMessage` |
| Ondo SIWE sign-in, lib/ondo/auth.ts | SIWE challenge minted by Ondo | `starts_with` on the SIWE domain line. Capture one live challenge to get it exact. |
| Ondo payout address registration, lib/ondo/auth.ts | Second SIWE challenge from Ondo | Same prefix as above, most likely. Verify. |

The Lighter derivation message is the important one to get byte-exact: a rule
that rejects it does not fail loudly, it fails as "could not derive key" on the
first hedge.

### Deny outright

- `exportPrivateKey`: DENY. The app never exports a key and never needs to.
  This is the one rule that costs nothing and closes a whole category.

## Solana wallet

### The constraint that shapes everything

Privy's own docs: "Solana policy evaluation does not support resolving addresses
from Address Lookup Tables." When a condition needs an address that lives in an
ALT rather than the transaction's static keys, the condition fails, and under
default DENY a failed condition blocks the transaction.

This matters more here than for most apps because **the app does not build its
Solana transactions.** Kamino's KTX API, Jupiter Ultra, Jupiter's swap API and
Jupiter Lend all return finished transactions, all versioned, all using ALTs.
Whether a given program ID or token account sits in static keys or an ALT is
their choice, not ours, and it can change between routes.

So a Solana policy cannot be designed from the code. It has to be designed from
captured transactions. The check scripts already produce them:

- `scripts/kamino-deposit-check.mts`
- `scripts/jupiter-earn-deposit-check.mts`
- `scripts/jupiter-loop-accounts-check.mts`
- `scripts/kamino-first-position-check.mts`

Decode a sample of each, list which program IDs and which token accounts are
static versus ALT-loaded, and build the rules against what is actually there.
Expect the program-allowlist approach to be fragile for Jupiter routes (DEX
programs are routinely ALT-loaded) and the token-transfer approach
(`solana_token_program_instruction` on `TransferChecked.mint` and the
destination) to be the more useful one, since the mints are a fixed set.

### What IS fixed on the Solana side

| Set | Source |
|---|---|
| The 10 xStock mints with Kamino reserves | lib/kamino/reserves.ts |
| The 4 xStock mints with Jupiter Lend borrow vaults | lib/jupiter/borrow.ts |
| The full curated buy list, including the gold tokens | lib/jupiter/xstocks.ts |
| USDC, SOL | lib/jupiter/constants.ts |
| The send widget's recipient | Free-form, typed by the user. See below. |

### signMessage

One flow, and it is the one the trigger orders depend on.

| Flow | Message | Rule shape |
|---|---|---|
| Jupiter trigger auth, lib/jupiter/use-trigger-auth.ts via lib/privy/sign-message.ts | Challenge from Jupiter | Capture one live challenge and match its prefix |

### The send widget

`buildSendTransaction` in lib/solana/send.ts is the one Solana transaction the
app builds itself, and the one place a destination is typed by hand. A policy
cannot allowlist it, because the recipient is whoever the user chose. This is
the flow that should get the per-action confirmation
(`uiOptions.showWalletUIs: true` on that one call) rather than a rule, and it is
the only flow that should.

## Measured 2026-09-07

Three of the five open questions were answered by capturing live data. What
follows is what the policy engine would actually see.

### Signed messages: exact stable prefixes

Every one of these is `personal_sign` on the EVM wallet except the last, which
is `signMessage` on the Solana wallet. The prefix is the longest run of bytes
that did not change between two different addresses or accounts, and is what a
`message.content starts_with` rule should carry, byte for byte.

| Flow | Stable prefix (JSON-escaped) | Notes |
|---|---|---|
| Lighter key derivation | `"Aeras Finance\n\nDerive Lighter trading key\nAddress: 0x"` | Ours. 296 bytes total. Full text in lib/lighter/keys.ts. |
| Lighter key registration | `"Register Lighter Account\n\npubkey: 0x"` | From the WASM signer. Ends `Only sign this message for a trusted client!` |
| Ondo SIWE sign-in | `"app.ondoperps.xyz wants you to sign in with your Ethereum account:"` | EIP-4361. Captured through the production proxy; Ondo answers `forbidden_country` from a US IP, so this cannot be captured from a laptop here. |
| Jupiter trigger auth | `"Sign this message to authenticate with Jupiter that you are the owner of "` | Solana wallet. The wallet address follows immediately, so the prefix stops there. |

Not captured: the Ondo **payout address** challenge (address-book), which needs
a live session. It is the same EIP-4361 flow from the same host, so the same
prefix is the right bet, but confirm it on the first real registration.

### Solana: what the policy engine can see

Eleven live transactions captured and decoded, covering every builder the app
uses: Kamino KTX (kvault deposit, klend deposit), Jupiter Ultra (buy from USDC,
buy from SOL, sell to USDC), Jupiter swap API, Jupiter Lend earn deposit via
the SDK, the Jupiter Lend leveraged loop, and the three Trustware-built bridge
legs the Solana wallet signs (to Monad, to Ethereum, to Arbitrum).

**In every one, every invoked program sat in the static keys, and no Token or
System instruction touched an ALT-loaded account.** Lookup tables are used
heavily (up to 34 addresses from 4 tables on one Ultra order) but only for pool
and market accounts that no rule needs to name. So both rule shapes are viable
against today's transactions: a program allowlist, and token-transfer rules on
the mints.

The program set a Solana allowlist needs, from the captures:

| Program | ID | Seen in |
|---|---|---|
| ComputeBudget | `ComputeBudget111111111111111111111111111111` | everything |
| System | `11111111111111111111111111111111` | swaps involving SOL |
| Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | swaps, bridges |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | xStock transfers (Backed tokens are Token-2022) |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | most |
| Address Lookup Table | `AddressLookupTab1e1111111111111111111111111` | Kamino klend deposit (creates a table for new users) |
| Jupiter v6 | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | Ultra buys, swap API |
| Jupiter Lend earn | `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9` | earn deposit |
| Jupiter Lend flashloan | `jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS` | leveraged loop (and unwind, same builder) |
| Jupiter Lend borrow vault | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi` | leveraged loop operate; also the plain borrow path in lib/jupiter/borrow.ts |
| Kamino Lend | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | klend deposit |
| Kamino Vault | `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd` | kvault deposit |
| Kamino Farms | `FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr` | kvault deposit |
| LI.FI (Solana) | `LiFiRp8RM7nJUZyUYC9FPPpDr7sAy5XPfBN6ABzBgT7` | bridge to Monad |
| unverified | `61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH` | Ultra SELL only. Likely Jupiter's RFQ fill program. **Verify on Solscan before listing.** |
| unverified | `3i5JeuZuUxeKtVysUnwQNGerJP2bSMX9fTFfS4Nxe3Br` | all three bridge legs. **Verify.** |
| unverified | `EcooswwC1NggsckZyF5SeAL9WsgJs3UhPbrqY1apV73F` | bridges to Ethereum and Arbitrum. **Verify.** |

Two honest caveats. First, "static" is Kamino's, Jupiter's and LI.FI's
choice, not ours, and can change with a route. If it does, the policy denies
the transaction, which is the right direction but is an availability failure
the user will report as "my swap stopped working". Second, Kamino withdraw,
borrow and repay could not be captured: KTX refuses to build them for a wallet
with no obligation, and the check wallet has none. Capture those from a real
position before the Solana policy ships.

## Still open

1. Attaching a policy to an existing user-owned wallet needs the user's
   authorization signature (docs.privy.io/wallets/wallets/update-a-wallet).
   Confirm whether `createOnLogin` can attach one to a NEW wallet with no
   prompt, so only existing users see the one-time request.
2. One policy per wallet. Everything above for a chain has to fit in a single
   rule list, so rule ordering matters: Privy evaluates sequentially and a
   broad ALLOW placed early overrides a narrow rule placed after it.
3. The three unverified Solana program IDs above.
4. Kamino withdraw, borrow and repay transactions, from a wallet that holds a
   position.
