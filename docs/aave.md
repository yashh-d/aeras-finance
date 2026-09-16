# Aave: USDC and USDT vaults on Ethereum

Read this before touching `lib/aave`, `app/api/aave`, or
`components/AaveVaultsCard.tsx`.

**Status: built without live verification.** The session that wrote this
could not reach Ethereum, Trustware or Aave's API (network policy), so every
address came from BGD Labs' `@bgd-labs/aave-address-book` 4.44.22 and every
contract interface from the `aave-dao/aave-umbrella` and `aave-dao/aave-v3-origin`
sources on GitHub. `scripts/aave-check.mts` re-reads all of it from the chain:

```bash
set -a; . ./.env.local; set +a; npx tsx scripts/aave-check.mts [evmAddress]
```

Run it before the venue is shown to a user, and again whenever an address in
`lib/aave/vaults.ts` changes. Then do one small deposit and one withdrawal of
each kind on mainnet with a wallet you control; the numbers to record are at
the end of this file.

## What "Aave vaults" means here

Aave has three things it calls vaults in 2026, and only two are integrable
without a business relationship:

| product | what it is | here? |
|---|---|---|
| Stata tokens (`waEthUSDC`, `waEthUSDT`) | ERC-4626 wrappers over Aave V3 Core aTokens. Deposit USDC, the wrapper supplies the Pool; shares are a fixed claim on a growing aToken balance. Instant exit. | yes, kind `supply` |
| Umbrella stake tokens (`stkwaEthUSDC.v1`, `stkwaEthUSDT.v1`) | ERC-4626 vaults over the stata tokens. Same supply yield plus **safety incentives**, paid for by taking first loss on Aave's bad debt. 20-day cooldown, 2-day window to leave. | yes, kind `umbrella` |
| Stable Vaults (Aave Labs, July 2026) | Fixed-rate B2B product. The *operator* (us) would deploy and set per-user rates; Aave Labs runs allocation. Needs an operator agreement, not a code change. | no |

The Earn table shows one Aave column per stablecoin row, carrying the better
of the two rates, and the expanded row lets the user pick. The Umbrella vault
is the "high yield" one, and the panel is built around making its cost plain.

## Addresses

All on Ethereum mainnet, chainId 1.

| | address |
|---|---|
| Aave V3 Core Pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Aave Oracle | `0x54586bE62E3c3580375aE3723C145253060Ca0C2` |
| Umbrella | `0xD400fc38ED4732893174325693a63C30ee3881a8` |
| Umbrella RewardsController | `0x4655Ce3D625a63d30bA704087E52B4C31E38188B` |
| UmbrellaBatchHelper | `0xCe6Ced23118EDEb23054E06118a702797b13fc2F` |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| aEthUSDC | `0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c` |
| waEthUSDC (stata) | `0xD4fa2D31b7968E448877f69A96DE69f5de8cD23E` |
| stkwaEthUSDC.v1 | `0x6bf183243FdD1e306ad2C4450BC7dcf6f0bf8Aa6` |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| aEthUSDT | `0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a` |
| waEthUSDT (stata) | `0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8` |
| stkwaEthUSDT.v1 | `0xA484Ab92fe32B143AEE7019fC1502b1dAA522D31` |

Every share token is **6 decimals**, matching the underlying. The stake token
wraps the stata token and the stata token wraps the aToken, so a stake
position is priced as
`stata.convertToAssets(stake.convertToAssets(shares))`, never at par: interest
moves the stata rate and slashing moves the stake rate.

## The flows

**Deposit, supply vault.** `approve(USDC -> waEthUSDC)`, then
`waEthUSDC.deposit(assets, user)`. Two transactions.

**Deposit, Umbrella.** `approve(USDC -> UmbrellaBatchHelper)`, then
`helper.deposit({stakeToken, edgeToken: USDC, value})`. The helper wraps USDC
into the stata token and stakes it in one transaction. The helper accepts USDC,
the aToken, or the stata token as `edgeToken`; anything else reverts with
`InvalidEdgeToken`.

