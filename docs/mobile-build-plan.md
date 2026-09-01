# Mobile build plan

The work queue for the native iOS and Android clients. This file is the loop's
memory. Each iteration reads it, does the first unchecked slice, checks it off,
and appends what it learned. Do not reorder slices without reading the reasoning
in `docs/mobile-port-audit.md`.

## Standing constraints

Read these before every slice. They are facts about the machine and the stack,
not preferences.

- **No local Xcode, and none is possible.** The host runs macOS 12.3 (Darwin
  21.4.0) with 7.7 GB free. Modern Xcode needs macOS 14+ and about 50 GB.
  Monterey caps at Xcode 13.4.1 (iOS 15.5 SDK); Privy's iOS SDK requires
  iOS 17+. iOS compilation happens in CI, never locally.
- **`swiftc` 5.6.1 exists locally** via Command Line Tools, with the macOS SDK.
  Use it to typecheck framework-independent Swift for free before spending a
  cloud build. It cannot build the app: Privy needs swift-tools 6.0.
- **Android builds in CI too.** No local Android SDK, no JDK.
- **Cloud builds cost money. Local checks do not.** Never push to CI on a slice
  that has not passed every local check available to it.
- **The per-slice gate is `npx tsc --noEmit`, not `pnpm build`.** Measured
  2026-08-30 on the host (M1 Pro, 8 cores): 6 seconds at 115% CPU, so about one
  core of eight. A full `next build` is multi-core and runs for minutes; it is
  thermally significant on a laptop running unattended overnight and it catches
  little that the typecheck plus eslint miss. Run `pnpm build` once at a phase
  boundary, not once per slice.
- Architecture is two true-native codebases sharing only `app/api`. This was
  chosen deliberately over Expo. Do not relitigate it.
- CLAUDE.md governs. Its writing-style rules apply to all user-facing copy, and
  its Solana broadcast rules (never a bare-signature confirm, never a capped
  `maxRetries`) are load-bearing production bug fixes.

## Tab map

Nine web sections in `app/app/page.tsx:1231` collapse to five mobile tabs.
Absorbed sections become pushed screens, not deletions.

| Tab | Absorbs | Pushed screens |
|---|---|---|
| Portfolio | portfolio, positions, activity, withdraw | Position detail, activity log, withdraw sheet |
| Markets | markets | Asset detail, buy ticket, limit order |
| Earn | earn | Venue detail, deposit, withdraw |
| Borrow | borrow | Market detail, borrow ticket, repay, gold borrow |
| Trade | perps, hedge | Venue toggle, market picker, ticket, positions |

Build order is risk-ordered, not left to right. Portfolio proves Privy with no
signing. Markets proves sign-and-send. Trade is last because it needs the
Lighter signer, which may not be portable at all.

## Phase 0 — Backend and proving ground

No Swift or Kotlin. All of this is TypeScript in the existing repo, verifiable
locally today with `pnpm build`. Getting it wrong means writing the same mistake
twice in two languages.

- [ ] **0.1 Spike: does Privy iOS `signTransaction` accept a v0 transaction?**
      Two research passes disagreed on whether the Swift API is `signTransaction`
      or only `signMessage`. The REST contract takes opaque base64, so it likely
      works. Jupiter Ultra returns v0, so if this fails the Markets tab has no
      write path. Cheapest possible experiment; do it first.
- [ ] **0.2 Spike: does Privy `signAndSendTransaction` honor priority fees and
      retries?** Privy's docs say `cluster`, `rpcUrl` and `sendOptions` apply
      only in on-device execution mode. Under TEE execution Privy broadcasts
      through its own path, which would silently discard both production bug
      fixes CLAUDE.md documents. If so, the answer is `signTransaction` plus
      slice 0.3.
- [ ] **0.3 `POST /api/solana/send`.** Moves `lib/solana/send-confirm.ts` and
      `priority-fee.ts` server-side. Takes signed bytes, never keys. Keeps both
      broadcast bug fixes in one implementation instead of three. Bucket B.
- [ ] **0.4 Pregenerate both wallets in `/api/auth/sync`.** Native has no
      `createOnLogin`. Server-side pregeneration of the Solana and EVM embedded
      wallets replaces it, and is better than two client calls.
- [ ] **0.5 Ondo SIWE session, header-borne.** The httpOnly cookie is the only
      auth shape that breaks on native, across 9 routes. Replace with an opaque
      handle in a header, keeping Ondo's JWT server-side.
- [ ] **0.6 Bucket B route buildout.** The remaining 53 Bucket B files. See the
      audit's per-file appendix for the route each one implies.
- [ ] **0.7 CI: Android workflow.** `ubuntu-latest`, SDK preinstalled, 1x
      billing, 2000 free minutes a month. Effectively free.
- [ ] **0.8 CI: iOS workflow on Xcode Cloud.** Decided 2026-08-30: the Apple
      Developer Program membership is active, so 25 compute hours a month are
      included and the marginal cost of an iOS build is zero. Do not build iOS
      on GitHub `macos-latest` (10x billing multiplier) unless Xcode Cloud hours
      are exhausted in a given month.

      Settled, do not revisit: iOS cannot be built on Linux, because Apple's
      licence permits macOS only on Apple hardware. Orgo.ai, GCP and Azure all
      offer no macOS and are dead ends regardless of budget. AWS EC2 Mac works
      but bills a 24-hour minimum per dedicated-host allocation, which is the
      wrong shape for CI. The only viable targets are Xcode Cloud, GitHub's
      macOS runners, and physical or colocated Apple hardware.

## Phase 1 — Portfolio

- [ ] 1.1 Xcode project skeleton, Privy SPM dependency, builds green in CI
- [ ] 1.2 Gradle project skeleton, `io.privy:privy-core`, builds green in CI
- [ ] 1.3 Login: Privy email and Google, both platforms
- [ ] 1.4 Waitlist gate, mirroring `Gate` and `WaitlistPending`
- [ ] 1.5 Balance reads. Needs ATA derivation, which needs an on-curve check.
      Note `XStock.tokenProgram` varies per entry: Token-2022 vs classic SPL.
      Deriving against the wrong program yields a nonexistent account, so the
      balance reads zero instead of erroring.
- [ ] 1.6 Portfolio root screen
- [ ] 1.7 Positions, activity, withdraw as pushed screens

## Phase 2 — Markets

- [ ] 2.1 Market list and search
- [ ] 2.2 Price chart and sparklines
- [ ] 2.3 Asset detail
- [ ] 2.4 Buy ticket. Jupiter Ultra returns a base64 v0 transaction, so this is
      `Data(base64Encoded:)` to Privy to `/execute`, with no Solana library in
      the path at all.
- [ ] 2.5 Limit orders via the Trigger API

## Phase 3 — Earn
## Phase 4 — Borrow
## Phase 5 — Trade

Trade is gated on the Lighter signer. `lib/lighter/signer.ts` runs Lighter's Go
signer (Schnorr over ECgFp5, Poseidon2) as a `GOOS=js GOARCH=wasm` module that
requires a JavaScript host. A native WASM runtime cannot execute it. The path is
rebuilding `lighter-go` with `gomobile`. It cannot move server-side: the trading
key derives from a `personal_sign` signature, so the server would hold a
24-hour credential that can trade and withdraw.

- [ ] 5.0 Spike: `gomobile bind` on `lighter-go`. If this fails, Lighter does
      not ship on mobile, which removes the default Perps venue and the Hedge
      tab. Ondo becomes the only venue. Decide then whether Trade ships at all.

## Log

Append one entry per slice: what was done, what broke, what the next iteration
should know. Newest last.
