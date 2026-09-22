// The Aave V4 surface this app touches, and nothing more. Deliberately partial:
// the Spoke and Hub are large upgradeable contracts and carrying their whole
// ABIs would invite calling something we have not thought about.
//
// Every entry below was generated from the Sourcify full-match ABIs of the
// implementations behind the two proxies (SpokeInstance
// 0x70ed94a65df287dc54184963d7a9edc83dd34223, HubInstance
// 0xfe89fd96f270ac3c0f11921af0390dbb1340f704) on 2026-09-09, so the struct
// field order is the contract's, not a transcription. Struct components are
// named, which is what lets viem decode `getReserve` and `getUserAccountData`
// into objects rather than positional tuples. The oracle ABI is written by hand
// from IAaveOracle.sol because that contract is not verified on Sourcify; it is
// three functions and scripts/aave-gold-check.mts exercises all of them.
//
// Shared by the server read routes (app/api/aave/gold-*) and the client write
// path (lib/aave/gold-borrow.ts), so the encodings cannot drift apart.

// ISpoke: reads used by the routes and the check script, then the five writes
// and `multicall`, which is how supply and enable-as-collateral share a
// transaction.
export const AAVE_SPOKE_ABI = [
  {
    type: "function",
    name: "SPOKE_REVISION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "ORACLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getReserveCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getReserve",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }],
    outputs: [
      { name: "", type: "tuple", components: [{ name: "underlying", type: "address" }, { name: "hub", type: "address" }, { name: "assetId", type: "uint16" }, { name: "decimals", type: "uint8" }, { name: "collateralRisk", type: "uint24" }, { name: "flags", type: "uint8" }, { name: "dynamicConfigKey", type: "uint32" }] },
    ],
  },
  {
    type: "function",
    name: "getReserveConfig",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }],
    outputs: [
      { name: "", type: "tuple", components: [{ name: "collateralRisk", type: "uint24" }, { name: "paused", type: "bool" }, { name: "frozen", type: "bool" }, { name: "borrowable", type: "bool" }, { name: "receiveSharesEnabled", type: "bool" }] },
    ],
  },
  {
    type: "function",
    name: "getDynamicReserveConfig",
    stateMutability: "view",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "dynamicConfigKey", type: "uint32" },
    ],
    outputs: [
      { name: "", type: "tuple", components: [{ name: "collateralFactor", type: "uint16" }, { name: "maxLiquidationBonus", type: "uint32" }, { name: "liquidationFee", type: "uint16" }] },
    ],
  },
  {
    type: "function",
    name: "getLiquidationConfig",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "", type: "tuple", components: [{ name: "targetHealthFactor", type: "uint128" }, { name: "healthFactorForMaxBonus", type: "uint64" }, { name: "liquidationBonusFactor", type: "uint16" }] },
    ],
  },
  {
    type: "function",
    name: "getReserveSuppliedAssets",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "", type: "tuple", components: [{ name: "riskPremium", type: "uint256" }, { name: "avgCollateralFactor", type: "uint256" }, { name: "healthFactor", type: "uint256" }, { name: "totalCollateralValue", type: "uint256" }, { name: "totalDebtValueRay", type: "uint256" }, { name: "activeCollateralCount", type: "uint256" }, { name: "borrowCount", type: "uint256" }] },
    ],
  },
  {
    type: "function",
    name: "getUserSuppliedAssets",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserTotalDebt",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserReserveStatus",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }, { name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getUserPosition",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [
      { name: "", type: "tuple", components: [{ name: "drawnShares", type: "uint120" }, { name: "premiumShares", type: "uint120" }, { name: "premiumOffsetRay", type: "int200" }, { name: "suppliedShares", type: "uint120" }, { name: "dynamicConfigKey", type: "uint32" }] },
    ],
  },
  {
    type: "function",
    name: "isPositionManagerActive",
    stateMutability: "view",
    inputs: [{ name: "positionManager", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setUsingAsCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "uint256" },
      { name: "usingAsCollateral", type: "bool" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "", type: "bytes[]" }],
  },
] as const;

// IHub: rate, liquidity and per-spoke caps for the assets the Gold spoke draws
// on. Caps are in whole tokens, not atomic units; see gold-server.ts.
export const AAVE_HUB_ABI = [
  {
    type: "function",
    name: "HUB_REVISION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "getAssetUnderlyingAndDecimals",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }, { name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "getAssetLiquidity",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getAssetDrawnRate",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getSpokeConfig",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }, { name: "spoke", type: "address" }],
    outputs: [
      { name: "", type: "tuple", components: [{ name: "addCap", type: "uint40" }, { name: "drawCap", type: "uint40" }, { name: "riskPremiumThreshold", type: "uint24" }, { name: "active", type: "bool" }, { name: "halted", type: "bool" }] },
    ],
  },
  {
    type: "function",
    name: "getSpokeAddedAssets",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }, { name: "spoke", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getSpokeTotalOwed",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "uint256" }, { name: "spoke", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// IAaveOracle / IPriceOracle. Prices are USD with `decimals()` places (8 on the
// Gold spoke), one per reserve id, and `getReserveSource` names the feed behind
// each so the check script can confirm XAUt is priced by Chainlink XAU/USD.
export const AAVE_ORACLE_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "getReservePrice",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getReserveSource",
    stateMutability: "view",
    inputs: [{ name: "reserveId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
