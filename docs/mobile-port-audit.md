# Mobile port audit: SwiftUI and Kotlin/Compose against the existing API

Read-only audit, 2026-08-30. Scope: every file in `/lib` (152 files), classified
for a port to two true-native clients that share only the Next.js API under
`app/api`. No code was written or changed.

Read `CLAUDE.md` first. This document assumes it.

## What this is and how to read it

The four buckets:

- **A, already server-shaped.** The client calls an API route, gets JSON or a
  serialized transaction, signs and/or sends. Porting is an HTTP client plus a
  model struct. Cheap and mechanical.
- **B, must move server-side.** Logic that is client-side TypeScript today, has
  no business being written twice in Swift and Kotlin, and can move behind a new
  API route without exposing key material or weakening the trust model. Each
  entry names the route that should exist.
- **C, must be ported natively, twice.** Touches private keys, signing, or
  wallet state that has to stay on device. Each entry carries a difficulty and
  the specific protocol detail that makes it hard.
- **D, dead weight for mobile.** Web-only, or not worth shipping in mobile v1.

Counts: **A 48, B 53, C 39, D 12.** The buckets are per file, so a file that is
90% pure planning and 10% signing lands in C and says so. The authoritative
per-file assignment for all 152 files is the appendix; the sections below group
them by the work they imply.

The single sentence that matters most: **the port is not evenly hard.** Roughly
two thirds of `/lib` is registries, pure arithmetic and fetch wrappers that
either already sit behind a route or can. The remaining third is concentrated in
four places, and one of them (`lib/lighter/signer.ts`) may not be portable at all
in its current form.

### Headline findings

1. **Privy's native SDKs support dual embedded Solana and EVM wallets for one
   user.** The architecture holds. Two gaps: there is no `createOnLogin` on
   native, and Monad and BNB Chain are not in Privy's default network table.
   Section 1.
2. **The `wallets[0]` hazard and the chain-switch bug both disappear.** Native
   exposes chain-scoped, embedded-only wallet lists, and chain id rides on each
   transaction request. Two bug classes `CLAUDE.md` documents at length become
   structurally impossible.
3. **`lib/lighter/signer.ts` is the one thing that might not port.** It runs
   Lighter's Go signer as a `GOOS=js` WASM module, which needs a JavaScript
   host. If `gomobile` does not work, Lighter does not ship on mobile, which
   takes the default Perps venue and the shipped Hedge tab with it.
4. **`lib/morpho/gold-math.ts` does not need porting at all.** It already runs
   server-side behind two routes; components import one constant from it. The
   Morpho precision guarantee stays in one implementation.
5. **Move transaction building server-side.** It was already the right call on
   maintenance grounds, and the state of Solana Swift makes it close to a
   requirement. Doing so also removes the Compute Budget gap, the
   `skipPreflight` gap and the ATA-derivation trap from the critical path.
6. **The Ondo httpOnly session cookie is the one auth shape that breaks.** Nine
   routes depend on it. It should become a header-borne opaque handle that keeps
   Ondo's JWT server-side. Section 4d.
7. **The EVM surface on the device is ten function encodes and two single-word
   decodes.** No tuple decoding, no runtime keccak, no 256-bit arithmetic, no
   EIP-712. Hand-write it and share the test vectors. Section 3.

---

## Bucket A: already server-shaped (48 files)

These call `app/api/*` and consume JSON. On mobile they become a generated or
hand-written HTTP client plus Codable / kotlinx.serialization models. The only
work beyond that is the auth change described in section 4.

| File | Route it already speaks to | Notes |
|---|---|---|
| `lib/borrow/use-market-stats.ts` | `/api/jupiter/borrow/vaults`, `/api/kamino/reserves/metrics` | Hook body is fetch + interval. |
| `lib/jupiter/charts.ts` | server module behind `/api/jupiter/chart`, `/api/jupiter/sparklines` | Reads `COINGECKO_API_KEY`. Stays server-side, unchanged. |
| `lib/jupiter/convert.ts` | `/api/jupiter/swap/quote`, `/api/jupiter/swap/build` | Quote and build are already server. Only `signAndSendBase64` is C. |
| `lib/jupiter/prices.ts` | `/api/jupiter/prices` | |
| `lib/jupiter/swap-pairs.ts` | consumed by the swap proxies | Server-side allowlist. Never ships to a client. |
| `lib/jupiter/trigger-server.ts` | `app/api/jupiter/trigger/*` | Reads `JUPITER_API_KEY`. Server-only by convention. |
| `lib/jupiter/trigger.ts` | `/api/jupiter/trigger/*` | Thin fetch wrappers. |
| `lib/jupiter/ultra.ts` | `/api/jupiter/order` | Returns a base64 transaction to sign. Exactly the shape a native client wants. |
| `lib/jupiter/use-prices.ts` | `/api/jupiter/prices` | Poll loop. |
| `lib/kamino/borrow.ts` | `/api/kamino/ktx` | KTX returns a compiled base64 transaction. Client signs and sends only. |
| `lib/kamino/positions.ts` | `/api/kamino/obligations` | Fetch plus mapping. |
| `lib/lighter/candles.ts` | consumed by `/api/lighter/candles` | Pure parse and window helpers, used server-side. |
| `lib/lighter/client.ts` | `/api/lighter/markets`, `/api/lighter/account`, `/api/lighter/tx` | Also holds a 4s client cache and in-flight coalescing that must be reproduced. |
| `lib/lighter/markets.ts` | behind `/api/lighter/markets` | Catalog normalisation, already server-side. |
| `lib/lighter/server.ts` | `app/api/lighter/*` | Server-only by convention. |
| `lib/lighter/use-candles.ts` | `/api/lighter/candles`, `/api/lighter/sparklines` | |
| `lib/lighter/use-hedge.ts` | `/api/lighter/markets` + `/api/lighter/account` | |
| `lib/lighter/use-lighter-balance.ts` | `/api/lighter/account` | |
| `lib/lighter/use-lighter-perps.ts` | `/api/lighter/markets` + `/api/lighter/account` | |
| `lib/loops-client.ts` | `/api/loops` | localStorage is a first-paint hint only; the server is authoritative, so mobile can drop the cache entirely. |
| `lib/loops.ts` | `/api/loops` | `server-only`. Takes a verified Privy DID. |
| `lib/morpho/client.ts` | `/api/morpho/metrics`, `/api/morpho/position` | |
| `lib/morpho/gold-client.ts` | `/api/morpho/gold-market`, `/api/morpho/gold-position` | |
| `lib/morpho/gold-math.ts` | consumed by `gold-server.ts` and the two gold routes | **See the note below. This is the good news on the hardest-looking file.** |
| `lib/morpho/gold-server.ts` | `app/api/morpho/gold-*` | `server-only`. Batched `eth_call`. |
| `lib/morpho/use-monad-balances.ts` | `/api/morpho/position` | |
| `lib/ondo/builder.ts` | consumed by `app/api/ondo/orders` | Builder code never reaches a client. Keep it that way. |
| `lib/ondo/client.ts` | `app/api/ondo/*` | |
| `lib/ondo/errors.ts` | consumed by the auth routes | Failure classification. Serve the classification in the JSON body, which it already does. |
| `lib/ondo/markets.ts` | behind `/api/ondo/markets` | |
| `lib/ondo/orders.ts` | `app/api/ondo/orders/route.ts` | Order construction, builder code included, is already server-side. |
| `lib/ondo/preview.ts` | `app/api/ondo/orders` | |
| `lib/ondo/risk.ts` | `app/api/ondo/account`, `app/api/ondo/withdraw` | Also imported by `OndoHedgeSection.tsx`; that use is display-only and should move to the route payload. |
| `lib/ondo/server.ts` | `app/api/ondo/*` | |
| `lib/ondo/sizing.ts` | `app/api/ondo/orders` | Sizing is computed on the server today. This is the model the Lighter path should copy. |
| `lib/ondo/use-ondo-collateral.ts` | `/api/ondo/markets` | Unauthenticated, works with no session. |
| `lib/ondo/use-ondo-hedge.ts` | `/api/ondo/markets` + `/api/ondo/account` | |
| `lib/ondo/use-perps.ts` | `/api/ondo/markets` + `/api/ondo/account` + `/api/ondo/history` | |
| `lib/ondo/withdraw.ts` | `app/api/ondo/withdraw`, `app/api/ondo/address-book/challenge` | The ledger reconstruction runs server-side. |
| `lib/privy/auth.ts` | `app/api/auth/sync`, `/api/loops`, `/api/spend/*` | `server-only`. Verifies the bearer token against Privy's JWKS. Already header-based, so it works from native unchanged. |
| `lib/supabase/server.ts` | all Supabase routes | `server-only`, service-role key. |
| `lib/trustware/client.ts` | `app/api/trustware/*` | Browser half of the proxies. Becomes the HTTP client. |
| `lib/trustware/use-max.ts` | `/api/trustware/quote` | Prices every source at full balance so Max is a number the planner will honour. |
| `lib/trustware/use-preview.ts` | `/api/trustware/quote` | Debounced pricing. Signs nothing. |
| `lib/trustware/server.ts` | `app/api/trustware/*` | `server-only`, holds `TRUSTWARE_API_KEY` and the destination allowlist. |
| `lib/trustware/use-equivalents.ts` | `/api/trustware/balances` | |
| `lib/trustware/use-wallet-scan.ts` | `/api/trustware/balances` | |
| `lib/users.ts` | `app/api/auth/sync`, `app/api/admin/approve` | `server-only`. |

**`lib/morpho/gold-math.ts` is already Bucket A, and this is the most useful
single finding in the audit.** The task brief flags it as a hand port of
`SharesMathLib`, `wTaylorCompounded` and `_isHealthy`, verified to the seventh
decimal of health against Morpho's indexer, and asks how hard it is to port
twice. The answer is that it does not need porting at all. Its importers are
`lib/morpho/gold-server.ts`, `app/api/morpho/gold-position/route.ts`,
`app/api/morpho/gold-market/route.ts`, and `components/GoldBorrowCard.tsx`. The
component imports exactly one symbol, the constant `SUGGESTED_LTV_BUFFER_BPS`
(`components/GoldBorrowCard.tsx:57`). Every bigint function already runs on the
server behind two routes that return finished numbers as strings. A native
client needs `debtAtomic`, `healthFactor`, `availableToBorrowAtomic` and
`withdrawableCollateralAtomic` as decimal strings, which is what
`/api/morpho/gold-position` already returns.

Do not reimplement Morpho's math in Swift or Kotlin. Instead, add
`suggestedBorrowAtomic` to the `/api/morpho/gold-position` response so the last
client-side constant goes away too. The precision guarantee the docs describe
(`docs/morpho-gold.md`, "The math is a port, not an approximation") then stays
in one implementation, in one language, with one live verification, rather than
three that can drift.

---

## Bucket B: must move server-side (53 files)

Each of these is client-side TypeScript today. None of it touches a key. Writing
it twice in Swift and Kotlin buys nothing and creates two more places for a
rounding rule or a registry entry to drift.

The subsections below group by the work implied rather than partitioning the
file list, so a file can be named in two of them (a registry half in B1 and a
transaction-building half in B3). The appendix is the authoritative per-file
assignment.

### B1. Registries and catalogs

These are hardcoded allowlists. They are correctness-critical (a wrong mint
routes a deposit to an unverified token) and they change without a schema
change. Shipping copies inside two app binaries means a registry fix needs an
App Store review to reach users.

| File | Contents |
|---|---|
| `lib/jupiter/xstocks.ts` | Curated buyable catalog. Carries `decimals` per entry (8 or 6) and `tokenProgram` per entry (Token-2022 or classic SPL). |
| `lib/jupiter/constants.ts` | USDC/SOL mints, Ultra base URL, `ULTRA_MIN_USD`, `TRIGGER_MIN_USD`. |
| `lib/jupiter/borrow.ts` (registry half) | `XSTOCK_BORROW_VAULTS`. |
| `lib/kamino/reserves.ts` | `KAMINO_XSTOCKS_MARKET`, collateral reserves, `KAMINO_USDC_BORROW`. |
| `lib/kamino/kvaults.ts` (registry half) | `KAMINO_EARN_VAULTS`, `KAMINO_ALLOWED_KVAULTS`. |
| `lib/lighter/constants.ts` | Chain id 304, tx type tags, asset ids, intent chain ids, deposit contract, minimums, `LIGHTER_API_KEY_INDEX`. |
| `lib/lighter/hedge.ts` | xStock to Lighter market route table. |
| `lib/morpho/vaults.ts` | Curated Monad USDC vaults (V2, not V1). |
| `lib/morpho/constants.ts` | Monad chain id, USDC, native token. |
| `lib/morpho/gold-market.ts` | XAUt/USDT market params, oracle, IRM, LLTV, `ORACLE_PRICE_SCALE`. |
| `lib/morpho/gold-sources.ts` | Gold sources allowed to fund a XAUt deposit. |
| `lib/ondo/constants.ts` | Env selection, haircut, LTV thresholds, deposit network. |
| `lib/ondo/collateral.ts` | Collateral discovery from live `tokenConfig` plus the haircut/cap registry. |
| `lib/trustware/equivalents.ts`, `swap-tokens.ts`, `stables.ts`, `native.ts` | Conversion, swap, USDC and gas registries with per-chain decimals. |

**Route to add: `GET /api/catalog`.** One versioned document holding every
registry above, with an `ETag` and a `version` integer. Native clients cache it
and refuse to act on a document older than a floor the server publishes.
Returns: assets (symbol, name, mint, decimals, tokenProgram, category, logo),
borrow vaults, Kamino reserves and kvaults, Lighter markets and route table,
Morpho vaults and the gold market params, Ondo collateral, Trustware
equivalents / swap tokens / stables / natives, and the numeric constants
(minimums, haircuts, thresholds). Take nothing from the client; this document is
read-only and identical for every user.

`lib/tokens/logos.ts` and `lib/tokens/market-logos.ts` fold into the same
document as URL fields.

### B2. Pure arithmetic and planning

None of this signs anything. All of it is the kind of code where a rounding
direction or a per-market decimal is the whole correctness argument.

