# Asset routes

Every conversion the platform performs or is expected to perform, as a test matrix. A route is
a source token on a source chain becoming a destination token on a destination chain, delivered
to an address the app controls or to a venue's deposit address. This file lists them by
destination, records what has been measured for each, and names what still has to be checked
before a route can be offered to a user.

Compiled 2026-09-15 from the registries in `lib/trustware`, `lib/jupiter`, `lib/ondo`,
`lib/lighter` and `lib/morpho`, the docs in `docs/`, and the check scripts in `scripts/`. Where
a fact comes from an issuer rather than from this repo it is marked as such and has not been
verified here.

## Status legend

| Status | Meaning |
|---|---|
| **live** | Executed end to end against the real API, or returns a signable transaction and the module that signs it ships. Date and evidence given. |
| **quoted** | `/quote` or `/route` returned a price at the sizes listed. Not executed with funds. |
| **built** | The code path exists and the server allowlist admits the shape. Not measured against the live API. |
| **registry** | Token address recorded in a registry. No route has been quoted. |
| **blocked** | Measured unroutable. Reason given. Re-test before assuming it still holds. |
| **planned** | Nothing in the repo yet. Needs an address, a Trustware listing, an issuer fact, or all three. |

Two engine facts shape every row below, both measured and both recorded in the code:

