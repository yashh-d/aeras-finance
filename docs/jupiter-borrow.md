# Jupiter Borrow (Lend)

Jupiter Lend has two sides:

- **Earn** (`/lend/v1/earn/*`) — deposit-and-earn. **Does not list xStocks** (only USDC/SOL/USDT/EURC/USDG/USDS/JupUSD). Not used in this app.
- **Borrow** — collateralised borrowing. Has live xStock collateral vaults. This is what we use.

The Borrow REST API is marked "Soon" — the only public REST endpoint right now is `GET /lend/v1/borrow/vaults` (list of all vaults with live rates and oracle prices). All write operations go through the **SDK** (`@jup-ag/lend`, subpath `/borrow`).

## xStock collateral vaults (live on mainnet as of 2026-05-21)

Pulled from `GET https://api.jup.ag/lend/v1/borrow/vaults`. Numbers are protocol values (CF = collateral factor, LT = liquidation threshold, ML = max liquidation).

| Vault | Collateral → Borrow | CF | LT | ML |
|---|---|---|---|---|
| 77 | TSLAx → USDC | 65% | 75% | 90% |
| 78 | SPYx → USDC | 75% | 85% | 90% |
| 79 | QQQx → USDC | 75% | 85% | 90% |
| 80 | NVDAx → USDC | 65% | 75% | 90% |
| 81 | TSLAx → JupUSD | 65% | 75% | 90% |
| 82 | SPYx → JupUSD | 75% | 85% | 90% |
| 83 | QQQx → JupUSD | 75% | 85% | 90% |
| 84 | NVDAx → JupUSD | 65% | 75% | 90% |

The 6 other xStocks in our curated list (AAPLx, METAx, GOOGLx, COINx, CRCLx, MSTRx) have no Jupiter Borrow vault. v1 hides them from the borrow UI.

v1 of the app uses **USDC vaults only** (77–80). JupUSD pairs are a follow-up.

## SDK semantics

Single entry point for all collateral/debt operations: `getOperateIx` from `@jup-ag/lend/borrow`.

```ts
const { ixs, addressLookupTableAccounts, nftId } = await getOperateIx({
  vaultId,        // number, e.g. 77
  positionId,    // number; 0 = create new position + first op in one tx
  colAmount,     // BN: positive = deposit, negative = withdraw, 0 = no change
  debtAmount,    // BN: positive = borrow, negative = repay, 0 = no change
  connection,    // @solana/web3.js Connection
  signer,        // PublicKey (position owner)
});
```

| Operation | `colAmount` | `debtAmount` | Notes |
|---|---|---|---|
| Create + deposit | `> 0` | `0` | `positionId = 0`; returned `nftId` is the new position id |
| Deposit more | `> 0` | `0` | `positionId = nftId` of existing position |
| Borrow | `0` | `> 0` | Borrow token sent to wallet |
| Repay (partial) | `0` | `< 0` (use `.neg()`) | Must hold borrow token in wallet |
| Repay (max) | `0` | `MAX_REPAY_AMOUNT` (exported sentinel) | Closes full debt — interest accrues per slot |
| Withdraw | `< 0` (use `.neg()`) | `0` | Up to LTV limit |

All borrow txs use **versioned (v0) format with address lookup tables**. The init-position-only path uses `getInitPositionIx` and a legacy tx, but with `positionId: 0` on `getOperateIx` you skip that and batch in one transaction.

## Position is an NFT

Each borrow position is a position-NFT minted to the user. One position per (user, vault). The `nftId` returned by `getOperateIx` (when `positionId: 0`) is needed for every subsequent op on that position.

## Risk math

- **Collateral value** in USD: `collateralAmount * oraclePrice`. The vault response exposes `oraclePrice`, `oraclePriceOperate`, `oraclePriceLiquidate` — `Operate` is used at deposit/borrow time, `Liquidate` is the harsher liquidation price.
- **Max borrow** = `collateralValueUSD * (CF / 1000)`. (CF is in tenths of a percent — `collateralFactor: "800"` means 80%.)
- **LT and ML** are also tenths of a percent.
- **Health = LT / current_LTV.** Below 1.0 = liquidatable.

## RPC needs

Reads use `connection.getMultipleAccountsInfo` etc. Borrow's `getOperateIx` does several RPC reads to build instructions, so a paid RPC (Helius) is required — public mainnet RPC will rate-limit.

## Privy signing

Privy docs show server-side signing with `@privy-io/node`. We do it client-side: SDK builds ixs in the browser → compile to v0 with ALTs → serialize to base64 → sign via existing `useSignAndSendTransaction` (or `signTransaction` + send). Same pattern as the Jupiter Ultra swap.

## Browser bundling

`@jup-ag/lend` pulls in `@coral-xyz/anchor` and `@solana/web3.js@1`. Anchor sometimes needs `Buffer` polyfilled in Next.js client bundles — if hydration breaks with "Buffer is not defined", add a polyfill in the client provider.

## Out of scope for v1

- JupUSD-pair vaults (vaults 81–84).
- `refinance` and `flashloan` subpaths.
- Repay-with-collateral (atomic flashloan close).
- Multi-position UI (one position per vault is enough).
- Liquidation alerts beyond a color indicator.

## References

- Vaults endpoint (live): https://api.jup.ag/lend/v1/borrow/vaults
- SDK docs: https://dev.jup.ag/docs/lend/borrow/
- Privy + borrow example: https://dev.jup.ag/docs/lend/wallets/privy-borrow
- Read SDK: `@jup-ag/lend-read` (not used in v1 — we read positions directly via SDK helpers and the vaults endpoint)