| File | What it computes | Route |
|---|---|---|
| `lib/borrow/availability.ts` | Whether any venue lends against a mint | `/api/catalog` (a boolean per asset) |
| `lib/borrow/route.ts` | Which venue lends against a mint, normalising Jupiter's tenths-of-a-percent against Kamino's fractions | `/api/catalog` |
| `lib/jupiter/pay-assets.ts` | Which holdings can pay for a buy, split solana vs bridged | `POST /api/buy/sources` |
| `lib/lighter/borrow-funding.ts` | Four roads from Solana USDC to Lighter margin, with latency per road | `POST /api/lighter/funding-plan` |
| `lib/lighter/borrow-hedge.ts` | `borrowRatio * leverage == 1` sizing for a self-funded hedge | `POST /api/lighter/hedge-plan` |
| `lib/lighter/exposure.ts` | Join of wallet holdings, prices, Lighter positions and the route table | `GET /api/lighter/exposure` |
| `lib/lighter/funding.ts` | Where margin can come from | `POST /api/lighter/funding-plan` |
| `lib/lighter/risk.ts` | Hedge cost and liquidation display math | fold into `/api/lighter/exposure` |
| `lib/lighter/sizing.ts` | `computeOrderSize`, `computeHedgeSize`, `toWireInteger`, `slippageBoundPrice` | **`POST /api/lighter/order-plan`. See the caveat below.** |
| `lib/ondo/exposure.ts` | Ondo equivalent of the above | `GET /api/ondo/exposure` |
| `lib/ondo/hedge.ts` | Route resolution against the live catalog | already server-reachable, expose in `/api/ondo/markets` |
| `lib/ondo/margin-sources.ts` | What the user holds that can become Ondo margin | `GET /api/ondo/margin-sources` |
| `lib/positions/use-positions.ts` | 810 lines flattening four venues into one row shape | **`GET /api/positions`** |
| `lib/solana/holdings.ts` | Grouping two mints of the same equity into one line | `GET /api/wallet/holdings` |
| `lib/solana/equivalent-tokens.ts` | Non-catalog Solana tokens worth displaying | `/api/catalog` |
| `lib/trustware/amounts.ts` | BigInt decimal-string fixed point | server-side; the client sees only formatted strings |
| `lib/trustware/balances.ts` | Narrowing a 129-chain scan to the registry, matched on address | already behind `/api/trustware/balances`; move the narrowing into the route |
| `lib/trustware/gold-holdings.ts`, `ondo-holdings.ts` | Two more selectors over the same scan | same route |
| `lib/trustware/planner.ts` | Convert-then-deposit planning and pricing | **`POST /api/convert/plan`** |
| `lib/trustware/selection.ts` | Dust thresholds, rescale, grouping | fold into `/api/convert/plan` |
| `lib/trustware/swap-quote.ts` | Two pricing engines chosen by pair | `POST /api/swap/quote` (the proxy exists; move the engine choice behind it) |
| `lib/trustware/unified.ts` | Multi-leg sequencing on guaranteed minimums | fold into `/api/convert/plan` |
| `lib/trustware/base.ts` | Base USDC request builders, both directions | fold into `/api/convert/plan` |
| `lib/ondo/session.ts` | Session storage | rewritten as a header-borne handle, see section 4d |
| `lib/ondo/constants.ts` | Env selection, haircut, thresholds | `/api/catalog` plus the session change |

**Caveat on `lib/lighter/sizing.ts`.** Moving sizing server-side is correct on
maintenance grounds and it is what the Ondo path already does
(`app/api/ondo/orders/route.ts` computes the size and refuses to take one from
the caller). But there is a real difference between the two venues. Ondo orders
are submitted by our server under a session token, so the server is already
trusted with the order. Lighter orders are signed on the device with the user's
own trading key, and the server only relays the signed bytes
(`app/api/lighter/tx/route.ts`). If the server computes `baseAmount` and
`slippageBoundPrice`, the device signs numbers it did not derive. That is a
genuine narrowing of the trust model, not a formality.

The honest resolution is a split, not a straight move: the server returns the
plan (`baseAmount`, `wirePrice`, the reason for any clamp), and the device
re-checks the two invariants that actually protect the user before it signs -
that `baseAmount * price` is within a tolerance of the notional the user typed,
and that `slippageBoundPrice` sits on the correct side of the mark. Those are
about fifteen lines of integer arithmetic per platform, which is a fair price
for keeping the venue's own guarantee intact. The per-market decimal scaling,
the two exchange minimums and the quote cap all stay on the server.

### B3. Solana chain reads and transaction building

This is the largest and least obvious block. Today the browser holds a
`Connection`, derives associated token accounts, parses Anchor accounts and
assembles versioned transactions. Every one of those is a place where a native
port can be wrong in a way that reads as a zero balance rather than an error.

| File | What it does today | Route |
|---|---|---|
| `lib/solana/balances.ts` | `getTokenAccountsByOwner`, ATA derivation across two token programs, USD valuation | `GET /api/wallet/balances?address=` |
| `lib/solana/activity.ts` | Parsed transaction history, classified into swap/send/receive | `GET /api/wallet/activity?address=` |
| `lib/solana/send.ts` | Builds an SPL `transferChecked` plus idempotent ATA creation | `POST /api/solana/build/transfer` returns `BuiltTransaction` |
| `lib/solana/await-balance.ts` | Polls an ATA until a target lands | `GET /api/wallet/balances` polled by the client, or a dedicated long-poll |
| `lib/jupiter/borrow.ts` | Anchor discriminator scan, `getProgramAccounts`, PDA derivation, `buildOperateTx` | `GET /api/jupiter/borrow/position?address=` and `POST /api/jupiter/borrow/build` |
| `lib/jupiter/earn.ts` | Builds deposit/withdraw/redeem with `@jup-ag/lend`, wSOL sync, ATA idempotent creation, priority fee | `POST /api/jupiter/earn/build` |
| `lib/jupiter/multiply.ts` | Composes flashloan + swap + operate into one transaction with address lookup tables | `POST /api/jupiter/multiply/build` |
| `lib/kamino/kvaults.ts` (`composeKvaultTx`) | Assembles KTX instructions client-side with web3.js | `POST /api/kamino/kvaults/build` |
| `lib/borrow/use-borrow-summary.ts` | Reads Jupiter and Kamino positions on chain | `GET /api/positions` |
| `lib/borrow/use-vault-collateral.ts` | Reads posted vault collateral on chain | `GET /api/positions` |
| `lib/solana/priority-fee.ts` | Helius `getPriorityFeeEstimate` with a p75 fallback and a floor | server-side, inside every build route |
| `lib/trustware/base.ts`, `use-max.ts`, `use-preview.ts`, `use-conversion.ts` (planning halves) | Route request construction and pricing | `/api/convert/plan` |

**The contract for every build route is the same, and it already exists in the
codebase.** `BuiltTransaction` in `lib/solana/send-confirm.ts` is
`{ transaction: base64, blockhash, lastValidBlockHeight }`. Every build route
returns exactly that. The device signs the base64 blob and either hands it back
to Jupiter's execute endpoint or broadcasts it. `lastValidBlockHeight` is the
field that lets the client distinguish "still in flight" from "dead", and the
comment in `send-confirm.ts` notes that every build site used to throw it away.
A native client must not throw it away either.

Moving transaction building server-side also removes the need for a native
Solana library to do anything hard. See section 2.

`lib/jupiter/borrow.ts` carries one extra thing to redesign rather than port:
`positionNftStorageKey` / `readStoredNftId` store the position NFT id in
`localStorage`, with `findExistingNftId` as an on-chain recovery scan when that
is cleared (`lib/jupiter/borrow.ts:349-460`). On mobile there is no
`localStorage` and the recovery scan should simply become the primary path,
served from `GET /api/positions`. Keeping a device-local cache of an id that the
chain already knows is a bug waiting to happen twice.

### B4. Server-side session and identity changes

Covered in detail in section 4. Listed here because the work is server work, not
client work.

`lib/ondo/session.ts`, `lib/ondo/constants.ts` (cookie name and TTL),
`lib/ondo/auth.ts` (the route contract half), `lib/jupiter/use-trigger-auth.ts`
(the JWT cache half), `lib/waitlist.ts`, `lib/morpho/gold-abi.ts`,
`lib/trustware/types.ts` (`toQuantity` and the response extractors),
`lib/trustware/constants.ts`.

---

## Bucket C: must be ported natively, twice (39 files)

Ordered by difficulty. The estimates assume one competent engineer per platform
who has not worked with these protocols before. As in Bucket B, the subsections
group by the work implied rather than partitioning the file list, and C4 covers
two files that are classified B. The appendix is authoritative.

### C1. `lib/lighter/signer.ts`, the hardest problem in the port

**Difficulty: very high. This may be a blocker for the Lighter venue on mobile.**

Every Lighter transaction is signed with a Schnorr signature over ECgFp5, the
quintic extension of the Goldilocks field, hashed with Poseidon2. That is not
secp256k1 and not ed25519. The file's own comment is explicit that no JavaScript
library implements it, so the app runs Lighter's Go signer compiled to
WebAssembly: `public/lighter/main.wasm`, 7.7 MB, built from `elliottech/lighter-go`
at commit `cef81af` with `GOOS=js GOARCH=wasm`, paired with a `wasm_exec.js`
shim from Go 1.26.3.

The problem for a native port is not WASM. It is `GOOS=js`. A `js/wasm` Go
binary requires a JavaScript host: it calls into `syscall/js` for every value
that crosses the boundary, and `wasm_exec.js` is that host. A standalone WASM
runtime on iOS or Android cannot run this artifact as it stands. The Go exports
are also curried (`_signCreateOrder(...)` returns a function that returns the
promise) and report failure by resolving with `{ error }` rather than rejecting,
both of which are JS-shaped conventions baked into the boundary.

Four options, with honest assessments:

1. **Rebuild `lighter-go` with `gomobile`.** Produces an `.xcframework` for iOS
   and an `.aar` for Android from the same Go source. This is the most likely
   path to work and it keeps the signer as Lighter's own code rather than a
   reimplementation. Cost: a Go toolchain in two mobile build pipelines,
   `gomobile bind` API constraints (it does not export arbitrary Go types, so a
   thin Go wrapper package is needed), and app size. Unknown until tried:
   whether the `web-wasm` package's entry points map cleanly onto a
   `gomobile`-bindable API, and whether any of the crypto uses `js`-tagged build
   constraints.
2. **Rebuild for `GOOS=wasip1 GOARCH=wasm` and run it in a native WASM runtime**
   (Wasmtime or WasmKit on iOS, Chicory or wasmtime-java on Android). Avoids two
   toolchains but adds a runtime dependency and a second FFI boundary, and
   wasip1 Go still has quirks around goroutines and blocking. Also: the current
   module's `main` blocks forever on a channel to stay resident, which the JS
   host tolerates and a wasip1 host may not.
3. **Reimplement Schnorr-over-ECgFp5 with Poseidon2 in Swift and Kotlin.** Do
   not do this. It is a from-scratch implementation of a non-standard curve and
   a non-standard hash, twice, with financial transactions as the test suite.
4. **Move signing server-side.** Prohibited by the trust model. The trading key
   is derived from a `personal_sign` signature (`lib/lighter/keys.ts`), so
   sending that signature to a server hands the server the key, and the key can
   place orders and sign withdrawals (`LIGHTER_TX_TYPE_WITHDRAW`, 13) for 24
   hours at a time. The whole point of deriving rather than storing is that
   nothing but the wallet has to persist.

Note the practical consequence for scope: **if option 1 does not work, Lighter
does not ship in mobile v1.** That takes the default Perps venue and the shipped
Hedge tab with it. Ondo would become the mobile perps venue by default, which is
a product decision, not just an engineering one, because Ondo's cost is an
Ethereum leg and a SIWE sign-in.

### C2. `lib/lighter/keys.ts`, deterministic trading key derivation

**Difficulty: medium, but it is load-bearing for C1.**

The trading key is the `personal_sign` output over a fixed message, handed to
the signer as a 65-byte seed. Three things must be preserved exactly:

- `keyDerivationMessage` is byte-for-byte stable. Any whitespace change derives
  a different key for every existing user. Both native clients must produce the
  identical string, including the trailing structure of the joined array.
- The message is hex-encoded before `personal_sign`, and the signature is passed
  to the signer with `0x` stripped (`signature.slice(2)`).
- The derivation depends on ECDSA determinism (RFC 6979). Privy's native SDKs
  must produce the same signature the web SDK does for the same wallet and
  message. If they do not, a user who onboarded on web gets a different trading
  key on mobile and their registered key no longer matches.

`registeredKeyMatches` is the guard that catches this, and it is why the failure
would be visible rather than silent: a mismatch re-registers rather than signing
orders the sequencer will reject. Port it including the all-zero check, which
distinguishes an empty slot from a real registration.

**This is a cheap experiment and it should be run first.** See section 5.

### C3. `lib/trustware/execute.ts`, EVM route execution

**Difficulty: high. 656 lines, and most of it is failure handling.**

What has to be reproduced per platform:

- **Chain switching, at the wallet level.** `connectChain` switches, then polls
  a *fresh* provider for `eth_chainId` until it matches, nudging
  `wallet_switchEthereumChain` as a fallback, with a 5 second deadline. Nothing
  is signed until a provider reports the target chain. Getting this wrong once
  presented a Monad approval as an Ethereum transaction. Whether the native
  Privy SDKs even have the same provider-versus-wallet split is an open question
  (section 1); if they take a chainId per call instead, this whole dance
  simplifies, and that would be good news.
- **Allowance handling.** Read the current allowance through
  `/api/trustware/allowance`, compare against `approval.amount`, and only then
  encode `approve(spender, amount)`. The spender comes from the route response,
  never cached, because re-quoting can change the provider.
- **Receipt submission ordering.** `submitTrustwareReceipt` runs immediately
  after broadcast, before anything else, with 6 attempts and exponential
  backoff. If it fails the error message must say the funds moved and are not
  lost, and carry the hash. That copy is part of the correctness of the module,
  not decoration.
- **Settlement tracking.** Poll `/api/trustware/status`, treat 404 as "not
  started yet", treat a non-OK response as transient and back off rather than
  aborting, honour `next_poll_at`, and throw only on an explicit `failed`.
  15 minute ceiling.
- **The abort rule.** The last free abort is before signing, so the guaranteed
  minimum is re-checked against the shortfall after the fresh route comes back
  and before the transaction is sent.

The pure translation half, `lib/trustware/evm-tx.ts`, is small and must be
ported exactly: quantities go through `toQuantity` because some payloads are hex
and some decimal, and `maxFeePerGas` wins over `gasPrice` because sending both
is rejected by every node. Its own comment calls it the highest-risk pure code
in the conversion path. It is 58 lines and it is worth writing a shared test
vector file of captured live payloads that both platforms run against.

A native app also has to solve something the web app gets free: **backgrounding.**
A 15 minute settlement poll on a phone will be suspended. This needs either a
server-side tracker that the app queries on resume, or a background task plus a
resumable state machine keyed on `intentId`. Recommend the former: add
`GET /api/convert/intents?address=` returning every in-flight intent for a
wallet, so a cold-started app can rejoin a conversion it did not start.

