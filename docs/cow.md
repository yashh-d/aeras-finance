# CoW Protocol

CoW Protocol is an intent-based trading protocol. A user signs an order as an off-chain
message, the protocol batches it with other orders, and bonded third parties called solvers
compete for the right to settle the batch. CoW Swap is the front end CoW DAO runs on top of
it. Nothing is integrated yet. This file exists so that a session evaluating CoW starts from
what is true rather than from the marketing.

Unlike the other files in `docs/`, nothing here is live-verified. It was read from
docs.cow.fi, the contract deployment table, and the mechanism paper on 2026-08-30. Every
claim about whether a specific route quotes is marked as unverified, because the difference
between "the protocol supports this pair" and "a solver will fill it" is exactly the
difference that sank the direct gold route in `lib/morpho/gold-fund.ts`.

## CoW is not on Solana, and never will be for our purposes

This is the first thing to settle, because it disqualifies the obvious reading.

`GPv2Settlement`, `GPv2VaultRelayer` and `GPv2AllowListAuthentication` are deployed at
deterministic CREATE2 addresses on Arbitrum One, Avalanche, Base, BNB, Ethereum, Gnosis,
Ink, Linea, Optimism, Plasma, Polygon and Sepolia. That list is the protocol. There is no
Solana deployment and no Solana roadmap in the docs.

So CoW is **not** a Jupiter replacement, not a candidate for the buy flow, and not a venue
for anything that becomes a position. Every position in this app settles on Solana, with
the two Morpho exceptions in CLAUDE.md, and neither of those is a chain CoW would help with:
Monad is not on the list at all, and the Ethereum gold market is a lending market, not a
swap.

What is left is narrow and real: CoW could serve the **EVM-side swap legs** the app already
performs through Trustware. That is it. Read the next section before assuming any of them
actually work.

## Where it could fit, and where it cannot

Three EVM swap legs exist in the app today, all currently routed through Trustware.

**The gold borrow exit, Ethereum USDT to USDC.** Trustware does this at about 0.3%
(CLAUDE.md, Chain Assumptions). USDT/USDC on Ethereum is the deepest pair in DeFi, so CoW
should price it at least as well, and the batch may find a coincidence of wants that skips
AMM fees entirely. This is the strongest candidate. Unverified.

**Ondo margin and withdrawal legs on Ethereum.** `lib/ondo/fund.ts` delivers a collateral
token to Ondo's deposit address, and `lib/ondo/withdraw.ts` lands assets back on Ethereum.
Where either leg needs an Ethereum-side swap, CoW is a candidate. Note that Ondo's own
constraint is unchanged by this: deposits are Ethereum-only either way.

**Gold funding, and this one is a trap.** It is tempting to read CoW as the fix for the
upstream defect recorded in `lib/morpho/gold-fund.ts`, where Trustware cannot route Solana
gold directly to XAUt. It is not. That file also records, from live measurement on
2026-08-26, that GLDx and GLDon on Ethereum and BNB return 502 in every direction, which
reads as no DEX liquidity for those wrappers off Solana. CoW routes on-chain liquidity plus
private market maker inventory. It cannot conjure liquidity that does not exist. If those
wrappers have no Ethereum market, CoW will quote nothing, the same as Trustware. Check
before believing otherwise.

The general shape of the mistake: CoW improves *execution* on pairs that have liquidity. It
does not create liquidity, and it does not bridge. Anywhere the current problem is "this
token has no market on this chain", CoW changes nothing.

## Cross-chain is a front-end feature, not a protocol one

swap.cow.fi offers cross-chain swaps through a bridge provider. Two limits matter. The
destination token list is whatever the bridge provider supports, not CoW's token lists. And
bridging the same token across chains is explicitly not supported yet, so USDC to USDC is
out, which is most of what Trustware does for us. Treat cross-chain CoW as unrelated to the
Trustware layer rather than as competition for it.

## The mechanism

Worth understanding because it explains the guarantees, and because the fairness rule is
genuinely novel rather than a rebrand of aggregation.

A user signs an intent, which specifies what they will accept, not how to execute it.
Intents are collected off-chain into a batch. Solvers bid, and the auction is combinatorial:
a solver bids on individual orders and on groups of orders, because executing several orders
together creates efficiencies that individual execution cannot.

