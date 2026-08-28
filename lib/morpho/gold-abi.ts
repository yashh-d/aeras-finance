// The Morpho Blue surface this app touches, plus the two view calls needed to
// price a position. Deliberately partial: Morpho Blue is a large singleton and
// carrying its whole ABI would invite calling something we have not thought
// about.
//
// Shared by the server read route (app/api/morpho/gold-position) and the client
// write path (lib/morpho/gold-borrow.ts), so the encodings cannot drift apart.

// The MarketParams struct, repeated inline because every write call takes it.
const MARKET_PARAMS = {
  type: "tuple",
  name: "marketParams",
  components: [
    { name: "loanToken", type: "address" },
    { name: "collateralToken", type: "address" },
    { name: "oracle", type: "address" },
    { name: "irm", type: "address" },
    { name: "lltv", type: "uint256" },
  ],
} as const;

export const MORPHO_BLUE_ABI = [
  // ── reads ────────────────────────────────────────────────────────────────
  //
  // Morpho returns these as flat tuples rather than named structs, so the field
  // order below is load-bearing. `lastUpdate` and `fee` are declared uint128 in
  // the struct even though they hold a timestamp and a WAD fraction.
  {
    type: "function",
    name: "market",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "totalSupplyAssets", type: "uint128" },
      { name: "totalSupplyShares", type: "uint128" },
      { name: "totalBorrowAssets", type: "uint128" },
      { name: "totalBorrowShares", type: "uint128" },
      { name: "lastUpdate", type: "uint128" },
      { name: "fee", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "supplyShares", type: "uint256" },
      { name: "borrowShares", type: "uint128" },
      // Collateral is held as a raw token amount, not as shares. There is no
      // collateral share price and no interest on it: what you put in is what
      // you take out, minus anything a liquidator seized.
      { name: "collateral", type: "uint128" },
    ],
  },
  // Reverse lookup from id to params. Only the check script calls this, to
  // prove the hardcoded registry matches the chain.
  {
    type: "function",
    name: "idToMarketParams",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
  },

  // ── writes ───────────────────────────────────────────────────────────────
  //
  // Every one of these takes the full MarketParams rather than an id: Morpho
  // derives the id by hashing them, so passing the wrong params addresses a
  // different (almost certainly nonexistent) market and reverts.
  {
    type: "function",
    name: "supplyCollateral",
    stateMutability: "nonpayable",
    inputs: [
      MARKET_PARAMS,
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      // Callback payload for a flash-style supply. Always empty here.
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      MARKET_PARAMS,
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
  },
  // borrow and repay each take BOTH an asset amount and a share amount, and
  // exactly one must be zero. Borrowing and partially repaying are sized in
  // assets; a full repayment is sized in shares, so the debt closes exactly
  // instead of leaving a wei of dust that keeps the position open.
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      MARKET_PARAMS,
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [
      { name: "assetsBorrowed", type: "uint256" },
      { name: "sharesBorrowed", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      MARKET_PARAMS,
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "assetsRepaid", type: "uint256" },
      { name: "sharesRepaid", type: "uint256" },
    ],
  },
] as const;

// The oracle's only method. Returns the collateral price scaled by
// 10^(36 + loanDecimals - collateralDecimals); see ORACLE_PRICE_SCALE.
export const MORPHO_ORACLE_ABI = [
  {
    type: "function",
    name: "price",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// The interest rate model, read to accrue interest off-chain.
//
// `borrowRateView` is the non-mutating twin of `borrowRate`. It takes the same
// market struct the singleton stores, and returns a per-second rate, WAD-scaled.
export const MORPHO_IRM_ABI = [
  {
    type: "function",
    name: "borrowRateView",
    stateMutability: "view",
    inputs: [
      MARKET_PARAMS,
      {
        type: "tuple",
        name: "market",
        components: [
          { name: "totalSupplyAssets", type: "uint128" },
          { name: "totalSupplyShares", type: "uint128" },
          { name: "totalBorrowAssets", type: "uint128" },
          { name: "totalBorrowShares", type: "uint128" },
          { name: "lastUpdate", type: "uint128" },
          { name: "fee", type: "uint128" },
        ],
      },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