### C4. `lib/solana/send-confirm.ts` and `lib/solana/priority-fee.ts`

**Both are classified B, not C, and this subsection explains why and states what
a C port would have to preserve if that recommendation is rejected.** They are
discussed here because the brief asks for them under C and because this is where
a reader will look for them.

`send-confirm.ts` takes signed bytes, not keys. Nothing in it is secret. So it
*can* move server-side: the device signs, POSTs the signed base64 to
`POST /api/solana/send`, and the server broadcasts, polls and returns the
signature or a typed failure. That is the recommendation, because the module
encodes the fixes for two live production bugs, and having one implementation of
those fixes beats three.

If it is ported natively anyway, these are the invariants a port MUST preserve,
taken from `CLAUDE.md` and the module's own comments:

1. **Never call a bare-signature confirm.** web3.js's legacy strategy is a flat
   30 second timer that confirms over a WebSocket signature subscription and
   polls `getSignatureStatus` exactly once, after the subscription goes live.
   A blockhash lives 150 slots, roughly 60 to 90 seconds, so it gave up at half
   life and reported failures on transactions still in flight and on
   transactions that had already landed. The replacement polls
   `getSignatureStatuses` every 2 seconds with **no WebSocket in the path at
   all.** Any native library's convenience "confirm" helper is presumed guilty
   of the same design until proven otherwise; do not use one.
2. **Never cap `maxRetries` on the send.** It was `maxRetries: 3`, which stops
   the RPC rebroadcasting after about five seconds; one dropped packet at a
   leader transition and nothing re-sent. Leave it unset so the node
   rebroadcasts until the blockhash expires. Both of these were live production
   bugs.
3. Keep preflight ON for the first send (`skipPreflight: false`) so a doomed
   transaction becomes a readable error, and OFF for the rebroadcasts inside the
   loop.
4. Rebroadcast on every poll, and check block height only every third poll
   (`HEIGHT_CHECK_EVERY = 3`) to halve request count over a full window.
5. `stillAlive` errs toward "yes" on any RPC error, because expiry is the one
   answer that tells the user nothing moved. `MAX_POLLS = 60` exists only
   because of that deliberate bias.
6. Do one last status read after deciding it is dead: a transaction can land in
   the same slot its blockhash expires, and calling that a failure is the
   original bug in reverse.
7. Preserve the four-way failure taxonomy (`rejected`, `failed`, `expired`,
   `unknown`) and their distinct user-facing messages. `expired` promises
   nothing moved; `unknown` deliberately refuses to promise that and points at
   the signature.

`priority-fee.ts` must keep: the Helius `getPriorityFeeEstimate` call with
`includeAllPriorityFeeLevels`, taking `high` not `medium`; the p75-of-non-zero
fallback over `getRecentPrioritizationFees` (raw samples returned 150 zeros on
an uncongested slot, so a naive median prices back to zero); the
`FLOOR_MICRO_LAMPORTS_PER_CU = 10_000` floor; and the
`MAX_PRIORITY_FEE_LAMPORTS = 2_000_000` ceiling computed against the *requested*
compute unit limit, because Solana charges on the requested limit and not on
units consumed. Every transaction the app builds sets a compute unit **price**,
not just a limit.

If the build routes move server-side per B3, `priority-fee.ts` never needs a
native port, because it only ever runs while assembling a transaction.

### C5. Privy wallet resolution and signing

**Difficulty: unknown until section 1 resolves. Assume medium.**

`lib/privy/solana.ts`, `lib/privy/evm.ts`, `lib/privy/sign.ts`,
`lib/privy/sign-message.ts`, `lib/privy/provider.tsx`, plus `lib/privy/auth.ts`
on the server (which is already A).

The rule that must survive the port: **never index the wallets array.** The web
SDK sorts by `connectedAt`, so `wallets[0]` stops being the embedded wallet the
moment a user connects an external one, and reads and signatures silently land
on the wrong account. `lib/privy/evm.ts` pins on `walletClientType === "privy"`.
`lib/privy/solana.ts` cannot, because the Solana subpath's
`ConnectedStandardSolanaWallet` carries no `walletClientType`, so it resolves
the embedded address off `user.linkedAccounts` (matching
`type === "wallet" && walletClientType === "privy" && chainType === "solana"`)
and then matches the signer object by address.

Whatever the native SDKs expose, the port must reproduce that resolution and it
must fail loudly rather than fall back to an index. `requireEmbeddedSolanaWallet`
already models the loud failure.

Also to preserve: `showWalletUIs: false`. The product thesis is that users do
not touch a wallet UI, and a funded Morpho deposit signs several transactions
that must read as one action. If the native SDKs force a confirmation sheet per
signature, the one-click flows change shape on mobile and that is a product
regression worth surfacing early.

### C6. EVM write paths

| File | Difficulty | What makes it hard |
|---|---|---|
| `lib/morpho/gold-borrow.ts` | High | Encodes `supplyCollateral`, `borrow`, `repay`, `withdrawCollateral` against the Morpho Blue singleton, each carrying the full `MarketParams` struct as a tuple. USDT's non-compliant `approve` needs the zero-reset (`approveIfShort`). A full repayment is sized in **shares**, not assets, because debt accrues every second. XAUt is 6 decimals, not 18. |
| `lib/morpho/deposit.ts` | Medium | ERC-4626 deposit/withdraw on Monad, same chain-switch dance. |
| `lib/morpho/fund.ts` | High | 832 lines. Solana USDC to Monad USDC through Trustware, plus a one-time native MON gas top-up because the embedded wallet is born with no gas. |
| `lib/morpho/gold-fund.ts` | High | 951 lines. The conversion is a **sale**, not a bridge, so it is bounded on value loss priced at the market's own oracle rather than at a token registry (Trustware lists Ethereum GLDx at 17x its real sale price). Also buys ETH for gas. Works around a live upstream defect: Trustware cannot route Solana gold directly to XAUt, so funding sells to USDC first, and the planner retries direct every time. |
| `lib/ondo/unwind.ts` | Medium | Two Ethereum signatures to bring an Ondo token home to Solana. |
| `lib/lighter/bridge-home.ts` | Medium | Ethereum USDC home to Solana, with a gas top-up leg. |
| `lib/jupiter/pay-bridge.ts` | Medium | Bridged buy leg one, with a pre-signature gas check that refuses with a readable reason. |

The *planning* half of each of these is Bucket B and should be extracted before
any of it is written twice. What is irreducibly C is: request a provider on the
right chain, encode calldata, send, poll a receipt. Everything upstream of that
(which route, what it costs, is it too lossy, is there enough gas) is a server
decision that returns a plan.

### C7. Orchestrators and signing hooks

These sequence signatures. They are C because the sequencing has to live where
the signatures live, and because their failure handling between steps is the
whole value of the file.

`lib/lighter/onboarding.ts`, `order.ts`, `trade.ts`, `withdraw.ts`,
`deposit.ts`, `one-click.ts`, `borrow-bridge.ts`, `use-margin-funding.ts`,
`use-one-click-hedge.ts`, `use-lighter-withdraw.ts`;
`lib/ondo/auth.ts`, `fund.ts`, `one-click.ts`, `use-ondo-margin.ts`,
`use-ondo-unwind.ts`, `use-ondo-withdraw.ts`;
`lib/borrow/fund-repay.ts`; `lib/trustware/use-conversion.ts`;
`lib/jupiter/use-trigger-auth.ts`.

Specific things a port must not lose:

- `lib/lighter/order.ts` and `trade.ts`: **read the nonce fresh immediately
  before signing** (`currentNonce`), never from the state the panel rendered
  from, because a rejected order still spends the nonce. Re-run
  `ensureTradingKey` on every order even for a user who registered weeks ago,
  because the WASM signer's client table does not survive a reload. Closing is
  always `reduceOnly: 1`; without it an oversized close flips the user into the
  opposite position.
- `lib/lighter/deposit.ts`: the intent address is a **bare SPL token account**,
  165 bytes, not a wallet. `lib/solana/send.ts` cannot be reused because it
  would derive an ATA *of* a token account. Name the destination directly and
  derive nothing.
- `lib/ondo/fund.ts`: the bridge is pointed at Ondo's provisioned deposit
  address, not the user's EVM wallet, which is what makes it one signature and
  no ETH. A provisioned deposit address is not proof an asset is credited, and
  the plan refuses past a value-loss bound.
- `lib/lighter/one-click.ts` writes to `localStorage` at line 247. That needs a
  device-appropriate store or, better, the server-side loop record that
  `lib/loops.ts` already provides.
- `lib/jupiter/use-trigger-auth.ts`: the Jupiter Trigger JWT is held **in memory
  only**, per Jupiter's guidance, never persisted. Do not put it in Keychain or
  EncryptedSharedPreferences out of tidiness.

### C8. Cheap but unavoidable

`lib/lighter/types.ts` and `lib/ondo/types.ts` become model structs on each
platform. Both files document that numeric fields arrive as strings and that
preserving that distinction is deliberate, so a caller cannot do float
arithmetic on a value meant to be parsed as an exact decimal. Model these as
`String`, not `Double`, on both platforms. `lib/ondo/types.ts` also documents
that every response is wrapped in an envelope with `success: false` carrying the
reason.

---

## Bucket D: dead weight for mobile v1 (12 files)

| File | Why |
|---|---|
| `lib/ui/surface.ts` | A Tailwind class string for the glass card. Meaningless off the web. |
| `lib/utils.ts` | `clsx` + `tailwind-merge`. |
| `lib/waitlist.ts` | Email validation for the web signup form. Mobile users arrive already approved; the server keeps its own validation. Ship the "pending" state, not the form. |
| `lib/rysk/catalog.ts` | Rysk is a read-only options chain with no trading path. It is not in `CLAUDE.md`'s Built Since v1 list, and `docs/rysk.md` is not in the file's own docs index. Treat it as experimental. |
| `lib/rysk/client.ts` | as above |
| `lib/rysk/constants.ts` | as above |
| `lib/rysk/server.ts` | as above |
| `lib/rysk/strategy.ts` | as above |
| `lib/rysk/types.ts` | as above |
| `lib/rysk/use-chain.ts` | as above |
| `lib/tokens/logos.ts` | Folds into `/api/catalog` as URL fields; the file itself does not port. |
| `lib/tokens/market-logos.ts` | as above |

The Rysk route and server module cost nothing to leave running for the web app.
They are D here because nothing in the mobile port should touch them.

Two further scope recommendations, stated as opinion rather than classification:

- **`/spend` (the Rain virtual card) is out of scope for mobile v1.**
  `spend/session.ts` does RSA-OAEP-SHA1 key wrapping and AES-GCM decryption of
  the PAN and CVC in the browser via WebCrypto, so the server never sees a
  plaintext card number. That is portable (CryptoKit / Tink both do
  RSA-OAEP-SHA1 and AES-GCM) but it puts card data on device, which drags in
  App Store and Play review questions about financial data handling, screenshot
  protection and jailbreak detection. Not a first release.
- **`lib/jupiter/multiply.ts` (looping) is a candidate to defer.** It is the
  single most complex transaction the app builds and it is a power-user feature.

---

## 1. Privy: can the native SDKs do dual Solana + EVM embedded wallets?

**Yes. The architecture holds.** A single user can have both an embedded Solana
wallet and an embedded EVM wallet on both native SDKs, sign raw transactions on
each, and get the same access token the server already verifies. The premise of
the port is sound and this section does not need to be read as a warning.

Two real gaps and one genuine improvement follow. The gaps are Monad and BNB
Chain network registration, and automatic wallet creation. The improvement is
that two of the bug classes `CLAUDE.md` documents at length become structurally
impossible.

### What the SDKs are

Both are genuinely native, not React Native wrappers, and both sit on a shared
Kotlin Multiplatform core (`io.privy:kmp-embedded-wallet-public` publishes
`-iosarm64`, `-iossimulatorarm64`, `-iosx64` and `-android` variants).

- iOS: `github.com/privy-io/privy-ios`, a binary Swift package distributing
  `PrivySDK.xcframework`. Closed source, no source in the repo. Latest release
  2.15.0, 2026-08-25, continuous release history since 2.0.0 in June 2025.
  iOS 17 / macOS 14 minimum, Swift tools 6.0, zero dependencies.
- Android: no public repo. Maven Central, `io.privy:privy-core`, latest 0.14.0,
  last updated 2026-08-12. API 28+, Kotlin 2.1.0+.

Two maturity flags worth stating plainly. The Android SDK is still **0.x** by
its own version number. And the Swift installation page still describes 2.x as
"still in beta", which looks stale against 14 months of non-prerelease shipping
but is what the docs say today.

The authoritative capability source is Privy's own machine-readable matrix at
`docs.privy.io/basics/get-started/platforms`. Everything below cites it or a
per-feature page that carries an explicit Swift and Android view.

### (a) Embedded Solana wallets: yes

Creation is `createSolanaWallet()` on both platforms, returning
`EmbeddedSolanaWallet`. It fails if the user already has one, so the client SDK
caps a user at one embedded Solana wallet.

Signing goes through `wallet.provider`, typed `EmbeddedSolanaWalletProvider`:

- Swift: `signMessage(message: String) -> String`,
  `signTransaction(transaction: Data) -> String`,
  `signAndSendTransaction(transaction:cluster:options:) -> String`
- Kotlin: the same three, `Result`-returning, `signTransaction(transaction: ByteArray)`

The matrix marks creating, signing, broadcasting, HD wallets and automatic
recovery as supported for both `ethereum` and `solana` on both `swift` and
`android`. iOS release 2.6.0 (2025-11-20) is where Solana `signTransaction` and
`signAndSendTransaction` landed, so this is nine months old, not new.

### (b) Embedded EVM wallets: yes

`createEthereumWallet(allowAdditional:)` returning `EmbeddedEthereumWallet`,
whose `provider` is `EmbeddedEthereumWalletProvider` with a single
`request(EthereumRpcRequest)` method. `allowAdditional` exists because the EVM
wallets are HD and a user may hold several, capped at nine.

### (c) Both at once: yes, but there is no `createOnLogin`

`PrivyUser` exposes two separate, chain-scoped, embedded-only lists:

```
var embeddedEthereumWallets: [EmbeddedEthereumWallet] { get }
var embeddedSolanaWallets:   [EmbeddedSolanaWallet]   { get }
```

