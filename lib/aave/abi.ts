// The Aave surface this app touches. Deliberately partial: the Pool, the
// rewards controller and the batch helper are large contracts, and carrying
// their whole ABIs would invite calling something we have not thought about.
//
// Shared by the server read routes (app/api/aave/*) and the client write path
// (lib/aave/deposit.ts), so the encodings cannot drift apart. Sources:
//   aave-dao/aave-v3-origin  src/contracts/extensions/stata-token/*
//   aave-dao/aave-umbrella   src/contracts/{stakeToken,rewards,helpers}/*
// read at the commits current on 2026-09-16.

// ERC-4626, as both the stata token and the stake token implement it.
export const ERC4626_ABI = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToShares",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  // What the owner could withdraw right now, in assets. For the stata token
  // this is capped by the reserve's free liquidity; for the stake token it is
  // zero outside the unstake window.
  {
    type: "function",
    name: "maxWithdraw",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxRedeem",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

// StataTokenV2 extras.
export const STATA_TOKEN_ABI = [
  {
    type: "function",
    name: "aToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  // underlying price (Aave oracle, 8 decimals) scaled by the exchange rate.
  {
    type: "function",
    name: "latestAnswer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "int256" }],
  },
] as const;

// Umbrella StakeToken extras. Pausable: a paused stake token returns zero from
// every max* view and reverts on deposit, and governance has paused one
// (stkwaWETH) before, so the read layer checks it.
export const STAKE_TOKEN_ABI = [
  {
    type: "function",
    name: "cooldown",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // A user's cooldown snapshot. `amount` is the share balance frozen when the
  // cooldown started, and is the most that can be redeemed in the window.
  {
    type: "function",
    name: "getStakerCooldown",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "amount", type: "uint192" },
          { name: "endOfCooldown", type: "uint32" },
          { name: "withdrawalWindow", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getCooldown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getUnstakeWindow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getMaxSlashableAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// Aave V3 Pool. `getReserveData` returns the ReserveDataLegacy struct; only
// `currentLiquidityRate` (index 2, a ray-scaled annual rate) is read, but the
// whole layout has to be declared for the decode to land on the right word.
export const AAVE_POOL_ABI = [
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "configuration", type: "uint256" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

export const AAVE_ORACLE_ABI = [
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// aToken: the one view that identifies it as an aToken and names its reserve.
export const ATOKEN_ABI = [
  {
    type: "function",
    name: "UNDERLYING_ASSET_ADDRESS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const ERC20_META_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

// Umbrella RewardsController. `claimAllRewards` is overloaded upstream (one
// asset, or an array); only the single-asset form is declared, so the encoder
// cannot pick the wrong one.
export const REWARDS_CONTROLLER_ABI = [
  {
    type: "function",
    name: "getAllRewards",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getAssetData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "targetLiquidity", type: "uint256" },
          { name: "lastUpdateTimestamp", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getRewardData",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "reward", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "addr", type: "address" },
          { name: "index", type: "uint256" },
          { name: "maxEmissionPerSecond", type: "uint256" },
          { name: "distributionEnd", type: "uint256" },
        ],
      },
    ],
  },
  // Emission per second right now, in the reward token's own units. Already
  // zero when the distribution has ended.
  {
    type: "function",
    name: "calculateCurrentEmission",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "reward", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "calculateCurrentUserRewards",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "address[]" }, { type: "uint256[]" }],
  },
  {
    type: "function",
    name: "claimAllRewards",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "address[]" }, { type: "uint256[]" }],
  },
] as const;

// UmbrellaBatchHelper. `deposit` takes the token the user starts with (USDC,
// the aToken or the stata token) and ends holding stake shares; `redeem` burns
// stake shares and ends with the token named.
const IO_DATA = {
  type: "tuple",
  name: "io",
  components: [
    { name: "stakeToken", type: "address" },
    { name: "edgeToken", type: "address" },
    { name: "value", type: "uint256" },
  ],
} as const;

export const BATCH_HELPER_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [IO_DATA],
    outputs: [],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [IO_DATA],
    outputs: [],
  },
  {
    type: "function",
    name: "REWARDS_CONTROLLER",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;
