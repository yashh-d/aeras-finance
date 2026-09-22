// The shMON surface this app calls. Deliberately partial: IShMonad carries the
// policy, hold, boost and validator machinery too, and carrying it would
// invite calling something we have not thought about. Sources:
//   FastLane-Labs/fastlane-contracts  src/shmonad/interfaces/IERC4626Custom.sol
//   FastLane-Labs/fastlane-contracts  src/shmonad/interfaces/IShMonad.sol
// read on 2026-09-22.
//
// Shared by the server reads (lib/shmonad/server.ts) and the client write
// path (lib/shmonad/stake.ts) so the encodings cannot drift apart.

export const SHMON_ABI = [
  // ── ERC-20 / metadata ─────────────────────────────────────────────────
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // ── ERC-4626 (custom: deposit is payable, asset is native MON) ─────────
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
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
  {
    type: "function",
    name: "previewDeposit",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
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
    name: "maxWithdraw",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "previewRedeem",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
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
  {
    type: "function",
    name: "redeemWithSlippageProtection",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
      { name: "minAmountOut", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  // ── shMonad: instant exit pricing ─────────────────────────────────────
  {
    type: "function",
    name: "previewRedeemDetailed",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [
      { name: "grossAssets", type: "uint256" },
      { name: "feeAssets", type: "uint256" },
      { name: "netAssets", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getAtomicPoolUtilization",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "utilized", type: "uint256" },
      { name: "allocated", type: "uint256" },
      { name: "available", type: "uint256" },
      { name: "utilizationWad", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getCurrentUnstakeFeeRateRay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "feeRateRay", type: "uint256" }],
  },
  {
    type: "function",
    name: "getFeeCurveParams",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "slopeRateRayOut", type: "uint256" },
      { name: "yInterceptRayOut", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getAtomicUtilizationWad",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "utilizationWad", type: "uint256" }],
  },
  // ── shMonad: queued exit ──────────────────────────────────────────────
  {
    type: "function",
    name: "previewUnstake",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "requestUnstake",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "completionEpoch", type: "uint64" }],
  },
  {
    type: "function",
    name: "completeUnstake",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "getUnstakeRequest",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "amountMon", type: "uint128" },
      { name: "completionEpoch", type: "uint64" },
    ],
  },
  // ── shMonad: protocol state ───────────────────────────────────────────
  {
    type: "function",
    name: "getInternalEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "getAdminValues",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "internalEpoch", type: "uint64" },
      { name: "targetLiquidityPercentage", type: "uint16" },
      { name: "incentiveAlignmentPercentage", type: "uint16" },
      { name: "stakingCommission", type: "uint16" },
      { name: "boostCommissionRate", type: "uint16" },
      { name: "commissionPayable", type: "uint128" },
    ],
  },
] as const;