Kotlin is identical. `LinkedAccount` was deliberately split into
`.embeddedEthereumWallet` and `.embeddedSolanaWallet` cases in the Swift 2.0
migration, so the dual-wallet model is first class rather than tolerated.

**The gap: automatic wallet creation is React and React Native only.** The
matrix row "Creating wallets automatically" carries `react` and `reactNative`
and has no `swift` or `android` key. `PrivyConfig` on both native SDKs has no
`embeddedWallets` field at all; the complete Swift config is `appId`,
`appClientId`, `loggingConfig`, `customAuthConfig`, and Android adds only
`logLevel` and `networkStateManager`. `createOnLogin` is documented solely on
`docs.privy.io/basics/react/advanced/automatic-wallet-creation`.

This matters more here than it would in most apps. `lib/privy/provider.tsx` sets
`createOnLogin: "all-users"` on *both* chains, and `CLAUDE.md` is explicit about
why `all-users` rather than `users-without-wallets`: a user who signs in with
Phantom already has a wallet, and the narrower setting would provision nothing
and leave them with no account to hold a position in. A native client that has
to make two separate create calls after login can fail halfway, and a user with
a Solana wallet but no EVM wallet has no Trustware, no Lighter key registration,
no Ondo session and no Morpho venue.

**Recommendation: pregenerate both wallets server-side in `/api/auth/sync`.**
Wallet pregeneration *is* supported on native (matrix:
`{'Pregenerating wallets', swift: ['ethereum','solana'], android: [...]}`) and
`docs.privy.io/recipes/pregenerate-wallets` shows one server call creating a
user with an email linked account plus both a `chain_type: 'ethereum'` and a
`chain_type: 'solana'` wallet. `app/api/auth/sync/route.ts` already runs after
login, already verifies the token, and already treats email as the merge key.
Adding pregeneration there restores the `all-users` guarantee atomically and
takes the client out of the loop entirely. It also benefits the web app, which
currently depends on the SDK doing it.

### (d) Raw transaction signing: yes on both chains

**Solana.** `signTransaction` takes an already-serialized transaction built
elsewhere and returns the base64-encoded signed transaction. The parameter doc
reads "The serialized transaction to sign" and the return is "The base64-encoded
signed transaction". That is exactly the Jupiter Ultra shape in
`lib/jupiter/ultra.ts` and `lib/privy/sign.ts`: base64-decode the order, sign,
POST the returned string to execute. `signMessage` takes base64 and returns a
base64 signature, which covers `lib/privy/sign-message.ts` (re-encode to base58
for Jupiter Trigger).

**Do not use `signAndSendTransaction`.** Its `cluster` / `rpcUrl` / `sendOptions`
parameters apply only in on-device execution mode; Privy's default is TEE
execution, and under that default the broadcast goes through Privy's own RPC.
That would silently discard `NEXT_PUBLIC_SOLANA_RPC_URL`, the uncapped
`maxRetries`, and the polling confirmation in `lib/solana/send-confirm.ts`, all
three of which exist because of live production bugs. Use `signTransaction` and
broadcast through our own path. This is what `CLAUDE.md` already mandates, so
the correct native design and the existing rule agree.

**EVM.** The provider is described as "inspired by" EIP-1193, not an
implementation of it: `request(EthereumRpcRequest)` takes a typed enum, not a
`{ method, params }` dictionary. The four cases the app needs all exist on both
platforms: `.personalSign(message:address:)`,
`.ethSignTypedDataV4(address:typedData:)`, `.ethSendTransaction(transaction:)`
and `.ethSignTransaction(transaction:)`. The transaction struct is
`UnsignedEthTransaction(from:to:value:chainId:data:gasLimit:)`, which covers
every field `lib/trustware/evm-tx.ts` builds.

`personal_sign` support is the load-bearing one: it is what
`lib/lighter/keys.ts` derives the trading key from and what `lib/ondo/auth.ts`
signs the SIWE challenge with.

### (e) The `wallets[0]` hazard: it does not exist on native

This is the cleanest result in the audit. The web hazard is that `useWallets()`
returns one array mixing embedded and external wallets sorted by `connectedAt`.
**The native SDKs never build that array.** There is no `useWallets()`
equivalent. Wallets are reached through `embeddedEthereumWallets` and
`embeddedSolanaWallets` on `PrivyUser`: chain-scoped, embedded-only, and typed
`EmbeddedEthereumWallet` / `EmbeddedSolanaWallet`. External wallets live
somewhere else entirely, in `linkedAccounts`.

So the two workarounds in the repo become unnecessary rather than needing a
port. `lib/privy/evm.ts`'s `walletClientType === "privy"` filter and
`lib/privy/solana.ts`'s address-matching against `user.linkedAccounts` (needed
because `ConnectedStandardSolanaWallet` carries no `walletClientType`) are both
solved by the type system.

Two residual ordering caveats, and they are worth honouring because the failure
mode is the same silent wrong-account bug:

- Android documents `embeddedEthereumWallets` as "ordered from most recently
  connected to least recently connected". With `createEthereumWallet`'s
  `allowAdditional` defaulting to false there is normally exactly one, but do
  not write `.first()` as a habit. Pin by address.
- `walletClientType` does exist on native, with a different meaning: it is an
  *input* you supply as login metadata for an external wallet
  (`WalletClientType.metamask`), not a discriminator you read off a wallet.
  Do not go looking for `wallet.walletClientType == .privy`.

### (f) EVM chains: this is the real gap, and it lands on Monad and BNB Chain

Signing on an arbitrary chain id is fine, and better than the web. Chain id
rides on each transaction request: "To send a transaction on a different
network, simply set the wallet's `chainId` in the transaction request." The
docs' own example is Base at `0x2105`.

**That eliminates an entire documented bug class.** `CLAUDE.md` devotes two
bullets to the fact that a provider instance is bound to the chain active when
it was requested, that `wallet_switchEthereumChain` on a provider does not move
the wallet's active chain, and that Privy propagates the switch through React
state so a callback closing over the old wallet resolves old-chain providers
forever. Getting it wrong once presented a Monad approval as an Ethereum
transaction. `connectChain` in `lib/trustware/execute.ts` and `connectEthereum`
in `lib/morpho/gold-borrow.ts` both exist to fight this. On native there is no
`switchChain` documented at all, and none is needed. The `chainId` read-back
guard can stay as belt and braces, but the failure it guards cannot occur.

**What is missing is chain registration.** The matrix rows "Custom EVM
(Ethereum) network support" and "Custom SVM (Solana) network support" are
`react` and `reactNative` only. `supportedChains`, `defaultChain`,
`defineChain` and `addRpcUrlOverrideToChain` are documented only under
`/basics/react/` and `/basics/react-native/`, and none of those concepts appears
in `PrivyConfig` on Swift or Android.

Against Privy's default network list, the four chains in
`lib/privy/provider.tsx` land like this:

| Chain | Chain id | In Privy's default list |
|---|---|---|
| Ethereum | 1 | yes |
| Base | 8453 | yes |
| BNB Chain | 56 | **no** |
| Monad | 143 | **no** |

Monad appears on that page only inside a tip pointing at the React-only custom
chain flow. **UNCONFIRMED:** whether Privy's backend will broadcast an
`eth_sendTransaction` for an arbitrary `caip2` (`eip155:143`, `eip155:56`) from
a native client when no chain was ever registered. The REST endpoint types
`caip2` as a bare required string with no enumerated values and no documented
allowlist, and no dashboard-level chain configuration was found in the sitemap.

**The workaround is real and the app is already shaped for it.**
`eth_signTransaction` is documented on both native SDKs and returns a signed
transaction (RLP) that the app broadcasts itself. Signing is chain-agnostic
given a `chainId`; only broadcasting needs an RPC. So Monad and BNB Chain become
sign-then-self-broadcast. Base and Ethereum can use either path.

The cost is not zero, and it is worth naming: on the self-broadcast path the app
owns nonce management, gas estimation and fee fields, all of which
`lib/trustware/execute.ts` currently gets from the provider for free. Note also
that `CLAUDE.md` says there is no EVM RPC of our own and that Trustware's
`/sdk/rpc/evm` proxy covers allowance reads only. `lib/morpho/gold-market.ts`
already broke that rule once by adding `ETHEREUM_RPC_URL` beside `MONAD_RPC_URL`
for general `eth_call`. A native port on the self-broadcast path would need
those RPCs for `eth_sendRawTransaction`, `eth_getTransactionCount` and gas
estimation too. Do that server-side, behind a route, not with an RPC URL
embedded in an app binary.

### (g) Login methods: email and Google yes, external wallets no

| Method | Swift | Android |
|---|---|---|
| Email OTP | yes | yes |
| SMS OTP | yes | yes |
| Google OAuth | yes | yes |
| Apple OAuth | yes | **no** |
| Twitter, Discord, Telegram | yes | yes |
| Passkeys | yes | yes |
| SIWE / SIWS login | yes | yes |
| External wallet connectors | **no** | **no** |

The matrix row reads `{'OAuth', swift: 'Google, Apple, Twitter, Discord',
android: 'Google, Discord, Twitter'}`. Apple missing on Android is worth
knowing; Apple's own review guidelines make Sign in with Apple relevant on iOS,
where it is supported.

**External wallet connect is the gap.** The "External wallets" matrix row is
`react` only, and the connecting-external-wallets page has a React view and
nothing else. Native gives you SIWE and SIWS *login* primitives
(`privy.siwe.generateMessage` then `privy.siwe.login(message:signature:)`, and
the SIWS mirror), but the docs state plainly that obtaining the signature is
your job: "You should do this using the library your app uses to connect to
external wallets (e.g. the MetaMask iOS SDK or WalletConnect)."

`lib/privy/provider.tsx` currently offers Phantom, Solflare, Backpack, MetaMask,
Coinbase, OKX and WalletConnect. On native, each is a separate mobile SDK or
deeplink integration to write and maintain, twice.

**Recommendation: ship email, Google and Apple only in mobile v1, and drop
external wallet login.** `CLAUDE.md` already establishes that an external wallet
is "a login method, never the account the app operates on", so nothing
downstream depends on it. Every position, balance and signature belongs to the
embedded wallet either way. The one thing lost is the funding-source
convenience, and a user can still send assets to their embedded address.

Note the interaction with the access gate: `app/app/page.tsx` holds
`/api/auth/sync` until an email exists because email is the merge key
(`users_email_unique`). Dropping wallet-only login on mobile removes the entire
class of user that lands on the "add your email" prompt, which simplifies the
native onboarding rather than complicating it.

### (h) Access token: yes, unchanged

`try await user.getAccessToken()` on Swift, `user.getAccessToken(): Result<String>`
on Kotlin, both on `PrivyUser`, both refreshing the session first if needed.
Same token, same JWKS, same server verification. **`lib/privy/auth.ts` and every
route that calls `authenticate(request)` work from a native client with no
change at all.** `PrivyUser` also exposes `identityToken`.

### (i) Other gaps worth knowing before committing

Absent from `swift` and `android` in the capability matrix, each React or
React-Native only: creating wallets automatically; custom EVM and SVM network
support; external wallets and the wagmi / ethers / `@solana/web3.js` connectors;
native smart wallets; global wallets; user-controlled recovery; **key export and
key import**; and the "transfer from exchange" and "pay with card" funding
methods. Native gas sponsorship is marked as available via server relay rather
than natively.

The Swift OAuth page states that retrieving a user's OAuth provider access and
refresh tokens is not yet supported on Swift.

One internal contradiction, flagged because it cuts the useful way: the matrix
marks Transaction MFA as React-only, but iOS release 2.9.0 (2026-02-20) shipped
a full MFA surface (TOTP, SMS, passkey enroll and verify,
`privy.mfa.resumeBlockedActions()`). Treat the matrix as a floor and check
release notes before concluding something is missing.

### One product consequence: `showWalletUIs`

`lib/privy/provider.tsx` sets `showWalletUIs: false` so a funded Morpho deposit,
which signs several transactions, reads as one action. That setting is a
React provider config field and has no counterpart in `PrivyConfig` on native.
Because the native SDKs give you the provider methods directly and Privy ships
no default signing UI on Swift or Android outside React Native's
`PrivyElements`, the native default should already be "no modal". **UNCONFIRMED**
that no confirmation sheet appears; verify it during the first experiment,
because if one does appear per signature, the one-click flows change shape on
mobile and that is a product regression, not a bug.

## 2. Solana in Swift and Kotlin

**Kotlin is in reasonable shape. Swift is not: the only viable library is
unmaintained since April 2025 and its ed25519 dependency is archived.**

That sounds worse than it is, and the reason is the B3 recommendation. How much
Solana library you need depends entirely on whether the client builds
transactions or only signs them. If every transaction is built by a server route
and returned as base64, the native client needs almost no Solana library at all.
If the client builds transactions the way `lib/jupiter/earn.ts`,
`lib/jupiter/multiply.ts` and `lib/solana/send.ts` do today, it needs a mature
one on both platforms, and on Swift that does not exist.

**This is the strongest independent argument for moving transaction building
server-side.** The recommendation was already made on maintenance grounds. The
state of Solana Swift makes it close to a requirement.

### The libraries

Swift:

| Library | State |
|---|---|
| `p2p-org/solana-swift` ("SolanaSwift"), tag 5.0.0 | The only viable option. Last commit on `main` 2025-04-25, roughly 16 months stale. Community PRs open through August 2026, unmerged. One author wrote about 1493 of ~1660 commits and appears to have moved on. |
| `metaplex-foundation/Solana.Swift` (formerly `ajamaica`) | Abandoned. Last release 2.0.2, October 2022. No `VersionedTransaction`, no `MessageV0`, no ComputeBudget, no Token-2022. Legacy transactions only. |
| `blocto/solana-web3.swift` | Dead, last push 2022. |
| `jauyou/JupSwift` | Small, MIT, Jupiter-focused, but mnemonic-wallet-centric and therefore incompatible with a Privy embedded wallet. |
| Solana Mobile Swift | Does not exist. The org's only Swift repo is archived. |

Kotlin:

| Library | State |
|---|---|
| `sol4k/sol4k`, `org.sol4k:sol4k:0.8.2` | Healthy. Published to Maven Central 2026-07-17. Steady releases. Bus factor of one plus dependabot. Note the search.maven.org index showing 0.5.14 is stale; `maven-metadata.xml` has 0.8.2. |
| `solana-mobile/web3-solana:0.3.2-beta6` | Modern, Kotlin Multiplatform, still beta. |
| `solana-mobile/rpc-solana:0.2.12-beta3` | The matching RPC client. Beta. Its `confirmTransaction` is a polling loop over `getSignatureStatuses` with backoff and no websocket, which is exactly the pattern `send-confirm.ts` requires. |
| `metaplex-foundation/SolanaKT`, `dlgrech/ksol` | Both abandoned since 2023. |