- **Trustware cannot execute a Solana-to-Solana route.** Its `/route` picks a provider per request,
  and a `relay` selection carries no transaction to sign (`scripts/trustware-solana-route-check.mts`).
  Every Solana-to-Solana leg therefore runs through Jupiter's classic swap API in
  `lib/jupiter/convert.ts`. Jupiter Ultra refuses Ondo pairs outright ("Only USDC is available
  for swapping with Ondo tokens"), so the classic API is the only path.
- **Whether a Solana-source Trustware route is signable depends on which bridge provider wins the
  price auction for that exact size at that moment.** LI.FI returns a signable transaction; relay
  and Khalani return a price and nothing to sign. Monad destinations sign every time because relay
  does not compete there. Arbitrum and Base destinations flip within the hour
  (`lib/lighter/borrow-funding.ts`). A route that quoted is not a route that signs. Test both.

## Issuers in scope

The platform will accept tokenized stocks from six issuers. The first two have addresses in
this repo; the remaining four have none yet.

| Issuer | Token form | Chains with addresses in this repo | Chains the issuer publishes on (unverified here) | Notes |
|---|---|---|---|---|
| **xStocks** (Backed) | `TSLAx`, 8 decimals on Solana (Token-2022), 18 on EVM | Solana (18 rows), Ethereum and BNB Chain (TSLAx, SPYx, QQQx, NVDAx, GLDx; the same address on both chains), HyperEVM (held out) | Monad (launching, per product) | The canonical destination. The Solana mint is what Jupiter Lend and Kamino take. |
| **Ondo** Global Markets | `TSLAon`, 9 decimals on Solana, 18 on EVM | Solana (TSLAon, SPYon, NVDAon, GLDon, QQQon), Ethereum (TSLAon, SPYon, QQQon, NVDAon, GLDon, SLVon, CRCLon, SPCXon, SNDKon), BNB Chain (TSLAon, SPYon, QQQon, NVDAon, GLDon), HyperEVM and Arbitrum (held out) | Ondo lists many more underlyings than the nine above | The same equity as the xStock, 1:1, from a different issuer. Also the only issuer whose tokens are accepted as perps margin (Ondo Perps, Ethereum only). |
| **Dinari** dShares | `TSLA.d` style symbols, and a wrapped variant | none | Ethereum, Arbitrum, Base and others per Dinari's registry | Dinari issues a raw dShare and a wrapped dShare. Which one carries DEX liquidity, and whether the wrapped one stays 1:1 with a share across splits, has to be checked before either is treated as an equivalent. |
| **bStocks** | assumed to be Backed's EVM-native `bTSLA` / `bNVDA` line | none | Ethereum, Base, Arbitrum, Polygon, Gnosis, Avalanche per Backed | **Assumption to confirm.** `lib/trustware/equivalents.ts` currently excludes Backed bTokens by design ("not the same asset and must never be treated as convertible"). Some track a different instrument (bCSPX tracks the CSPX UCITS ETF, not SPY). Admitting them is a product decision, taken one underlying at a time, not a registry edit. |
| **Robinhood** stock tokens | Robinhood's own ERC-20s | none | Arbitrum One, with a move to Robinhood Chain announced | Reported as transfer-restricted outside Robinhood's own app at launch. If that still holds there is no route to test. Arbitrum is not in Privy's `supportedChains`, so nothing can be signed there today. |
| **Base** tokenized stocks | depends on issuer | none | Base | Which issuer this means is an open question (Dinari on Base, Backed on Base, or a Base-native issuance). Base is already declared in Privy and already scanned for USDC and ETH, so the only missing piece is registry entries. |

Chains the embedded EVM wallet can sign on today: Ethereum (1), BNB Chain (56), Monad (143),
Base (8453). Arbitrum (42161), HyperEVM (999) and Avalanche (43114) are **not** declared, so a
source token on any of those cannot be converted even if Trustware lists it. Adding a chain is a
change to `lib/privy/provider.tsx` plus the registry the chain is for (CLAUDE.md, Privy section).

## Destinations

| # | Destination | Chain | Token | What consumes it | Server allowlist shape (`lib/trustware/server.ts`) |
|---|---|---|---|---|---|
| D1 | xStock | Solana | curated mints in `lib/jupiter/xstocks.ts` | Jupiter Lend borrow vaults (TSLAx, SPYx, QQQx, NVDAx), Kamino xStocks Market (10 reserves), plain holding, Jupiter sell | `deposit` (borrow-vault four), `unwind` (any curated xStock from an Ondo Ethereum token) |
| D2 | xStock | Monad | **no addresses yet** | **no venue yet** (see Monad section) | none yet |
| D3 | USDC | Solana | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Jupiter Lend earn, Kamino kvaults, Jupiter Ultra buys, borrow repay, Lighter CCTP deposit | `return` (any source) |
| D4 | USDC | Monad | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | Morpho Vaults V2 (three curated USDC vaults) | `funding` (any source) |
| D5 | USDC | Arbitrum | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` | Lighter intent address; Ondo USDC deposit network (not built) | `lighter margin` (USDC sources only) |
| D6 | USDC | Base | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | Lighter intent address | `lighter margin` (USDC sources only) |
| D7 | USDC | Ethereum | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | Ondo margin (deposit address), Lighter L1 direct deposit contract, resting state after a Lighter withdrawal | `margin` (to Ondo address), `swap` |
| D8 | Ondo margin token | Ethereum | `ONDO_MARGIN_TOKENS` in `lib/ondo/collateral.ts` | Ondo Perps self-collateralized hedge | `margin` |
| D9 | XAUt | Ethereum | `0x68749665ff8d2d112fa859aa293f07a622782f38`, **6 decimals** | Morpho Blue XAUt/USDT market | `gold` (any source) |
| D10 | native gas | Monad (MON), Ethereum (ETH), Base (ETH) | zero address on Monad, `0xEeee…` alias on Ethereum (the two are not interchangeable) | Paying for the EVM leg of anything above | `funding` (MON), `swap` (ETH) |

## Route family 1: tokenized stock to xStock on Solana (D1)

This is the borrow-collateral path and the "move my stock here" path. The registry is
`lib/trustware/equivalents.ts`, scoped to the four underlyings with Jupiter Lend borrow vaults.
The planner is `lib/trustware/planner.ts`, the multi-source sequencer `lib/trustware/unified.ts`.

### 1a. Registered today (four underlyings)

| Source issuer | Source chain | Source token | Destination | Engine | Status | Evidence |
|---|---|---|---|---|---|---|
| Ondo | Solana | TSLAon `KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo` | TSLAx | Jupiter classic swap, one Meteora DLMM hop | **live** | 0 price impact at retail size; slippage study 2026-08-06 in `lib/trustware/constants.ts` |
| Ondo | Solana | SPYon `k18WJUULWheRkSpSquYGdNNmtuE2Vbw1hpuUi92ondo` | SPYx | Jupiter classic swap | **live** | routed on the same run as TSLAon, 2026-08-05 |
| Ondo | Solana | NVDAon `gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo` | NVDAx | Jupiter classic swap | **live** | same run |
| Ondo | Solana | QQQon `HrYNm6jTQ71LoFphjVKBTdAE4uja7WsmLG8VxB8ondo` | QQQx | Jupiter classic swap | **blocked** | held out of the registry; Trustware returned "Solana under maintenance" for this pair only, 2026-08-05. Shown as a balance, not convertible. Re-test through Jupiter directly. |
| Ondo | Ethereum | TSLAon `0xf6b1117ec07684d3958cad8beb1b302bfd21103f` | TSLAx | Trustware, EVM approve + route, needs ETH | **quoted** | `scripts/trustware-quote-spike.mjs`; execution inputs checked by `scripts/trustware-execute-check.mts` |
| Ondo | Ethereum | SPYon `0xfedc5f4a6c38211c1338aa411018dfaf26612c08` | SPYx | Trustware | **quoted** | as above |
| Ondo | Ethereum | QQQon `0x0e397938c1aa0680954093495b70a9f5e2249aba` | QQQx | Trustware | **quoted** | as above |
| Ondo | Ethereum | NVDAon `0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee` | NVDAx | Trustware | **quoted** | as above |
| xStocks | Ethereum | TSLAx `0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0` | TSLAx (Solana) | Trustware | **quoted** | as above |
| xStocks | Ethereum | SPYx `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48` | SPYx | Trustware | **quoted** | as above |
| xStocks | Ethereum | QQQx `0xa753a7395cae905cd615da0b82a53e0560f250af` | QQQx | Trustware | **quoted** | as above |
| xStocks | Ethereum | NVDAx `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` | NVDAx | Trustware | **quoted** | as above |
| Ondo | BNB Chain | TSLAon `0x2494b603319d4d9f9715c9f4496d9e0364b59d93` | TSLAx | Trustware, needs BNB | **quoted** | `scripts/trustware-unified-check.mts` uses the BSC TSLAon fixture |
| Ondo | BNB Chain | SPYon `0x6a708ead771238919d85930b5a0f10454e1c331a` | SPYx | Trustware | **registry** | |
| Ondo | BNB Chain | QQQon `0x0cde6936d305d5b34667fc46425e852efd73559a` | QQQx | Trustware | **registry** | |
| Ondo | BNB Chain | NVDAon `0xa9ee28c80f960b889dfbd1902055218cba016f75` | NVDAx | Trustware | **registry** | |
| xStocks | BNB Chain | TSLAx, SPYx, QQQx, NVDAx (same addresses as Ethereum) | matching Solana xStock | Trustware | **registry** | |
| Ondo | HyperEVM | TSLAon, SPYon, QQQon, NVDAon (addresses in the comment block of `equivalents.ts`) | matching xStock | Trustware | **blocked** | "chain support under maintenance", 2026-07-29. Also not a Privy chain. |
| xStocks | HyperEVM | TSLAx, SPYx, QQQx, NVDAx (mainnet addresses) | matching xStock | Trustware | **blocked** | same |
| Ondo | Arbitrum | TSLAon `0xb298bc2fac7aeda17fe0812323a98e6278a91557` | TSLAx | Trustware | **blocked** | held out with HyperEVM; not a Privy chain |

Two guards apply to every EVM row: the source chain must be in Privy's `supportedChains`
(`execute.ts` refuses otherwise), and the wallet must hold that chain's gas token, which the
embedded wallet is born without. The wallet panel warns that the same token on any chain not
listed reaches the address but cannot be moved.

### 1b. Catalog underlyings with no registry entry

The curated catalog carries 14 more underlyings. None has an equivalence entry, so a user
holding the Ondo or EVM version of any of them sees nothing and can convert nothing. The
registry is keyed to Jupiter Lend borrow vaults, so widening it means either adding vaults
Jupiter does not have or breaking that key (`lib/trustware/ondo-holdings.ts` and
`lib/ondo/unwind.ts` both note this and work around it).

| Underlying | Solana xStock | Ondo token seen in this repo | Kamino reserve | Ondo perps market in `lib/ondo/hedge.ts` | What to test first |
|---|---|---|---|---|---|
| AAPL | AAPLx | none recorded | yes | AAPL-USD.P | Does Ondo issue AAPLon, and on which chains |
| MSFT | MSFTx | none | no | not in the table | issuer list |
| AMZN | AMZNx | none | no | not in the table | issuer list |
| META | METAx | none | yes | META-USD.P | issuer list |
| GOOGL | GOOGLx | none | yes | GOOGL-USD.P | issuer list |
| COIN | COINx | none | no | COIN-USD.P | issuer list |
| CRCL | CRCLx | CRCLon, Ethereum `0x3632dea96a953c11dac2f00b4a05a32cd1063fae` | yes | CRCL-USD.P | CRCLon (Ethereum) to CRCLx. Accepted Ondo collateral, so it is also a margin route. |
| MSTR | MSTRx | none | yes | MSTR-USD.P | issuer list |
| SPCX | SPCXx | SPCXon, Ethereum `0xc9eef266834730340a55b6cc24621b31baf55581` | no | SPCX-USD.P | SPCXon to SPCXx is **quoted** in the unwind direction (0.136373 SPCXon delivered 0.1322 SPCXx, $18.07 of $18.83, 2026-08-26) |
| HOOD | HOODx | none | yes | not in the table | issuer list |
| PLTR | PLTRx | none | no | not in the table | issuer list |
| MCD | MCDx | none | no | not in the table | issuer list |
| AVGO | AVGOx | none | no | not in the table | issuer list |
| GLD | GLDx | GLDon on Solana `hWfiw4mcxT8rnNFkk6fsCQSxoxgZ9yVhB6tyeVcondo` (9 dp), Ethereum `0x423d42e505e64f99b6e277eb7ed324cc5606f139`, BNB `0xfa9a1e901085e269f6d428f79cd5252d8b919344` | no | XAU-USD.P (spot gold, a proxy) | **Not 1:1.** GLDon on Ethereum reads as about 0.45 oz, GLDon on Solana and GLDx as about 0.09 oz. Never treat GLDon and GLDx as equivalents; see the gold family. |

### 1c. New issuers, every underlying

For Dinari, bStocks, Robinhood and Base-native tokens the test is the same three steps per
token, and a token joins `equivalents.ts` only after step 3 returns a price:

1. Confirm the token is 1:1 with one share of the same underlying as the xStock. Wrapped
   dShares and ETF-tracking bTokens are the known ways this fails.
2. Confirm Trustware lists it: `GET /routes/tokens`, matched by contract address on the row's
   own `chainId`, never by symbol (the list has decoys, including a fake 18-decimal USDC).
3. Quote it into the Solana xStock at $25, $250 and $2,500 with
   `scripts/trustware-quote-spike.mjs` adapted to the address, and record the effective loss.

| Source issuer | Source chain | Destination | Signable today | Status |
|---|---|---|---|---|
| Dinari | Ethereum | Solana xStock | yes (chain declared) | **planned** |
| Dinari | Base | Solana xStock | yes | **planned** |
| Dinari | Arbitrum | Solana xStock | no (Arbitrum not declared) | **planned** |
| bStocks | Ethereum | Solana xStock | yes | **planned**, product decision first |
| bStocks | Base | Solana xStock | yes | **planned**, product decision first |
| bStocks | Arbitrum, Polygon, Gnosis, Avalanche | Solana xStock | no | **planned**, needs a Privy chain each |
| Robinhood | Arbitrum | Solana xStock | no | **planned**, transferability unconfirmed |
| Base-native issuance | Base | Solana xStock | yes | **planned**, issuer unknown |

## Route family 2: tokenized stock to xStock on Monad (D2)

The Monad xStock does not exist in this repo yet. What does exist, and can be reused:

- Monad (chainId 143) is in Trustware's chain list and Privy's `supportedChains`.
- Solana USDC to Monad USDC and to native MON both sign every time (`lib/morpho/fund.ts`,
  `scripts/morpho-fund-check.mts`, 2026-08-25). The gas top-up leg (0.5 USDC delivered about 17
  MON) is what a Monad xStock leg will also need, because the destination wallet is born with
  no MON.
- The return leg Monad to Solana USDC is live (`executeEvmRoute`).

What has to be true before any row below can be tested, in order:

1. Backed publishes the Monad mint addresses. Record them in a new registry, not in
   `xstocks.ts`, which is Solana-only and read by the buy flow.
2. Trustware lists each Monad mint (same `GET /routes/tokens` check as above).
3. A Monad DEX pool exists with enough depth to quote $2,500 under 1% loss. Trustware routes
   liquidity, it does not create it.
4. A Monad venue accepts the token, or the product accepts "hold on Monad" as a terminal state.
   Today Jupiter Lend and Kamino are Solana-only and the Morpho Monad vaults are USDC-only, so a
   Monad xStock has nowhere to be lent. **This is the open product question for the whole
   family.**
5. `lib/trustware/server.ts` gets a new allowlist shape: any source to a curated Monad xStock,
   delivered to an EVM address.

| Source issuer | Source chain | Source token | Destination | Engine | Status |
|---|---|---|---|---|---|
| xStocks | Solana | TSLAx, SPYx, QQQx, NVDAx (then the rest of the catalog) | same xStock on Monad | Trustware, one Solana signature, MON top-up leg alongside | **planned**. Test first: it is the bridge every other row in this family composes with. |
| xStocks | Monad | any xStock | same xStock on Solana | Trustware, EVM approve + route, MON gas | **planned**. The way back. Test second. |
| Ondo | Solana | TSLAon, SPYon, NVDAon | xStock on Monad | Jupiter swap to Solana xStock, then the Solana to Monad bridge (two legs), or a direct Trustware route if one quotes | **planned** |
| Ondo | Ethereum | TSLAon, SPYon, QQQon, NVDAon, CRCLon, SPCXon | xStock on Monad | Trustware, ETH gas | **planned** |
| Ondo | BNB Chain | TSLAon, SPYon, QQQon, NVDAon | xStock on Monad | Trustware, BNB gas | **planned** |
| xStocks | Ethereum, BNB Chain | TSLAx, SPYx, QQQx, NVDAx | xStock on Monad | Trustware | **planned** |
| Dinari, bStocks, Robinhood, Base | as in family 1c | xStock on Monad | Trustware | **planned**, after family 1c clears for the same token |
| USDC | Solana | USDC | xStock on Monad | Trustware (a buy, not a conversion) | **planned**. Only worth offering if a Monad venue exists. |

## Route family 3: USDC for Earn vaults (D3, D4)

| Source | Destination | Consumer | Engine | Status | Evidence |
|---|---|---|---|---|---|
| USDC Solana | Jupiter Lend USDC vault, Kamino RWA USDC kvault | earn | native deposit, no route | **live** | shipping |
| SOL Solana | USDC Solana | earn, repay | Jupiter swap | **live** | `lib/borrow/fund-repay.ts` |
| USDC Solana | USDC Monad | Morpho Vaults V2 | Trustware, provider lifi, about 0.3% plus $0.025 fixed | **live** | 2026-08-25, `scripts/morpho-fund-check.mts` |
| USDC Solana | MON Monad (gas) | Morpho leg | Trustware, zero-address sentinel | **live** | 2026-08-25 |
| USDC Ethereum | USDC Monad | Morpho | Trustware, `funding` shape admits any source; ETH gas | **built** | not measured |
| USDC BNB Chain | USDC Monad | Morpho | Trustware; BNB gas; **18 decimals** | **built** | not measured |
| USDC Base | USDC Monad | Morpho | Trustware; Base ETH gas | **built** | not measured |
| USDC Monad | USDC Solana | repay, wallet | Trustware, `return` shape | **live** | `sendMonadUsdcToSolana`, `lib/borrow/fund-repay.ts` |
| USDC Base | USDC Solana | wallet, buys | Trustware, about $0.30 flat, warns below $25 | **live** | 2026-08-28, `scripts/trustware-base-check.mts`, 4/4 sizes signable |
| USDC Ethereum | USDC Solana | after a Lighter withdrawal, buys | Trustware, `return` shape; approve + route, ETH gas checked live | **built** | `lib/lighter/bridge-home.ts`, `lib/jupiter/pay-bridge.ts` |
| USDC BNB Chain | USDC Solana | buys | Trustware; `pay-bridge.ts` takes any chain | **built** | not measured |
| USDC Arbitrum | USDC Solana | wallet | none | **planned** | Arbitrum is not scanned by `stables.ts` and not a Privy chain. Matters once Lighter or Ondo balances withdraw to Arbitrum. |

## Route family 4: USDC for perps margin (D5, D6, D7)

### 4a. Lighter

Lighter's account is keyed to the embedded EVM address. Deposits credit through an intent
address per chain (Solana 101, Arbitrum 42161, Base 8453, Avalanche 43114) or the Ethereum L1
contract. Ethereum is rejected by `createIntentAddress`. All figures from
`lib/lighter/margin-sources.ts` and `lib/lighter/borrow-funding.ts`.

| Source | Destination | Engine | Cost | Latency | Status | Evidence |
|---|---|---|---|---|---|---|
| USDC Solana | Lighter Solana intent token account | SPL transfer, then CCTP | 0 bps | 15 to 20 min | **live** | ships today; $5 minimum |
| USDC Solana | USDC Arbitrum at Lighter intent address | Trustware, one Solana signature | 25 bps guaranteed, flat $5 to $5,000 | about 5 min | **live** when LI.FI wins the auction | 8/8 runs signable to $5,000 on 2026-08-27, then refusing $1,000 twenty minutes later. Probe at pay time. |
| USDC Solana | USDC Base at Lighter intent address | Trustware | 25 bps | about 5 min | **quoted**, signable only to $10 to $50 | 2026-08-27 |
| USDC Solana | Lighter UDA Solana address (Fun.xyz bridge) | SPL transfer | 0 | minutes | **blocked** | needs a builder API key Lighter issues over Discord |
| USDC Ethereum | USDC Arbitrum at intent address | Trustware, approve + bridge, ETH gas | 40 bps at $20 | 5 min | **live** | `scripts/lighter-margin-sources-check.mts`, 2026-08-31 |
| USDC Base | USDC Arbitrum at intent address | Trustware, Base ETH gas | 36 bps | 5 min | **live** | same |
| USDC BNB Chain | USDC Arbitrum at intent address | Trustware, BNB gas, 18 decimals | 39 bps | 5 min | **live** | same; the first run called it unroutable because it sized at 6 decimals |
| USDC Ethereum | Lighter L1 deposit contract `0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7` | approve + `deposit`, ETH gas | gas only | L1 | **registry** | selector recorded, no module builds it |
| Lighter margin | USDC Ethereum at embedded EVM address | secure withdraw (tx type 13) | 0, $1 minimum | dynamic delay, about 24 min measured | **built** | `lib/lighter/withdraw.ts` ships; `scripts/lighter-withdraw-check.mts` proves the signed shape and the relay allowlist with a throwaway key, 2026-08-27. No funded withdrawal recorded. |
| USDC Ethereum (withdrawn) | USDC Solana | see family 3 | | | **built** | `lib/lighter/bridge-home.ts` |

Borrow-funded hedge (`lib/lighter/one-click.ts`): Jupiter Lend or Kamino borrow pays out Solana
USDC, then one of the Solana rows above. The route is chosen at plan time and its signability
probed before the borrow is signed, so a lost auction costs a slower road rather than debt
with no hedge.

### 4b. Ondo Perps

Ondo credits deposits on Ethereum for every asset, and USDC additionally on Arbitrum
(`docs/ondo-perps.md`, live token config 2026-08-25). There is no Solana deposit path in
production for anything. The destination is Ondo's provisioned deposit address, so the user
signs once on Solana and never needs ETH; the cost is that funds land where the user cannot
sign. Execution is gated by `NEXT_PUBLIC_ONDO_FUNDING_ENABLED` until one live deposit
confirms Ondo credits a bridge-delivered transfer.

| Source | Destination | Engine | Cost | Status | Evidence |
|---|---|---|---|---|---|
| USDC Solana | USDC Ethereum at Ondo deposit address | Trustware, one Solana signature | 25 bps at $20, 1 bp at $690 | **quoted**, execution gated | 2026-08-26 |
| USDC Ethereum | USDC Ethereum at Ondo deposit address | ERC-20 transfer via `executeEvmRoute`, ETH gas | gas | **built**, gated | `lib/ondo/margin-sources.ts` marks it executable |
| USDC Solana | USDC Arbitrum at Ondo deposit address | Trustware | not measured | **planned** | listed as out of scope in `docs/ondo-perps.md`; Ondo's production networks are Ethereum and Arbitrum. Same shape as the Lighter Arbitrum row, so it should price the same. Needs a new allowlist branch. |
| USDC Avalanche | Ondo | none | | **planned** | `ONDO_USDC_NETWORKS` in `margin-sources.ts` includes 43114 but the live production list does not. Reconcile before building. |
| SPYx Solana | SPYon Ethereum at Ondo deposit address | Trustware | 99% delivered at retail size | **quoted**, gated | 2026-08-25 |
| QQQx Solana | QQQon Ethereum at Ondo deposit address | Trustware | not separately measured | **quoted**, gated | same route shape |
| SPCXx Solana | SPCXon Ethereum at Ondo deposit address | Trustware | 431 bps at $20, 137 at $138, 46 at $690, 54 at $2,759 | **quoted**, soft-refused under 150 bps bound | 2026-08-26; SPCXon is undocumented collateral (haircut about 25% live) |
| CRCLx Solana | CRCLon Ethereum | Trustware | not measured | **registry** | CRCLon in `ONDO_MARGIN_TOKENS`; no `equivalents.ts` entry, so `ondoCollateralSource` cannot resolve it |
| GLDx Solana | GLDon Ethereum | Trustware | not measured | **registry**, and **not 1:1** | see gold family |
| any | SNDKon Ethereum | Trustware | about 50% loss | **blocked** | 2026-08-25, hard bound 1,000 bps |
| any | SLVon Ethereum | | | **registry** | out of scope |
| SPYon, QQQon held on Ethereum | Ondo deposit address | ERC-20 transfer, ETH gas | gas | **built**, gated | `margin-sources.ts` step 4 |
| TSLAon, NVDAon | Ondo | | | **blocked** by venue | `provision_address` issues an address for TSLAon, but it is not accepted collateral and credits nothing |
| Ondo margin | deposited asset on Ethereum at registered payout address | Ondo executes, Ondo pays gas | 0 | **built**, shipped | `scripts/ondo-withdraw-check.mts`, 26 checks green against production 2026-08-26. No funded withdrawal recorded. |
| SPCXon Ethereum (withdrawn) | SPCXx Solana | Trustware `unwind` shape, approve + route, ETH gas about $0.14 at 0.125 gwei | about 400 bps at $18 | **quoted**, `/route` returns a signable transaction | 2026-08-26 |
| SPYon, QQQon, CRCLon, GLDon Ethereum | matching Solana xStock | Trustware `unwind` | not measured | **built** | same shape; every `ONDO_MARGIN_TOKENS` source to any curated xStock is allowlisted |

Deposit-address routing does not work in reverse: Trustware's `deposit-address` endpoint is
squid-only and squid does not carry the Ondo tokens, so the unwind always needs ETH.

## Route family 5: gold (D9)

Nothing here is 1:1. XAUt and XAUt0 are one troy ounce each and are different tokens; GLDx
is one GLD share, about 0.09 oz; GLDon reads as 0.09 oz on Solana and BNB and 0.45 oz on
Ethereum. Every conversion is a sale, bounded on value loss against the Morpho oracle in
`lib/morpho/gold-fund.ts`, never against a registry price (Trustware lists Ethereum GLDx at 17x
its sale price). Measurements 2026-08-26.

| Source | Destination | Engine | Cost | Status |
|---|---|---|---|---|
| USDC Solana | XAUt Ethereum | Trustware | about 0.4% all-in | **live** |
| USDC Solana | ETH Ethereum (gas), `0xEeee…` alias only | Trustware | 20 USDC delivered 0.007778 ETH | **live**; the zero address returns 502 here, the reverse of Monad |
| GLDx, GLDon, XAUt0 Solana | USDC Solana | Jupiter | 0.3% | **live** (leg one of the two-hop path) |
| GLDx, GLDon, XAUt0 Solana | XAUt Ethereum, direct | Trustware | | **blocked**, 502; the solver cannot compose two legs it runs individually. Reported upstream. The planner tries direct first on every run. |
| GLDx, GLDon Ethereum or BNB | anything | Trustware | | **blocked**, 502 in every direction; reads as no DEX liquidity for those wrappers off Solana |
| XAUt0 Solana | USDC Solana | Jupiter | 0.02% | **live** (tightest pair in the swap registry) |
| PAXG Solana | USDC Solana | Jupiter Ultra | under 0.003% impact at $25,000 | **live** (buyable catalog) |
| USDT Ethereum (borrowed) | USDC Solana | Trustware `return` shape | about 0.3% | **live** (the gold borrow exit) |
| USDC Solana | USDT Ethereum (to repay) | Trustware `swap` shape, both tokens in the swap registry | | **quoted** 2026-08-16 as a swap pair; not wired into the repay form, which spends USDT the wallet already holds |

## Route family 6: swap surface and buy flow

The swap registry (`lib/trustware/swap-tokens.ts`) is a closed set, both sides must be in it,
and every token was verified by live quotes in both directions on 2026-08-16
(`scripts/trustware-swap-quote-check.mts`). Solana-to-Solana pairs run on Jupiter, everything
else on Trustware.

| Chain | Tokens |
|---|---|
| Solana | USDC, USDT, SOL, ETH (Wormhole), WBTC (Wormhole, `3NZ9…`, chosen over `5XZw…` which loses 22% at $2,500), XAUt0 |
| Ethereum | USDC, USDT, ETH, WBTC, XAUt |
| BNB Chain | USDC (18 dp), USDT (18 dp), BNB, ETH, BTCB |

Any pair across those rows is **live** as a quote and allowlisted; EVM-to-EVM pairs go through
the Trustware widget, pairs touching Solana through our own panel.

Buy flow (`lib/jupiter/pay-assets.ts`): any Solana holding, including every catalog xStock and
SOL, buys any catalog asset through Jupiter Ultra in one swap. USDC on Ethereum, BNB Chain or
Base first bridges to Solana USDC (family 3 rows), then the same swap runs. **built** for the
bridged case, **live** for the Solana case.

## Test order

Ranked by what unblocks the most product, and by what is cheapest to learn first.

1. **Solana xStock to Monad xStock, and back**, the moment Backed publishes Monad mints.
   Everything in family 2 composes with this pair. Before that, settle whether a Monad venue
   will exist; without one the family has no consumer.
2. **Family 1a EVM rows with funds**, one each on Ethereum and BNB Chain. They are quoted, the
   execution inputs are verified, and no row has been executed end to end. TSLAon on Ethereum
   to TSLAx is the fixture every check script already uses.
3. **QQQon Solana to QQQx** through Jupiter directly. The 2026-08-05 block was a Trustware
   message, and Solana legs no longer go through Trustware.
4. **Lighter Arbitrum margin from all four USDC sources** with funds, and the Base destination
   at sizes above $50, to learn where the auction boundary sits this month.
5. **Ondo funding with `NEXT_PUBLIC_ONDO_FUNDING_ENABLED=true`**, one small USDC deposit from
   Solana, to confirm a bridge-delivered transfer credits. Every Ondo row is gated on this.
6. **Ondo USDC on Arbitrum**: new allowlist branch, then the same probe as the Lighter row.
7. **Unwind rows** for SPYon, QQQon, CRCLon and GLDon, since only SPCXon has been quoted.
8. **Family 1c discovery** for Dinari, bStocks, Robinhood and Base: `GET /routes/tokens` by
   address, then a quote into the Solana xStock at three sizes. No registry entry until a quote
   returns. Robinhood and any Arbitrum-only token also need Arbitrum added to Privy first.
9. **Family 1b** for the 14 catalog underlyings with no entry, once the Ondo token list for each
   is confirmed. CRCLon and SPCXon on Ethereum already have addresses and can go first.

## How to verify a route

All scripts are read-only unless the header says otherwise. Most need `TRUSTWARE_API_KEY` from
`.env.local` or a running dev server on `PROXY_ORIGIN`.

| Question | Script |
|---|---|
| Does an EVM stock token quote into a Solana xStock, and at what loss | `scripts/trustware-quote-spike.mjs` |
| Does a Solana-to-Solana route return anything signable (it does not) | `scripts/trustware-solana-route-check.mts` |
| Does the planner size a conversion correctly, offline and live | `scripts/trustware-planner-check.mts`, `scripts/trustware-unified-check.mts`, `scripts/trustware-borrow-check.mts` |
| Does the balance scan find a holding and does the planner accept it | `scripts/trustware-balances-check.mts` |
| Does a `/route` response carry what `execute.ts` needs | `scripts/trustware-execute-check.mts` |
| Does every swap-registry token route with the right decimals | `scripts/trustware-swap-quote-check.mts` |
| Base USDC to Solana at four sizes | `scripts/trustware-base-check.mts` |
| Solana USDC to Monad USDC and MON | `scripts/morpho-fund-check.mts` |
| Every gold source into XAUt, per source | `scripts/morpho-gold-check.mts` |
| USDC to Lighter's Arbitrum address from each chain | `scripts/lighter-margin-sources-check.mts` |
| Borrow-funded Lighter roads, signability per chain | `scripts/lighter-borrow-hedge-check.mts` (section 6) |
| Ondo collateral list, deposit addresses, production versus sandbox | `scripts/ondo-collateral-check.mts`, `scripts/ondo-hedge-check.mts` |
| Ondo withdrawal | `scripts/ondo-withdraw-check.mts` |

A quote at one size proves little. The measured routes move materially with size (SPCXon 431
bps at $20 against 46 at $690; Base USDC $0.30 flat, so 5.4% at $5) and with time (the
Arbitrum auction). Quote at $25, $250 and $2,500, and for any Solana-source Trustware route
check that `execution.transaction` is present, not just the price.

## Open questions

- **bStocks.** Confirm this means Backed's EVM bToken line. If so, which underlyings are 1:1
  with the xStock (bNVDA yes, bCSPX no), and whether the equivalence exclusion in
  `equivalents.ts` is being reversed on purpose.
- **Base tokenized stocks.** Which issuer.
- **Monad venue.** What consumes an xStock on Monad. Without an answer, family 2 is a bridge to
  a resting state.
- **Robinhood transferability.** If the tokens cannot leave Robinhood, there is no route.
- **Ondo Avalanche.** `margin-sources.ts` lists it, the live production config does not.
- **Arbitrum as a Privy chain.** Needed for Robinhood tokens, Ondo Arbitrum USDC withdrawals and
  any Arbitrum-issued dShare or bToken. Adding it is one line in `provider.tsx` plus a
  registry entry per token and a `stables.ts` row for USDC.