The fairness filter is the part with a paper behind it. A batched bid is discarded if any
order inside it would receive less than the best available bid on that order alone.
Surviving bids are combined to maximise total surplus. The docs state that the protocol
"uses an implementation of the 'Fair Combinatorial Auction'" and link
[arXiv:2408.12225](https://arxiv.org/abs/2408.12225), by Andrea Canidio and Felix Henneke,
both CoW DAO. It was ratified on-chain as CIP-67. CoW has never published a whitepaper;
this paper is the closest thing and should be read as one.

Two consequences we would inherit:

- **Uniform directional clearing prices.** Every user trading the same pair in the same
  direction in a batch faces the same price. Transaction ordering inside the block is
  therefore worthless, which is the actual mechanism behind the MEV protection claim rather
  than a private mempool.
- **Settlement at Ethereum Best Bid Offer or better**, enforced as a competition rule with
  slashing behind it.

## Integration mechanics that would bite us

**Approvals go to the vault relayer, not the settlement contract.**
`GPv2VaultRelayer` is `0xC92E8bdf79f0507f65a392b0ab4667716BFE0110` on every listed chain.
Approving `GPv2Settlement` instead produces an order that can never be filled.

**The EIP-712 domain separator is still named "Gnosis Protocol".** The struct is
`{ name: "Gnosis Protocol", version: "v2", chainId, verifyingContract:
"0x9008D19f58AAbD9eD0D60971565AA8510560ab41" }`. CoW Protocol was formerly Gnosis Protocol
v2 and renaming would have required redeploying the settlement contract, so the old name
stayed. Writing "CoW Protocol" there yields a signature that verifies to nothing, with no
useful error.

**Signing runs through the embedded EVM wallet.** It is an EOA, so the plain EIP-712 scheme
applies: `eth_signTypedData_v4` on the EIP-1193 provider from
`useEmbeddedEvmWallet()`. Every rule in CLAUDE.md about EVM chain switching applies without
change. Switch at the wallet level, request a fresh provider afterwards, read back
`eth_chainId` before signing, and never capture a Privy wallet object across a switch.

**Gasless does not mean no ETH.** Settlement fees are paid in the user's sell token, which
is genuinely useful here because the embedded EVM wallet is born with no gas and
`lib/morpho/gold-fund.ts` currently has to buy ETH to work around that. But the ERC-20
approval to the vault relayer is an ordinary transaction and costs ordinary gas. CoW removes
the gas requirement for the swap, not for the first approval. Do not let a UI imply
otherwise.

**Orders are asynchronous and off-chain.** There is no transaction to broadcast and no
signature to confirm. The order goes to the order book API and settles whenever a solver
wins a batch containing it. This does not fit the `sendAndConfirm` shape in
`lib/solana/send-confirm.ts` at all, and it does not fit `executeEvmRoute` either. It needs
its own polling and its own status vocabulary. Orders carry an expiry and can be cancelled
on-chain.

**Failed and cancelled orders cost nothing.** Real difference from every path we have now.

**No API key.** The order book API is public, so the server-side-keys convention in
CLAUDE.md does not force a proxy here. A proxy may still be wanted for rate limiting.

Endpoints: `https://api.cow.fi/mainnet/api/v1/`, `/xdai/`, `/arbitrum_one/`, `/base/`, and
`/sepolia/` for testnet. Rate limits are 10 quote requests per second, 5 order submissions
per second, and 100 requests per minute on general endpoints.

## Partner fee

The direct analogue of Ondo's builder code, and it deserves the same suspicion.

An integrator sets `partnerFee` as `{ bps, recipient }`, optionally varying by chain and
trade type. It is charged against the spot price (`beforeAllFees`), not the post-fee amount:
`partnerFeeAmount = beforeAllFees × partnerFeePercent / 100`, denominated in the buy token
for sell orders and the sell token for buy orders.

The trap is the same one `docs/ondo-perps.md` documents at length: every way the field earns
nothing is silent. The docs present `partnerFee` almost entirely as a **widget** parameter.
For an API integration the equivalent is `appData`, a `bytes32` on the order that points at
an IPFS JSON document carrying `appCode` and metadata. Whether an API-submitted order honours
a partner fee declared that way, and what schema version it needs, is unverified and is the
single thing worth checking first if revenue is part of the case for integrating.

## Before writing any code

There is no `scripts/cow-check.mts`. Write one first, in the pattern of the existing check
scripts, and have it answer these against the live API rather than against this file:

1. Does `GET /quote` return a fillable quote for Ethereum USDT to USDC at the sizes users
   actually exit the gold market with, and how does the all-in cost compare to Trustware's
   0.3%?
2. Does it quote XAUt at all, in either direction?
3. Does it quote Ethereum GLDx or GLDon in any direction, or does it confirm the absence of
   liquidity that `gold-fund.ts` measured through Trustware?
4. Does an API-submitted order with `appData` carrying a partner fee actually pay it?
5. What is the realistic time from order submission to settlement for these pairs, since it
   determines whether the UI needs a pending state that survives a page reload?

Questions 1 and 3 decide whether there is a reason to do this at all.

## Scope

Not approved. CLAUDE.md lists additional venues under Out of Scope, and CoW is a venue.

The narrow exception it could live inside already exists: swapping out to an EVM chain is
allowed and is described under Chain Assumptions, and `lib/trustware/swap-tokens.ts` is the
curated registry that governs it. A CoW-backed swap leg would sit there, subject to the same
rule as everything else, which is that a position never settles off Solana.

## Sources

- Fair Combinatorial Auctions, Canidio and Henneke, [arXiv:2408.12225](https://arxiv.org/abs/2408.12225). The mechanism, ratified as CIP-67.
- [docs.cow.fi](https://docs.cow.fi), whose `llms-full.txt` is a complete single-file export.
- Ancestry, if useful: the Gnosis dFusion whitepaper and the Gnosis multi-token uniform-clearing-price paper, both in [gnosis/dex-research](https://github.com/gnosis/dex-research).