**Withdraw, supply vault.** `waEthUSDC.withdraw(assets, user, user)`, or
`redeem(shares, user, user)` for a full exit so no dust is left. Capped by the
reserve's free liquidity, which `maxWithdraw(user)` reports and the form shows.

**Withdraw, Umbrella.** Three steps over about three weeks:

1. `stakeToken.cooldown()`. Snapshots the share balance; the clock starts.
   The position keeps earning and stays slashable.
2. Wait `getCooldown()` seconds (20 days at launch; read live).
3. Inside the next `getUnstakeWindow()` seconds (2 days at launch):
   `approve(stakeToken -> helper)` then
   `helper.redeem({stakeToken, edgeToken: USDC, value: shares})`. Only the
   snapshot amount can leave. Miss the window and it is back to step 1.

`lib/aave/math.ts` `cooldownPhase` turns `getStakerCooldown(user)` plus the
latest block timestamp into `none | cooling | window | expired`. Judge it
against the **block** timestamp, not the server clock, because the contract
does.

**Rewards.** `RewardsController.claimAllRewards(stakeToken, user)` pays every
stream to the wallet. For the two stablecoin vaults the stream is the
reserve's aToken (verify with the script: it prints whether each reward is the
vault's aToken). "Claim and restake" follows the claim with
`approve(aToken -> helper)` and `helper.deposit({edgeToken: aToken})`, with
0.1% headroom because an aToken balance grows every block and the helper
transfers `min(value, live balance)`.

## Rates

**Supply APY** comes from `Pool.getReserveData(asset).currentLiquidityRate`, a
ray-scaled annual rate that Aave compounds per second:
`(1 + r / 31536000) ^ 31536000 - 1`. That is what app.aave.com shows.

**Safety incentives** come from
`RewardsController.calculateCurrentEmission(stake, reward)` (per second, in the
reward's own units, already zero after `distributionEnd`), priced through the
Aave oracle on both sides:

```
apr = emission/s * 31536000 * rewardPrice / (stake.totalAssets * stataPrice)
```

where `stataPrice` is `stata.latestAnswer()` (underlying price times exchange
rate, 8 decimals) and the reward, being an aToken, takes its reserve's oracle
price. Emissions follow an S-curve around the stake's `targetLiquidity`, so
the rate falls as more is staked; this reads the point on the curve right now.

The Umbrella cell shows `supplyApy + rewardApr`, the way Aave's staking page
does. The two are paid in different tokens and do not compound into each
other.

## Funding and gas

Same universal-deposit machinery as Morpho-on-Monad, pointed at Ethereum:

- Solana USDC -> Ethereum USDC or USDT through Trustware (the swap shape in
  `lib/trustware/server.ts`; both sides are in `swap-tokens.ts`). USDT is a real
  swap, so the planner probes the rate and solves for the source amount with
  1.5% headroom rather than assuming par.
- ETH for gas through `lib/trustware/eth-gas.ts`, the planner extracted from
  the gold market. Sized from the live gas price for a full Umbrella
  lifecycle (1.1M gas units: approve, helper deposit, cooldown, approve, helper
  redeem, claim) so a depositor is never stuck unable to leave. Refuses above
  2% of the position (floor $25) rather than silently spending.
- The return leg, Ethereum USDC or USDT -> Solana USDC, uses the return shape
  and is offered inside the panel whenever the Ethereum wallet holds a
  balance, because the Ethereum wallet is a waypoint and nothing else in the
  app spends from it.

## What to record after the first live run

- The script's supply APY for USDC and USDT beside app.aave.com's figures.
- The script's safety-incentive total for each stake token beside
  app.aave.com/staking, and which token each reward is paid in.
- Gas used by: helper deposit, cooldown, helper redeem, claimAllRewards. The
  1.1M-unit budget in `lib/aave/fund.ts` is an estimate from typical Aave
  costs and should be replaced with measured numbers.
- Whether a deposit during a cooldown resets the snapshot (the copy says it
  does not extend it; confirm the `_update` hook's behaviour on a live
  position).
