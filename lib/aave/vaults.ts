import {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_USDC,
  ETHEREUM_USDT,
} from "./constants";

// Curated Aave vaults on Ethereum. Like the Morpho and Kamino registries this
// is a hardcoded allowlist, not anything the user can pass in. Addresses come
// from BGD Labs' aave-address-book and are re-read on-chain by
// scripts/aave-check.mts (see lib/aave/constants.ts).
//
// Two kinds of vault per stablecoin, and the difference is the whole point:
//
//   supply    The stata token (waEthUSDC, "wrapped aToken"). An ERC-4626 vault
//             whose deposit supplies the Aave V3 Core market and whose shares
//             are a fixed claim on a growing aToken balance. Earns the reserve's
//             supply rate. Withdraw any time, limited only by the reserve's
//             free liquidity, which for USDC and USDT is nine figures.
//
//   umbrella  The Umbrella stake token (stkwaEthUSDC), an ERC-4626 vault over
//             the stata token. Earns the same supply rate PLUS Aave's safety
//             incentives, which is where the higher rate comes from. What it
//             costs: the deposit backstops Aave's bad debt and can be slashed,
//             and leaving takes a cooldown (20 days at launch, read live) then
//             a short window (2 days) in which to redeem. Money in here is not
//             money that can be withdrawn today.
//
// Both kinds share decimals with their underlying (6), and the stake token
// wraps the stata token 1:1 at launch, so every share<->asset conversion still
// goes through `convertToAssets` rather than assuming par; slashing moves the
// stake token's rate and interest moves the stata token's.
export type AaveVaultKind = "supply" | "umbrella";

export interface AaveAsset {
  symbol: "USDC" | "USDT";
  name: string;
  address: string;
  decimals: number;
}

export interface AaveVault {
  kind: AaveVaultKind;
  // The ERC-4626 vault the user holds shares of: the stata token for `supply`,
  // the stake token for `umbrella`.
  address: string;
  // Display name.
  name: string;
  // The share token's symbol, as Etherscan shows it.
  symbol: string;
  chainId: number;
  // The plain ERC-20 the user deposits and withdraws.
  asset: AaveAsset;
  // The reserve's aToken. Read for the reserve's liquidity rate and used to
  // recognise a reward paid in it.
  aToken: string;
  // The stata token. Same as `address` for `supply`; the stake token's
  // underlying for `umbrella`.
  stataToken: string;
  // Share decimals. 6 for all four, matching the underlying.
  shareDecimals: number;
}

const USDC: AaveAsset = {
  symbol: "USDC",
  name: ETHEREUM_USDC.name,
  address: ETHEREUM_USDC.address,
  decimals: ETHEREUM_USDC.decimals,
};

const USDT: AaveAsset = {
  symbol: "USDT",
  name: ETHEREUM_USDT.name,
  address: ETHEREUM_USDT.address,
  decimals: ETHEREUM_USDT.decimals,
};

const A_ETH_USDC = "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c";
const WA_ETH_USDC = "0xD4fa2D31b7968E448877f69A96DE69f5de8cD23E";
const STK_WA_ETH_USDC = "0x6bf183243FdD1e306ad2C4450BC7dcf6f0bf8Aa6";

const A_ETH_USDT = "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a";
const WA_ETH_USDT = "0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8";
const STK_WA_ETH_USDT = "0xA484Ab92fe32B143AEE7019fC1502b1dAA522D31";

export const AAVE_VAULTS: readonly AaveVault[] = [
  {
    kind: "umbrella",
    address: STK_WA_ETH_USDC,
    name: "Aave Umbrella USDC",
    symbol: "stkwaEthUSDC",
    chainId: ETHEREUM_CHAIN_ID,
    asset: USDC,
    aToken: A_ETH_USDC,
    stataToken: WA_ETH_USDC,
    shareDecimals: 6,
  },
  {
    kind: "supply",
    address: WA_ETH_USDC,
    name: "Aave USDC",
    symbol: "waEthUSDC",
    chainId: ETHEREUM_CHAIN_ID,
    asset: USDC,
    aToken: A_ETH_USDC,
    stataToken: WA_ETH_USDC,
    shareDecimals: 6,
  },
  {
    kind: "umbrella",
    address: STK_WA_ETH_USDT,
    name: "Aave Umbrella USDT",
    symbol: "stkwaEthUSDT",
    chainId: ETHEREUM_CHAIN_ID,
    asset: USDT,
    aToken: A_ETH_USDT,
    stataToken: WA_ETH_USDT,
    shareDecimals: 6,
  },
  {
    kind: "supply",
    address: WA_ETH_USDT,
    name: "Aave USDT",
    symbol: "waEthUSDT",
    chainId: ETHEREUM_CHAIN_ID,
    asset: USDT,
    aToken: A_ETH_USDT,
    stataToken: WA_ETH_USDT,
    shareDecimals: 6,
  },
] as const;

export function aaveVaultByAddress(address: string): AaveVault | undefined {
  const a = address.toLowerCase();
  return AAVE_VAULTS.find((v) => v.address.toLowerCase() === a);
}

// Which Aave vaults accept a given Earn asset. The Earn table is keyed by
// asset, so the registry answers per asset: USDC and USDT get two vaults each,
// every other asset gets none and its Aave cell reads as unavailable, the same
// way Kamino's does.
export function aaveVaultsForAsset(symbol: string): readonly AaveVault[] {
  return AAVE_VAULTS.filter((v) => v.asset.symbol === symbol);
}