### Versioned transactions with address lookup tables

Both leading libraries handle this properly, which was the main risk.

- **sol4k:** `VersionedTransaction.from(base64String)`, `.sign(keypair)` or
  `.addSignature(base58)`, `.serialize()`. `TransactionMessage.deserialize`
  parses and re-emits `addressLookupTables` as `CompiledAddressLookupTable`.
- **p2p-org Swift:** `VersionedTransaction.deserialize(data:)`, `.sign(signers:)`
  or `.addSignature(publicKey:signature:)`, `.serialize()`. Real `MessageV0`
  with `addressTableLookups`, `MessageAddressTableLookup`, `LoadedAddresses` and
  a `getAddressLookupTable` RPC call. It is a genuine web3.js port.
- **web3-solana:** can parse a v0 message but `Message.Builder.build()` always
  returns a `LegacyMessage`. It cannot construct v0. That is a hard blocker if
  chosen for anything that builds.

That matters for `lib/jupiter/multiply.ts`, which is the one place in the repo
that manipulates `AddressLookupTableAccount` directly, and for Jupiter Ultra
orders, which come back as v0.

### Building from scratch

sol4k and p2p-org both support it, including v0 with lookup tables
(`TransactionMessage.newMessage(...)` and `compileToV0Message(...)`
respectively). sol4k's `AddressLookupTableAccount(key, addresses)` must be
populated by the caller because it has no `getAddressLookupTable` RPC.
web3-solana cannot build v0 at all.

### Compute budget: the biggest Swift gap

`CLAUDE.md` requires that any transaction the app builds itself sets a compute
unit **price**, via `resolvePriorityFee`.

- sol4k: yes. `SetComputeUnitPriceInstruction(microLamports)` and
  `SetComputeUnitLimitInstruction`, correct program id.
- web3-solana: yes. `ComputeBudgetProgram.setComputeUnitPrice(ULong)` and
  `.setComputeUnitLimit(UInt)`.
- **Swift: absent from every library surveyed, p2p-org included.**

It has to be hand-rolled on iOS. It is small and the encoding is well
established: program id `ComputeBudget111111111111111111111111111111`, no
accounts, limit is discriminator byte `0x02` followed by a `u32` little-endian,
price is byte `0x03` followed by a `u64` little-endian. Roughly 50 lines.

This is a small amount of code with a large blast radius, and it is exactly the
kind of thing that should exist once. If build routes are server-side,
`lib/solana/priority-fee.ts` keeps running in TypeScript and neither platform
ever writes it.

### SPL token accounts, Token-2022 and ATA derivation

`lib/jupiter/xstocks.ts` carries `tokenProgram` per entry because PAXG is
Token-2022 and XAUt0 is classic SPL, and deriving with the wrong program yields
an account that does not exist so the balance reads as zero rather than as an
error. How each library handles that:

- **p2p-org Swift is the best of any library surveyed on this.**
  `getTokenAccountsByOwner<T: TokenAccountLayoutState>` is generic over layout
  with both `TokenAccountState` and `Token2022AccountState` including extension
  parsing, and `OwnerInfoParams(mint:programId:)` filters by program. Crucially,
  `PublicKey.associatedTokenAddress(walletAddress:tokenMintAddress:tokenProgramId:)`
  takes `tokenProgramId` as a **required parameter with no default**, which makes
  the exact bug the repo guards against unrepresentable.
- **sol4k works but defaults to classic SPL.**
  `PublicKey.findProgramDerivedAddress(holder, mint, programId = TOKEN_PROGRAM_ID)`
  accepts an override, but the default is precisely the bug. It also has
  **no `getTokenAccountsByOwner` at all**, verified absent repo-wide.
- **web3-solana is weakest.** No Token-2022 program constant anywhere, and no
  ATA derivation helper; `AssociatedTokenProgram` builds the create instruction
  but takes the associated account as a parameter.

If balances move behind `GET /api/wallet/balances` as recommended in B3, none of
this is on the critical path. If they do not, the Kotlin side needs a
hand-written `getTokenAccountsByOwner` and a lint rule against calling
`findProgramDerivedAddress` without an explicit program id.

### RPC and the polling confirmation pattern

The good news first: **none of the three libraries exposes `maxRetries` on
send**, so none of them can cap it. The bug documented in `CLAUDE.md` cannot be
reintroduced by using a library default.

- **p2p-org Swift covers the pattern fully.** It has `getSignatureStatuses`, an
  `observeSignatureStatus(signature:timeout:delay:)` `AsyncStream` that polls
  `getSignatureStatuses` on a configurable delay, and `waitForConfirmation`.
  Websockets are a separate opt-in `Socket` module rather than the default path.
  `RequestConfiguration` exposes `skipPreflight` and `preflightCommitment`. This
  is close to a direct match for `send-confirm.ts`.
- **sol4k has two blocking gaps.** No `getSignatureStatuses` and no
  `getTokenAccountsByOwner`, both verified absent. Its `sendTransaction` sends
  only `{"encoding":"base64"}`, so **`skipPreflight` is not settable**, and
  `send-confirm.ts` needs it both ways (on for the first send, off for
  rebroadcasts). An open PR (sol4k#214, 2026-07-31, unmerged) asks for exactly
  this, citing landing rates. `rpcCall` is private, so the fix is writing your
  own JSON-RPC calls against the public `RpcTransport` interface rather than
  extending `Connection`. `Connection` is also fully blocking
  (`HttpURLConnection`, no `suspend`), so it needs wrapping in `Dispatchers.IO`.
- **rpc-solana** is the better Kotlin RPC on this specific axis, since its
  `confirmTransaction` already polls with backoff and no websocket, but it is
  missing `getTokenAccountsByOwner` and `getTokenAccountBalance`.

Every one of these gaps disappears if `POST /api/solana/send` exists.

### Ed25519 signing: mostly moot, with one conflict to resolve

Per section 1, Privy's native Solana provider exposes
`signTransaction(transaction: Data) -> String` returning the base64-encoded
**signed transaction**, on both Swift and Kotlin. If that behaves as documented,
the app never touches an ed25519 key and never splices a signature: it passes
the base64 blob through and gets a signed blob back. That is the same shape
`lib/privy/sign.ts` uses today.

**Flagging a genuine conflict between the two research passes.** The Solana
research concluded that Privy's native SDKs expose only a raw `signMessage`
primitive, and that the app would therefore have to deserialize the transaction,
serialize its message, sign that, splice the 64-byte signature into the
signature array, and re-serialize. The Privy research found a documented
`signTransaction` on both platforms with a specific docs page and stated
parameter and return semantics. The Privy finding cites the more specific
source, so it is the more likely of the two, but the disagreement is unresolved
and it changes how much Solana library the port needs. **Resolve it with
experiment 2 in section 5 before choosing a library.**

For completeness, if key handling ever is needed:

- **iOS:** CryptoKit's `Curve25519.Signing` is RFC 8032 Ed25519 and works for
  Solana. The gotcha is that `rawRepresentation` is the 32-byte seed while a
  Solana secret key is 64 bytes (seed followed by public key), so pass only the
  first 32. p2p-org uses TweetNacl instead, and
  `bitmark-inc/tweetnacl-swiftwrap` was **archived on 2025-06-17**, so CryptoKit
  is the better choice.
- **Android: a real trap.** Android's bundled BouncyCastle does not support
  Ed25519; `KeyPairGenerator.getInstance("Ed25519")` fails at runtime unless
  full `bcprov-jdk18on` 1.79+ is bundled and the provider registered explicitly.
  sol4k avoids this by vendoring TweetNaclFast, which is pure Java and needs no
  provider. Tink is for at-rest encryption, not Solana signing.

### Dependency risk on Swift, stated plainly

`p2p-org/solana-swift` declares `swift-tools-version:5.7.1`, so Swift 6 strict
concurrency compatibility is **unconfirmed**. Its ed25519 dependency is
archived. Its secp256k1 dependency (`Boilertalk/secp256k1.swift`) last saw a
commit in October 2022, and an open issue reports its symbols colliding with
other Swift crypto packages, with two PRs to repoint it closed unmerged.

If iOS depends on this library, plan to vendor or fork it and pin to a commit.
That is a maintenance commitment, and it should be a deliberate decision rather
than something discovered later.

### Mobile Wallet Adapter is irrelevant here

MWA is a protocol for a dApp to request signatures from a **separate wallet app**
on the device. Aeras keys live in a Privy embedded wallet in process, so there
is no second app to talk to. It is also Android-only; Solana Mobile's own docs
state iOS does not support it because of inter-app communication restrictions.
Skip it.

### Recommendation

1. **Move transaction building server-side (B3).** Then the client's entire
   Solana surface is: hold an address, call routes, pass a base64 blob to Privy,
   pass the signed blob to a route. Neither platform needs a mature Solana
   library, the Swift maintenance problem stops being on the critical path, the
   Compute Budget gap never has to be filled twice, and `skipPreflight`,
   `maxRetries` and the polling confirmation stay in the one implementation that
   already encodes the production fixes.
2. If any client-side building survives that: **Android sol4k 0.8.2**, budgeting
   for hand-written `getSignatureStatuses` and `getTokenAccountsByOwner` against
   the public `RpcTransport`, always passing `programId` explicitly, and noting
   that `java.util.Base64` implies minSdk 26 or core library desugaring.
   **iOS `p2p-org/solana-swift`, pinned and vendored**, plus roughly 50 lines of
   ComputeBudget encoding.
3. Worth a look but not today: `web3-solana` and `rpc-solana` publish
   `iosArm64`, `iosSimulatorArm64` and `iosX64` artifacts, so the Solana Mobile
   KMP stack could give one shared core for both platforms. It is blocked today
   by beta status, no Token-2022, no ATA derivation and no v0 message
   construction. If the client never builds a v0 transaction, which is exactly
   what recommendation 1 achieves, that last blocker does not apply.

## 3. EVM in Swift and Kotlin: what replaces viem

**Nothing has to replace viem, because the surface the device needs is far
smaller than viem's.** This section starts with what the app actually encodes,
because that reframes the library question entirely.

### What the device actually has to encode and decode

Every `encodeFunctionData` and `decodeFunctionResult` call site in the repo,
enumerated. The split between server and device is already clean.

**Encoded on the device (Bucket C), 10 functions total:**

| Contract | Function | Where |
|---|---|---|
| ERC-20 | `approve(address,uint256)` | `lib/trustware/execute.ts:507`, `lib/morpho/deposit.ts:229`, `lib/morpho/gold-borrow.ts:219,233` |
| ERC-20 | `allowance(address,address)` | `lib/morpho/deposit.ts:212`, `lib/morpho/gold-borrow.ts:178` |
| ERC-20 | `balanceOf(address)` | `lib/morpho/deposit.ts:280`, `lib/ondo/use-ondo-unwind.ts:125` |
| ERC-4626 | `deposit(uint256,address)` | `lib/morpho/deposit.ts:243` |
| ERC-4626 | `withdraw(uint256,address,address)` | `lib/morpho/deposit.ts:299` |
| ERC-4626 | `redeem(uint256,address,address)` | `lib/morpho/deposit.ts:292` |
| Morpho Blue | `supplyCollateral(MarketParams,uint256,address,bytes)` | `lib/morpho/gold-borrow.ts:278` |
| Morpho Blue | `withdrawCollateral(MarketParams,uint256,address,address)` | `lib/morpho/gold-borrow.ts:450` |
| Morpho Blue | `borrow(MarketParams,uint256,uint256,address,address)` | `lib/morpho/gold-borrow.ts:323` |
| Morpho Blue | `repay(MarketParams,uint256,uint256,address,bytes)` | `lib/morpho/gold-borrow.ts:401` |

**Decoded on the device: two functions.** `allowance` and `balanceOf`, both a
single `uint256`.

**Everything that returns a struct is already server-side.** `market`,
`position`, `price` and `borrowRateView` are decoded only in
`lib/morpho/gold-server.ts` (lines 114, 154, 175, 229), which carries
`import "server-only"`. Tuple *decoding*, which is the hardest thing in both
ecosystems and the thing the task brief flagged as a risk, **never happens on a
phone.**

Four consequences follow, and each removes a research finding from the critical
path.

1. **Tuple encoding is needed once and it is the easy case.** `MarketParams` is
   four addresses and one `uint256`, all static, so it inlines into the head
   with no offset arithmetic. The only dynamic argument anywhere is the trailing
   `bytes` on `supplyCollateral` and `repay`, and it is always `"0x"`, so its
   tail is an offset word plus a zero length word. `supplyCollateral` is nine
   32-byte words after the selector, and the layout does not vary.
2. **Keccak-256 is not needed at runtime.** The contract set is fixed and
   hardcoded (`MORPHO_BLUE`, `XAUT`, `USDT` in `lib/morpho/gold-market.ts`;
   the vault registry in `lib/morpho/vaults.ts`), so all ten selectors are
   compile-time constants. Keccak is needed only in a test that asserts them.
   `grep` confirms the word `keccak` appears exactly once in the repo, in a
   comment in `gold-market.ts` about the market id, which is itself a hardcoded
   constant.
3. **No 256-bit arithmetic is needed on the device.** Amounts arrive from server
   routes as decimal strings. Encoding needs decimal string to 32-byte
   big-endian unsigned, and nothing else. The WAD math, the truncated Taylor
   series and the rounding directions all live in `lib/morpho/gold-math.ts`,
   which is Bucket A.
4. **EIP-712 is not needed at all.** `grep` for `signTypedData`, `EIP712` and
   `TypedData` across `lib`, `app`, `components` and `spend` returns nothing.
   The app signs `personal_sign` only, for the Lighter key derivation and the
   Ondo SIWE challenge. If EIP-712 is ever needed, section 1 confirms Privy's
   native SDKs expose `.ethSignTypedDataV4(address:typedData:)` with structured
   typed data on both platforms, so it would be Privy's hashing, not ours.

**Recommendation: hand-write the encoder on each platform, and share the test
vectors.** Ten functions, one static tuple, one always-empty dynamic argument,
two single-word decodes, precomputed selectors, no keccak, no bignum. That is a
few hundred lines per platform, exhaustively testable, with no dependency and no
supply-chain risk. Generate a vector file once from viem or Foundry
(arguments in, expected calldata out) and run it in both XCTest and JUnit. That
gives the correctness guarantee a shared library is supposed to buy at near-zero
build complexity.

The library survey below is what to reach for if that recommendation is
rejected, and it also carries two traps that apply to the hand-written path.

### The two traps, which apply either way

**Swift: `swift-crypto` and CryptoKit cannot do Keccak-256, and fail silently.**
They expose `SHA3_256`, `SHA3_384` and `SHA3_512` only, and initialise through
`CXKCPShims_Keccak_HashInitialize_SHA3_256`. They vendor XKCP but wire up only
the NIST-padded variant. Using `SHA3_256` where Keccak-256 is meant produces
wrong selectors with no error. Use CryptoSwift, which has
`SHA3.Variant.keccak256` distinct from `.sha256` and uses mark byte `0x01` for
keccak against `0x06` for SHA-3.

**Kotlin: BouncyCastle's `SHA3Digest` extends `KeccakDigest` and overrides the
padding.** Use `org.bouncycastle.jcajce.provider.digest.Keccak.Digest256` or
`org.bouncycastle.crypto.digests.KeccakDigest(256)`. Never `SHA3Digest`. web3j
gets this right (`Hash.java` imports the `Keccak` provider class). For a
Kotlin Multiplatform target, `org.kotlincrypto.hash:sha3` 0.8.0 keeps
`Keccak-256` distinct from `SHA3-256`.

**Assert this once per platform with the canonical vector.** `keccak256("")` is
`c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`. If the test
produces `a7ffc6f8bf1ed766...` the implementation is SHA3-256 and every selector
it derives is wrong.

### If a library is used anyway

**Swift.** No viem equivalent exists that is worth betting a financial app on.

| Library | Latest | Last commit | Verdict |
|---|---|---|---|
| `argentlabs/web3.swift` | 2.0.0 tag, 2026-08-19 | 2026-08-30 | Healthiest. Also ships SIWE and EIP-712 modules. Statically typed `ABITuple` path handles structs; the dynamic path throws `notCurrentlySupported` on tuples. Cannot take a JSON ABI and go. |
| `web3swift-team/web3swift` | 3.3.2, 2025-09-30 | 2025-09-24 | Alive but ~11 months stale, 74 open issues. Tuple encoding is fully correct with real head/tail and recursive `isStatic`. But the API is `[Any]` in and `Data?` out, so a type mismatch yields `nil` rather than a diagnostic. Wrap in a throwing typed facade if used. |
| `chainnodesorg/Web3.swift` (formerly Boilertalk) | 0.8.8 | **2024-05-02** | **Dead.** The repo was transferred and has not been touched since. Do not adopt. |
| `hayesgm/Eth.swift` | none | 2026-04-03 | Two stars, personal project. Not a production basis. |

Take `argentlabs/web3.swift` for its ABI, SIWE and EIP-712 modules if you take
one, and skip its client; both Swift libraries drag in SwiftNIO and
websocket-kit for a JSON-RPC client you do not need.

**Kotlin.** web3j is genuinely maintained under LF Decentralized Trust (5,391
stars, pushed 2026-08-18, Java releases through 6.0.0 in June 2026), and its ABI
and crypto modules are correct. **But its Android line is stranded**: the README
directs Android users to `org.web3j:core:4.12.3-android`, published 2025-01-10,
while the current Java line requires Java 21. There is no 5.x or 6.x Android
artifact. Ignore `org.web3j:core-android` entirely; that is a dead 2016 artifact
id topping out at 2.2.1.

The cleaner Android answer is `Kr1ptal/ethers-kt` (v2.0.1, 2026-08-19, Java 11+,
minSdk 24), which has an `ethers-abi` module with `AbiCodec`, `AbiStruct` and an
`eip712` package. The caveat is 65 stars. `komputing/KEthereum` is dormant since
October 2023 and should not be adopted.

One web3j edge to guard whichever way you go: `FunctionEncoder.buildMethodSignature`
flattens struct types when composing the signature (web3j issue #1293), so
assert every computed selector against `keccak(signature)[0:4]` in a test. That
is the same test the hand-written path needs, which is another reason to write
it once regardless.

### Big integer math, for completeness

Needed only if 256-bit arithmetic ends up on the device after all.

**Swift:** `attaswift/BigInt` 6.0.1 remains the only real answer, since Swift
has no native 256-bit integer and `swift-numerics` has no BigInt. Two things to
know. Both Swift EVM libraries pin below 6.0.0 (`web3swift` at
`upToNextMinor(from: "5.4.0")`, argentlabs at `from: "5.7.0"`, which SwiftPM
reads as `< 6.0.0`), so taking either caps the app below BigInt 6.x. And
`BigUInt` is arbitrary precision: **it does not wrap at 2^256**, where Solidity
0.8.x reverts. A faithful port of Morpho's math would need explicit
`bitWidth > 256` assertions everywhere Solidity would revert, maintained by code
review forever.

**Kotlin:** `java.math.BigInteger` is sufficient on JVM and Android with three
pitfalls that bite exactly this kind of code. It is signed, so decoding a
`uint256` with the high bit set must use `BigInteger(1, bytes)` or it becomes
negative. `toByteArray()` emits a sign byte, so a 256-bit value with the top bit
set serialises to **33 bytes** and corrupts calldata if padded straight into a
slot; use a left-pad that strips the leading `0x00`. And it does not wrap
either. For Kotlin Multiplatform, `java.math.BigInteger` is unavailable;
`ionspin/kotlin-multiplatform-bignum` is the established choice.

**This is the strongest argument for keeping `lib/morpho/gold-math.ts` on the
server.** Reproducing `mulDivUp`, `wTaylorCompounded` and `_isHealthy` in two
languages with two different sets of overflow and sign pitfalls, against a
guarantee stated as agreement to the seventh decimal of health, is a large
correctness liability for no benefit. It is already server-side. Leave it there.

### JSON-RPC

No web3 library needed. `eth_call`, `eth_getTransactionReceipt`, `eth_chainId`
and `eth_getTransactionCount` are POSTs with a
`{ jsonrpc, id, method, params }` body. `URLSession` with `Codable`, or OkHttp
or Ktor with `kotlinx.serialization`, is sufficient. The only real work is hex
quantity encoding, which `lib/trustware/types.ts` already implements as
`toQuantity`: `0x`-prefixed, no leading zeros, `0x0` for zero, and distinct from
hex *data*, which is byte-aligned and zero-padded. `lib/trustware/evm-tx.ts` is
in Bucket C precisely because that distinction is easy to get wrong.

Note the placement question from section 1: if Monad and BNB Chain need
sign-then-self-broadcast, the RPC calls behind that should go through a server
route rather than an RPC URL compiled into an app binary.

### On sharing the layer rather than writing it twice

Three options were assessed. For this codebase the answer is the first, and the
reason is that the second and third are solving a problem the server already
solved.

- **Write it twice, share the test vectors.** Recommended. The device surface is
  ten encodes and two single-word decodes against fixed contracts. Cross-language
  vector files give the correctness guarantee without the build cost.
- **Kotlin Multiplatform** via `ethers-kt` v2.0.0, which added iOS targets on
  2026-08-09. Plausible but uncomfortable: Swift sees Kotlin through an
  Objective-C-flavoured header, Gradle enters the iOS pipeline, and the iOS half
  of a financial app would rest on a 65-star library whose Apple support is
  three weeks old and whose bignum dependency has no verifiable track record.
- **Rust via FFI** (`alloy-core` 1.7.1 plus `ruint` for a true `U256`, bound
  with UniFFI 0.32.0). This is the most correct option and the research
  recommended costing it specifically for the Morpho fixed-point math, because
  it gives exact uint256 semantics for free rather than as a discipline
  maintained in two languages. **That recommendation does not apply here, and it
  is worth saying why:** the Morpho fixed-point math is not on the device. It
  runs in `lib/morpho/gold-server.ts` behind two API routes. The only thing Rust
  would buy is exact semantics for arithmetic the phone never performs. The
  build cost (Rust toolchains in two CI pipelines, six cross-compilation
  targets, 1.5 to 4 MB per architecture, debugging across three languages) buys
  nothing at that point.

That is the general shape of this section and of the audit: **most of the hard
EVM and Solana work is not hard on mobile, because it is already on the server
or belongs there.** What is left on the device is signing, and a small amount of
byte layout around it.

## 4. Auth: every route a native client needs, and where browser state breaks

There are 58 route files under `app/api`. They fall into four auth shapes, and
only one of them breaks on native.

### 4a. The shape that already works: `Authorization: Bearer <privy token>`

`lib/privy/auth.ts` reads the token off the `Authorization` header
(`tokenFromHeader`), verifies it against Privy's JWKS
(`https://auth.privy.io/api/v1/apps/{appId}/jwks.json`) with `verifyAccessToken`,
then fetches the canonical user by DID. No cookie is involved anywhere in that
path. A native client that can call `getAccessToken()` and set a header works
against these unchanged.

| Route | Methods |
|---|---|
| `app/api/auth/sync` | POST |
| `app/api/loops` | GET, POST, DELETE |
| `app/api/spend/card` | GET, POST |
| `app/api/spend/purchase` | POST |

`app/api/admin/approve` uses `ADMIN_SECRET` and is not a client route at all.

### 4b. The shape that also works: a client-held bearer forwarded upstream

The Jupiter Trigger routes take a bearer the client obtained itself and forward
it (`app/api/jupiter/trigger/orders/route.ts:16,39` read it via a `bearer()`
helper). `lib/jupiter/use-trigger-auth.ts` runs challenge to `signMessage` to
verify, caches the JWT **in memory only** keyed to the wallet, and refreshes at
23 hours against Jupiter's 24. Native clients do the same thing with an
in-memory cache. Nothing browser-specific here.

| Route | Notes |
|---|---|
| `app/api/jupiter/trigger/auth/challenge` | POST, unauthenticated, returns a message to sign |
| `app/api/jupiter/trigger/auth/verify` | POST, returns the JWT to the client |
| `app/api/jupiter/trigger/orders` | GET, POST, bearer forwarded |
| `app/api/jupiter/trigger/orders/cancel/[orderId]` | POST, bearer forwarded |
| `app/api/jupiter/trigger/orders/confirm-cancel/[orderId]` | POST, bearer forwarded |
| `app/api/jupiter/trigger/deposit` | POST |
| `app/api/jupiter/trigger/vault` | GET |

### 4c. Unauthenticated routes: 37 of them, and that is mostly fine

Every read of public market data, and every proxy whose only job is to hold a
server-side API key, takes no auth today. Address-scoped reads take the address
as a query parameter and return only public on-chain data, which is not a leak
because anyone can read the same data from an RPC.

Address-scoped, unauthenticated: `app/api/kamino/kvaults/positions`,
`app/api/kamino/obligations`, `app/api/morpho/position`,
`app/api/morpho/gold-position`, `app/api/lighter/account` (by `l1Address`).

Key-holding proxies with no auth: all six `app/api/trustware/*`,
`app/api/kamino/ktx`, `app/api/kamino/kvaults/ktx`, all the
`app/api/jupiter/swap/*` and `app/api/jupiter/order` routes,
`app/api/lighter/tx`, `app/api/ondo/markets`, `app/api/ondo/history`,
`app/api/rysk/chain`, `app/api/prices/native`.

Two things worth saying plainly rather than leaving implied.

First, **this is not a native-client problem, it is an existing exposure that a
public mobile binary makes easier to find.** Anyone can already read these
endpoints from a browser today. But an app binary is a static artifact people
inspect, and shipping one publishes the full route surface and its parameter
shapes in a way a web app does not. The Trustware proxies in particular spend a
paid API key on behalf of whoever calls them, and `app/api/lighter/tx` is a
relay into Lighter from a permitted region. Both are allowlisted by shape
(`lib/jupiter/swap-pairs.ts` for the swap proxies, a four-type allowlist in
`app/api/lighter/tx/route.ts`), which bounds what an abuser can do but not how
much of it they can do.

Recommendation, and it is cheap: require the Privy bearer on the key-holding
proxies before mobile ships, and rate limit per DID. The verification path
already exists and is one `authenticate(request)` call per route. Leave the pure
public catalog reads open.

Second, `app/api/lighter/tx` must keep running in Frankfurt. The region comes
from `vercel.json` `regions`, not from any export in the route file, and
`preferredRegion` in the file did nothing. Lighter geo-blocks `sendTx` and only
`sendTx`, so in the wrong region every order fails with code 20558 while every
read succeeds. This is unchanged by a native client and is noted here only
because it is the kind of thing a mobile-era infrastructure change breaks
silently.

### 4d. The shape that breaks: the Ondo SIWE httpOnly cookie

**Nine routes depend on a cookie that a native client should not be asked to
carry.**

`lib/ondo/session.ts` stores the Ondo JWT in an httpOnly, `sameSite: lax`,
`secure` cookie named by `ONDO_SESSION_COOKIE`, capped to
`ONDO_JWT_TTL_SECONDS` (86400, matching Ondo's own `exp - iat`). It is set by
`setOndoSession`, read by `readOndoSession` / `requireOndoSession`, and cleared
by `clearOndoSession`. The value is base64url of `{ token, address }`; the
address is stored so a session minted for one Privy wallet cannot silently keep
trading after the user switches wallets.

Routes that call `requireOndoSession` or touch the cookie:

| Route | Methods |
|---|---|
| `app/api/ondo/auth/session` | POST (sets), DELETE (clears) |
| `app/api/ondo/account` | GET |
| `app/api/ondo/orders` | POST |
| `app/api/ondo/leverage` | POST |
| `app/api/ondo/deposit-address` | POST |
| `app/api/ondo/withdraw` | GET, POST |
| `app/api/ondo/address-book` | GET, POST, DELETE |
| `app/api/ondo/address-book/challenge` | POST |
| `app/api/ondo/agreement` | POST |

`app/api/ondo/auth/challenge`, `app/api/ondo/markets` and `app/api/ondo/history`
are unauthenticated and unaffected.

**Why this breaks on native, precisely.** It is not that native HTTP clients
cannot do cookies. `URLSession` has `HTTPCookieStorage` and OkHttp has a
`CookieJar`, and either would technically work. It breaks for four reasons that
compound:

1. **httpOnly buys nothing on a phone and costs clarity.** The flag exists to
   keep page JavaScript from reading the token, as the module comment says.
   There is no page JavaScript in a native app. The protection is aimed at a
   threat that does not exist here, while the mechanism (an ambient credential
   attached by the transport rather than by the caller) makes it much harder to
   reason about which request is authenticated as whom.
2. **Two ambient credentials with different lifetimes.** A native client already
   carries a Privy bearer. Adding a cookie means requests carry two credentials
   from two systems that expire independently, and the failure mode when they
   disagree is a 401 with no obvious cause.
3. **`sameSite: lax` and `secure` are browser concepts.** A native stack either
   ignores them or enforces them inconsistently, and neither outcome is a
   guarantee you want under a trading session.
4. **Session-to-wallet binding gets weaker, not stronger.** The whole reason the
   address is stored beside the token is to catch a Privy wallet switch. On
   native, the app knows the current embedded EVM address directly and can send
   it, which is a better check than inferring it from an ambient cookie.

**The change to make.** Return the Ondo session as a bearer token to the client
instead of setting a cookie, and have the routes read it from a header.
Concretely:

- `POST /api/ondo/auth/session` returns
  `{ sessionToken, expiresAt, accountID, accountState, termsVersion, privacyVersion, perpsEnabled }`.
  `sessionToken` is **our own** opaque handle, not Ondo's JWT. Keep Ondo's JWT
  server-side, keyed by the handle, so the property the current design protects
  (a 24-hour unscoped trading credential never reaching the client) is
  preserved.
- The nine routes above read `X-Ondo-Session: <handle>` and resolve it to the
  stored `{ token, address }`. `requireOndoSession` changes from reading
  `cookies()` to reading a header; `OndoSessionMissing` and the 401 behaviour
  stay identical.
- The client stores the handle in Keychain (iOS) / EncryptedSharedPreferences
  (Android), and sends the current embedded EVM address alongside so the
  address-drift check is explicit rather than inferred.
- `DELETE /api/ondo/auth/session` invalidates the handle server-side rather than
  deleting a cookie.

Server-side storage for the handle is a new dependency the app does not have
today. Supabase is already in the stack (`lib/supabase/server.ts`, service-role
client) and a two-column table with a TTL is enough. That is the honest cost of
this change, and it is small.

**If the web app must keep working unchanged during the transition,** support
both: read the header first, fall back to the cookie. The routes are the only
thing that changes; `lib/ondo/server.ts` and everything above it is untouched
because they already take the token as an argument.

### 4e. Routes a native client needs that do not exist yet

From bucket B, in the order the flows need them:

| Route | Takes | Returns |
|---|---|---|
| `GET /api/catalog` | nothing | Every registry from B1, plus a `version` and `ETag` |
| `GET /api/wallet/balances?address=` | Solana address | Per-mint atomic balances with the token program used, USD values, SOL |
| `GET /api/wallet/holdings?address=` | Solana address | Balances grouped by underlying equity, per-part values |
| `GET /api/wallet/activity?address=` | Solana address | Classified transaction history |
| `GET /api/positions?solana=&evm=` | both addresses | The flattened row shape `lib/positions/use-positions.ts` builds today, across Jupiter, Kamino, Morpho and the perps venues |
| `POST /api/solana/build/transfer` | from, to, mint, amount | `BuiltTransaction` |
| `POST /api/jupiter/earn/build` | action, mint, amount, owner | `BuiltTransaction` |
| `POST /api/jupiter/borrow/build` | vault, action, amounts, owner | `BuiltTransaction` |
| `POST /api/jupiter/multiply/build` | vault, leverage, owner | `BuiltTransaction` |
| `POST /api/kamino/kvaults/build` | vault, action, amount, owner | `BuiltTransaction` |
| `POST /api/solana/send` | signed base64, optional confirm window | signature, or a typed `SendFailureKind` |
| `POST /api/convert/plan` | source holding, destination, amount | The planner's output: source amount, guaranteed minimum, fee USD, loss, refusal reason |
| `GET /api/convert/intents?address=` | either address | In-flight Trustware intents, so a cold-started app rejoins a conversion |
| `POST /api/lighter/order-plan` | market, side, notional or holding+ratio | `baseAmount`, `wirePrice`, clamp reason. Device re-checks the two invariants before signing |
| `GET /api/lighter/exposure?address=` | EVM address | The exposure join |
| `GET /api/ondo/exposure` | session header | The Ondo exposure join |
| `GET /api/ondo/margin-sources` | session header + Solana address | What can become margin |
| `POST /api/buy/sources` | Solana address, asset, amount | Payable sources, split solana vs bridged |

`POST /api/solana/send` deserves a note: it is the single highest-value new
route in the list, because it means the two production bugs documented in
`CLAUDE.md` (the bare-signature confirm and the capped `maxRetries`) have one
implementation on the server instead of three, one of which would be written by
someone reading a native library's convenience helper.

## 5. The five riskiest unknowns, ranked

Ranked by impact multiplied by how unresolved they are. Each carries the
cheapest experiment that settles it. All five are answerable in under a week
combined, and none of them requires writing the app.

### 1. Can Lighter's signer run natively at all?

**What is unknown.** `lib/lighter/signer.ts` runs Lighter's Go signer as a
`GOOS=js GOARCH=wasm` module, which requires a JavaScript host (`wasm_exec.js`)
that neither iOS nor Android provides. The signature scheme is Schnorr over
ECgFp5 with Poseidon2, which no non-Go library implements. Whether
`elliottech/lighter-go` can be rebuilt with `gomobile bind` into an
`.xcframework` and an `.aar` is unverified.

**Why it is first.** It gates the shipped Hedge tab and the default Perps venue,
plus `lib/lighter/withdraw.ts`, which means it gates the way *out* of Lighter as
well as the way in. There is no server-side fallback: the trading key is derived
from a `personal_sign` signature, so sending that signature to a server hands
the server a 24-hour credential that can trade and withdraw. If the answer is
no, mobile v1 ships Ondo as the only perps venue, and that is a product
decision.

**Cheapest experiment, about one day.** Clone `elliottech/lighter-go` at commit
`cef81af`. Write a thin Go wrapper package exposing `CreateClient`,
`SignCreateOrder` and `CreateAuthToken` with `gomobile`-bindable signatures
(strings, ints, and a struct of strings; `gomobile` will not export arbitrary Go
types). Run `gomobile bind -target=ios` and `-target=android`. Then feed it a
fixed seed, account index, nonce and market and compare the resulting `txHash`
and `txInfo` byte-for-byte against what the existing `public/lighter/main.wasm`
produces for the same inputs in a browser. Two answers come out at once: whether
it builds, and whether it agrees.

If `gomobile` fails, the fallback experiment is a `GOOS=wasip1 GOARCH=wasm`
build run under WasmKit on iOS and Chicory on Android, with the same
known-answer comparison. Note the current module's `main` blocks forever on a
channel to stay resident, which a JS host tolerates and a wasip1 host may not.

### 2. Will Privy's native SDKs transact on Monad (143) and BNB Chain (56)?

**What is unknown.** Neither chain is in Privy's default network table, and the
only documented way to register a custom chain (`defineChain` plus
`supportedChains`) is React and React Native only. The REST endpoint types
`caip2` as a bare string with no documented allowlist, so whether the backend
will broadcast `eip155:143` from a native client is genuinely open.

**Why it is second.** Monad is the Morpho earn venue, the one place `CLAUDE.md`
knowingly lets a position settle off Solana. BNB Chain is half the
`lib/trustware/equivalents.ts` source registry. `lib/privy/provider.tsx`
declares both in `supportedChains` precisely so `execute.ts` fails loudly rather
than signing on the wrong network, and that guard has no native equivalent.

**Cheapest experiment, about half a day, and it needs no app.** Two parts, run
in either order.

First, ask Privy support directly: "can a native Swift or Android client
`eth_sendTransaction` with `caip2: eip155:143`, and if not, is there a
dashboard-level or server-side way to register a custom EVM network that applies
to native SDKs?" This is a support question with a factual answer and it costs
an email.

Second, prove the fallback works regardless of the answer. Call Privy's REST
`eth_signTransaction` for the embedded wallet with `chain_id` 143 and a
hand-built `UnsignedEthTransaction`, take the returned RLP, and broadcast it
through a Monad RPC with `eth_sendRawTransaction`. If that lands, Monad and BNB
Chain are solved by sign-then-self-broadcast whatever the first answer is, and
the remaining work is nonce and gas management, which is known and bounded.

### 3. Does Privy's native `signTransaction` accept a v0 versioned transaction?

**What is unknown.** Two things at once, and they are entangled. The Privy
research found a documented `signTransaction(transaction: Data) -> String`
returning a base64 signed transaction on both native SDKs, but the native
examples only demonstrate a legacy `Transaction` and no native doc names
`VersionedTransaction`. The Solana research separately concluded that only
`signMessage` is exposed and that the app must splice signatures itself. Those
two findings cannot both be right.

**Why it is third.** Almost every Solana write in the app starts as a v0
transaction built elsewhere: Jupiter Ultra orders, Jupiter Lend builds, Kamino
KTX responses, Trustware Solana legs. If v0 does not round-trip, every one of
them needs manual message extraction and signature splicing on both platforms,
which puts a mature Solana library back on the critical path and revives the
Swift maintenance problem from section 2.

**Cheapest experiment, about half a day.** Fetch a real Jupiter Ultra order for
a small USDC to xStock swap through the existing `/api/jupiter/order` route,
which already returns a base64 v0 transaction. In a throwaway Swift app and a
throwaway Kotlin app, base64-decode it, call `signTransaction`, and check two
things: that the call returns rather than throwing, and that the returned blob
deserializes with a valid signature at the fee payer's index. Do not broadcast.
The same run answers the `signMessage` versus `signTransaction` conflict.

### 4. Does the Lighter trading key reproduce across Privy's web and native SDKs?

**What is unknown.** `lib/lighter/keys.ts` derives the trading key from a
`personal_sign` signature over a byte-exact message, relying on ECDSA
determinism under RFC 6979. Whether Privy's Swift and Kotlin SDKs produce the
same signature the React SDK produces, for the same wallet and the same message,
is untested.

**Why it is fourth rather than higher.** The failure is visible rather than
silent: `registeredKeyMatches` compares the derived key against what the account
actually has registered, so a mismatch re-registers rather than signing orders
the sequencer rejects. But the user experience of that is bad and confusing.
A user who onboarded on web would sign a `ChangePubKey` on first mobile use, and
then their web session would be the one with the stale key, and the two clients
would fight over the same slot forever.

**Cheapest experiment, about two hours, and it is a prerequisite for
experiment 1.** Take one test Privy account. Produce
`keyDerivationMessage(address)` in the browser, `personal_sign` it, record the
65-byte signature. Do the same from Swift and from Kotlin with the same account.
Compare the three signatures as bytes. They must be identical. While there,
verify that both native SDKs hex-encode the message the same way `toHex` does,
because a different encoding of the same text is a different signature.

If they differ, the fix is not obvious and is worth knowing early: it would mean
either pinning the derivation to one platform's signature (impossible across
clients) or moving to a stored key, which the module's opening comment explains
was rejected on purpose.

### 5. Do the one-click flows survive the mobile app lifecycle?

**What is unknown.** Two things that only bite on a phone.

First, `lib/privy/provider.tsx` sets `showWalletUIs: false` so a funded Morpho
deposit, which signs several transactions, reads as one action. That field is
React provider config with no native counterpart, and whether the native SDKs
present a confirmation sheet per signature is unverified.

Second, the long flows assume a foreground tab.
`trackTrustwareSettlement` polls for up to 15 minutes,
`lib/lighter/one-click.ts` runs five steps across two wallets, and a Lighter
deposit takes 15 to 20 minutes to credit. iOS and Android will suspend an app
mid-flow, and the current code has no resume path because the browser never
needed one.

**Why it is fifth.** Neither is likely to be a hard blocker, and both have known
fixes. They are here because they change the shape of the product rather than
just the code, and because discovering them late means rewriting the flows
rather than designing for them.

**Cheapest experiment, about a day.** For the modal question, the throwaway app
from experiment 3 already answers it: call `signTransaction` twice in a row and
watch whether anything appears. For the lifecycle question, do not experiment,
design. Add `GET /api/convert/intents?address=` from section 4e and make every
multi-step flow resumable from server state keyed on `intentId`. The
orchestrators are already written as state machines derived from reads rather
than from stored progress; `lib/lighter/onboarding.ts` says so explicitly and
explains that the reason is a deposit taking 15 to 20 minutes during which the
user will reload and come back. That design choice was made for the web and it
is exactly what makes the mobile lifecycle survivable. Preserve it.

### Sequencing

Run 4 first (two hours, and it gates 1), then 3 and 2 in parallel (half a day
each, no dependency between them), then 1 (one day). Total is under a week, and
at the end of it every architectural question in this document has an answer.

Do not start the B refactor before experiment 3 returns. The size of the
server-side move depends on how much Solana work the client turns out to need,
and the answer to 3 changes it.

---

## Appendix: per-file bucket assignment (all 152 files)

Authoritative. Where a file's classification is argued at length above, the note
here is a pointer rather than the argument.

| File | Bucket | Why |
|---|---|---|
| `lib/borrow/availability.ts` | B | Registry lookup over two hardcoded venue tables. Serve from /api/catalog. |
| `lib/borrow/fund-repay.ts` | C | Sequences a Solana swap, a Monad bridge and a balance wait around signatures. |
| `lib/borrow/route.ts` | B | Normalises Jupiter tenths-of-a-percent against Kamino fractions. Pure, and a unit mismatch produces a plausible wrong number. |
| `lib/borrow/use-borrow-summary.ts` | B | Reads Jupiter and Kamino positions on chain with web3.js. Becomes /api/positions. |
| `lib/borrow/use-market-stats.ts` | A | Fetch plus interval over two existing routes. |
| `lib/borrow/use-vault-collateral.ts` | B | On-chain Anchor read of posted vault collateral. Becomes /api/positions. |
| `lib/jupiter/borrow.ts` | B | Anchor discriminator scan, PDA derivation, getProgramAccounts, buildOperateTx. Plus a localStorage NFT id that should become a server read. |
| `lib/jupiter/charts.ts` | A | Server module behind /api/jupiter/chart; reads COINGECKO_API_KEY. |
| `lib/jupiter/constants.ts` | B | Mints and thresholds. Serve from /api/catalog rather than duplicate in two binaries. |
| `lib/jupiter/convert.ts` | A | Quote and build already go through our routes; only the signature is on device. |
| `lib/jupiter/earn.ts` | B | Builds deposit/withdraw with @jup-ag/lend, wSOL sync, idempotent ATA creation, priority fee. |
| `lib/jupiter/multiply.ts` | B | Composes flashloan, swap and vault operate into one transaction with address lookup tables. |
| `lib/jupiter/pay-assets.ts` | B | Pure selection of payable sources, split solana vs bridged. |
| `lib/jupiter/pay-bridge.ts` | C | Signs and broadcasts the source leg of a bridged buy, with a pre-signature gas check. |
| `lib/jupiter/prices.ts` | A | Fetch wrapper over /api/jupiter/prices. |
| `lib/jupiter/swap-pairs.ts` | A | Server-side pair allowlist. Never ships to a client. |
| `lib/jupiter/trigger-server.ts` | A | Reads JUPITER_API_KEY. Server-only by convention. |
| `lib/jupiter/trigger.ts` | A | Fetch wrappers over app/api/jupiter/trigger/*. |
| `lib/jupiter/ultra.ts` | A | Calls /api/jupiter/order and returns a base64 transaction to sign. |
| `lib/jupiter/use-prices.ts` | A | Poll loop over an existing route. |
| `lib/jupiter/use-trigger-auth.ts` | C | Runs challenge, signMessage and verify, and caches the JWT in memory only. |
| `lib/jupiter/xstocks.ts` | B | Curated catalog with per-entry decimals and tokenProgram. Must be server-served, not baked into a binary. |
| `lib/kamino/borrow.ts` | A | Calls /api/kamino/ktx, which returns a compiled base64 transaction. |
| `lib/kamino/kvaults.ts` | B | composeKvaultTx assembles KTX instructions client-side with web3.js. |
| `lib/kamino/positions.ts` | A | Fetch plus mapping over /api/kamino/obligations. |
| `lib/kamino/reserves.ts` | B | Market, reserve and borrow-asset registry. |
| `lib/lighter/borrow-bridge.ts` | C | Prepare-then-finish Trustware leg around a Solana signature. |
| `lib/lighter/borrow-funding.ts` | B | Pure route planning with a latency figure per road. |
| `lib/lighter/borrow-hedge.ts` | B | Pure sizing for a self-funded hedge; borrowRatio times leverage equals one. |
| `lib/lighter/bridge-home.ts` | C | Signs an Ethereum route home plus a gas top-up leg. |
| `lib/lighter/candles.ts` | A | Pure parse and window helpers, already used server-side. |
| `lib/lighter/client.ts` | A | Fetch wrappers plus a 4s cache and in-flight coalescing that must be reproduced. |
| `lib/lighter/constants.ts` | B | Chain id, tx type tags, asset ids, minimums, API key index. |
| `lib/lighter/deposit.ts` | C | Transfers USDC to a bare SPL token account; ATA derivation would send it nowhere. |
| `lib/lighter/exposure.ts` | B | Pure join of holdings, prices, positions and the route table. |
| `lib/lighter/funding.ts` | B | Pure function over balances the caller already has. |
| `lib/lighter/hedge.ts` | B | xStock to market route table. |
| `lib/lighter/keys.ts` | C | Derives the trading key from a byte-exact personal_sign message. Depends on ECDSA determinism. |
| `lib/lighter/markets.ts` | A | Catalog normalisation, already behind /api/lighter/markets. |
| `lib/lighter/onboarding.ts` | C | Sequences key derivation and ChangePubKey registration against live account state. |
| `lib/lighter/one-click.ts` | C | Five-step orchestrator across two wallets, with per-step failure handling. |
| `lib/lighter/order.ts` | C | Signs the hedge market order; reads the nonce fresh and forces reduceOnly on close. |
| `lib/lighter/risk.ts` | B | Display math in ordinary numbers, deliberately not BigInt. |
| `lib/lighter/server.ts` | A | Server-side Lighter client behind app/api/lighter/*. |
| `lib/lighter/signer.ts` | C | Schnorr over ECgFp5 with Poseidon2, run as a GOOS=js Go WASM module. See C1. |
| `lib/lighter/sizing.ts` | B | Per-market wire integer scaling and the two exchange minimums. Server plan, device re-check. |
| `lib/lighter/trade.ts` | C | Signs the perps market order, with direction-dependent slippage bound. |
| `lib/lighter/types.ts` | C | Wire shapes with deliberate string-versus-number distinctions. Model structs, twice. |
| `lib/lighter/use-candles.ts` | A | Fetch plus a last-good cache. |
| `lib/lighter/use-hedge.ts` | A | Two fetches over existing routes. |
| `lib/lighter/use-lighter-balance.ts` | A | Poll over /api/lighter/account. |
| `lib/lighter/use-lighter-perps.ts` | A | Two fetches over existing routes. |
| `lib/lighter/use-lighter-withdraw.ts` | C | Three-phase state machine around a trading-key signature and a bridge. |
| `lib/lighter/use-margin-funding.ts` | C | Resolves the Privy Solana wallet and signs the transfer. |
| `lib/lighter/use-one-click-hedge.ts` | C | Resolves both Privy wallets and drives the orchestrator. |
| `lib/lighter/withdraw.ts` | C | Signs a withdraw transaction with the trading key. Depends on the WASM signer. |
| `lib/loops-client.ts` | A | Fetch over /api/loops; the localStorage half is a first-paint hint mobile can drop. |
| `lib/loops.ts` | A | server-only Supabase store keyed on a verified Privy DID. |
| `lib/morpho/client.ts` | A | Fetch over /api/morpho/metrics and /position. |
| `lib/morpho/constants.ts` | B | Monad chain id, USDC and native token constants. |
| `lib/morpho/deposit.ts` | C | ERC-4626 deposit and withdraw signed through the embedded EVM wallet. |
| `lib/morpho/fund.ts` | C | 832 lines sequencing a Trustware conversion plus a one-time native MON gas top-up. |
| `lib/morpho/gold-abi.ts` | C | Calldata encodings the device needs for the write path. |
| `lib/morpho/gold-borrow.ts` | C | Morpho Blue writes carrying the MarketParams struct, USDT approve reset, shares-sized full repay. |
| `lib/morpho/gold-client.ts` | A | Fetch over /api/morpho/gold-market and /gold-position. |
| `lib/morpho/gold-fund.ts` | C | 951 lines. The conversion is a sale bounded on value loss at the market oracle, plus an ETH gas buy. |
| `lib/morpho/gold-market.ts` | B | Immutable market params, oracle scale and WAD. Wrong bytes address a market that does not exist. |
| `lib/morpho/gold-math.ts` | A | Already server-only in practice; components import one constant. Do not port. See the note in Bucket A. |
| `lib/morpho/gold-server.ts` | A | server-only batched eth_call with block-timestamp accrual. |
| `lib/morpho/gold-sources.ts` | B | Pinned gold-only funding registry. |
| `lib/morpho/use-monad-balances.ts` | A | Fetch over /api/morpho/position. |
| `lib/morpho/vaults.ts` | B | Curated Monad Vaults V2 allowlist, distinct from same-named V1 twins. |
| `lib/ondo/auth.ts` | C | SIWE sign-in and payout-address registration, both personal_sign. |
| `lib/ondo/builder.ts` | A | Builder code block, consumed only by app/api/ondo/orders. Keep it off the client. |
| `lib/ondo/client.ts` | A | Fetch wrappers over app/api/ondo/*. |
| `lib/ondo/collateral.ts` | B | Discovers the credited set from live tokenConfig, plus haircut and cap registry. |
| `lib/ondo/constants.ts` | B | Env selection, haircut, LTV thresholds, cookie name and TTL. |
| `lib/ondo/errors.ts` | A | Failure classification already returned in the JSON body. |
| `lib/ondo/exposure.ts` | B | Pure join with runtime route resolution. |
| `lib/ondo/fund.ts` | C | Points the bridge at Ondo's deposit address so the user signs once on Solana. |
| `lib/ondo/hedge.ts` | B | Two markets per row, resolved against the live catalog because disabled flags are state. |
| `lib/ondo/margin-sources.ts` | B | Pure map from what the user holds to what Ondo credits. |
| `lib/ondo/markets.ts` | A | Two-endpoint catalog merge, already behind /api/ondo/markets. |
| `lib/ondo/one-click.ts` | C | Four-step orchestrator with asymmetric reversibility between steps. |
| `lib/ondo/orders.ts` | A | Order construction already runs in app/api/ondo/orders/route.ts. |
| `lib/ondo/preview.ts` | A | Already called from the orders route. |
| `lib/ondo/risk.ts` | A | Already called from the account and withdraw routes; the component import should move into the payload. |
| `lib/ondo/server.ts` | A | Server-side Ondo client behind app/api/ondo/*. |
| `lib/ondo/session.ts` | B | httpOnly cookie. Must become a header-borne handle. See section 4d. |
| `lib/ondo/sizing.ts` | A | Already computed server-side; the route refuses a caller-supplied size. |
| `lib/ondo/types.ts` | C | Enveloped wire shapes with string numerics. Model structs, twice. |
| `lib/ondo/unwind.ts` | C | Two Ethereum signatures to bring a token home to Solana. |
| `lib/ondo/use-ondo-collateral.ts` | A | Fetch over the unauthenticated markets route. |
| `lib/ondo/use-ondo-hedge.ts` | A | Two fetches; a 401 is an ordinary not-signed-in state. |
| `lib/ondo/use-ondo-margin.ts` | C | Drives the funding orchestrator with the Privy Solana wallet. |
| `lib/ondo/use-ondo-unwind.ts` | C | Reads balanceOf directly off each collateral contract, then signs. |
| `lib/ondo/use-ondo-withdraw.ts` | C | Registers a payout address with a signature, then withdraws. |
| `lib/ondo/use-perps.ts` | A | Three fetches over existing routes. |
| `lib/ondo/withdraw.ts` | A | Ledger reconstruction and haircut math, already run by the withdraw route. |
| `lib/positions/use-positions.ts` | B | 810 lines of display math flattening four venues. Becomes /api/positions. |
| `lib/privy/auth.ts` | A | server-only bearer verification against Privy JWKS. Works from native unchanged. |
| `lib/privy/evm.ts` | C | Pins the embedded wallet on walletClientType and holds the chain-switch ref discipline. |
| `lib/privy/provider.tsx` | C | SDK configuration: dual createOnLogin, supportedChains, showWalletUIs false. |
| `lib/privy/sign-message.ts` | C | personal_sign equivalent on Solana, base58-encoded for Jupiter Trigger. |
| `lib/privy/sign.ts` | C | Signs a base64 transaction, and the sign-broadcast-confirm variant. |
| `lib/privy/solana.ts` | C | Resolves the embedded Solana wallet off linkedAccounts because the signer object carries no walletClientType. |
| `lib/rysk/catalog.ts` | D | Rysk has no trading path and is not in Built Since v1. |
| `lib/rysk/client.ts` | D | As above. |
| `lib/rysk/constants.ts` | D | As above. |
| `lib/rysk/server.ts` | D | As above. |
| `lib/rysk/strategy.ts` | D | As above. |
| `lib/rysk/types.ts` | D | As above. |
| `lib/rysk/use-chain.ts` | D | As above. |
| `lib/solana/activity.ts` | B | Parses and classifies transaction history from the RPC. |
| `lib/solana/await-balance.ts` | B | Polls an ATA until a target lands, never throwing on timeout. |
| `lib/solana/balances.ts` | B | getTokenAccountsByOwner plus ATA derivation across two token programs. |
| `lib/solana/equivalent-tokens.ts` | B | Display-only registry derived from the conversion registry. |
| `lib/solana/holdings.ts` | B | Pure grouping of two mints of the same equity, keeping each part's own price. |
| `lib/solana/priority-fee.ts` | B | Only runs while assembling a transaction, so it follows the build routes to the server. |
| `lib/solana/send-confirm.ts` | B | Takes signed bytes, not keys, so it can move. It encodes two production bug fixes worth having once. See C4. |
| `lib/solana/send.ts` | B | Builds transferChecked with idempotent ATA creation. |
| `lib/supabase/server.ts` | A | server-only service-role client. |
| `lib/tokens/logos.ts` | D | Folds into /api/catalog as URL fields. |
| `lib/tokens/market-logos.ts` | D | Folds into /api/catalog as URL fields. |
| `lib/trustware/amounts.ts` | B | BigInt decimal-string fixed point. Clients see formatted strings only. |
| `lib/trustware/balances.ts` | B | Narrows a 129-chain scan to the registry, matched on contract address not symbol. |
| `lib/trustware/base.ts` | B | Request builders for Base USDC in both directions. |
| `lib/trustware/client.ts` | A | Browser half of the proxies. Becomes the HTTP client. |
| `lib/trustware/constants.ts` | B | API roots and the Solana chain alias. |
| `lib/trustware/equivalents.ts` | B | Equivalence registry, deliberately narrow. Leveraged and synthetic products are excluded. |
| `lib/trustware/evm-tx.ts` | C | Builds eth_sendTransaction params. Hex-or-decimal quantities, and 1559 wins over legacy. |
| `lib/trustware/execute.ts` | C | Chain switch with read-back, allowance grant, broadcast, receipt, settlement tracking. See C3. |
| `lib/trustware/gold-holdings.ts` | B | Selector over the same scan. |
| `lib/trustware/native.ts` | B | Native gas balances on the three signable EVM chains. |
| `lib/trustware/ondo-holdings.ts` | B | Selector for withdrawn collateral the equivalents registry cannot represent. |
| `lib/trustware/planner.ts` | B | Read-only conversion planning and pricing. Signs nothing. |
| `lib/trustware/selection.ts` | B | Dust thresholds, rescale and grouping, kept out of the panel on purpose. |
| `lib/trustware/server.ts` | A | server-only, holds TRUSTWARE_API_KEY and the destination allowlist. |
| `lib/trustware/stables.ts` | B | Per-chain USDC with per-chain decimals; BNB-peg is 18, not 6. |
| `lib/trustware/swap-quote.ts` | B | Two pricing engines chosen by pair. |
| `lib/trustware/swap-tokens.ts` | B | Curated swap registry verified against live quotes, not against a listing. |
| `lib/trustware/types.ts` | C | toQuantity and the response extractors are needed on device by evm-tx. |
| `lib/trustware/unified.ts` | B | Multi-leg sequencing on guaranteed minimums, never optimistic estimates. |
| `lib/trustware/use-conversion.ts` | C | Binds the engine to the two Privy wallets. |
| `lib/trustware/use-equivalents.ts` | A | Fetch over /api/trustware/balances. |
| `lib/trustware/use-max.ts` | A | Prices every source at full balance through the quote proxy. |
| `lib/trustware/use-preview.ts` | A | Debounced pricing. Signs nothing. |
| `lib/trustware/use-wallet-scan.ts` | A | One shared scan over /api/trustware/balances. |
| `lib/ui/surface.ts` | D | A Tailwind class string. |
| `lib/users.ts` | A | server-only Supabase user model. |
| `lib/utils.ts` | D | clsx plus tailwind-merge. |
| `lib/waitlist.ts` | D | Email validation for the web signup form. |

Totals: A 48, B 53, C 39, D 12.
