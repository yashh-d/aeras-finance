import { MONAD_CHAIN_ID, MONAD_USDC } from "./constants";

// Curated Monad USDC MetaMorpho vaults. Like the xStock and Kamino registries,
// this is a hardcoded allowlist, not anything the user can pass in. Addresses
// verified live against the Morpho indexer and each vault's on-chain `asset()`
// on 2026-08-24.
//
// A note on decimals: the deposited asset (USDC) is 6-decimal, but MetaMorpho
// *shares* are 18-decimal ERC-20s. Deposits are priced in USDC (6dp) and
// balances come back in shares (18dp), so any share<->asset conversion must go
// through the vault's `convertToAssets` / `convertToShares` rather than
// assuming equal decimals.
export interface MorphoVault {
  // ERC-4626 vault address on Monad.
  address: string;
  // Display name, as Morpho lists it.
  name: string;
  // Who manages the vault's allocations. Shown so the user knows whose risk
  // decisions they are trusting; the curator, not Morpho, picks the markets.
  curator: string;
  chainId: number;
  // The deposited asset (USDC on Monad).
  asset: typeof MONAD_USDC;
  // ERC-4626 share-token decimals. 18 for MetaMorpho.
  shareDecimals: number;
  // Morpho has not yet added these to its official listed set. Surfaced in the
  // UI as a caution: an unlisted vault has not passed Morpho's listing review.
  listed: boolean;
}

const SHARE_DECIMALS = 18;

export const MONAD_USDC_VAULTS: readonly MorphoVault[] = [
  {
    address: "0x21649703fe63265058e9f22582552561Af4AfA3f",
    name: "August USDC",
    curator: "August",
    chainId: MONAD_CHAIN_ID,
    asset: MONAD_USDC,
    shareDecimals: SHARE_DECIMALS,
    listed: false,
  },
  {
    address: "0x802c91d807A8DaCA257c4708ab264B6520964e44",
    name: "Steakhouse High Yield USDC",
    curator: "Steakhouse Financial",
    chainId: MONAD_CHAIN_ID,
    asset: MONAD_USDC,
    shareDecimals: SHARE_DECIMALS,
    listed: false,
  },
  {
    address: "0xA8665084D8CD6276c00CA97Cbc0BF4BC9ae94c79",
    name: "Hyperithm USDC Apex",
    curator: "Hyperithm",
    chainId: MONAD_CHAIN_ID,
    asset: MONAD_USDC,
    shareDecimals: SHARE_DECIMALS,
    listed: false,
  },
] as const;

// Addresses lower-cased, for matching against RPC / indexer responses which are
// not case-consistent.
export const MONAD_USDC_VAULT_ADDRESSES = MONAD_USDC_VAULTS.map((v) =>
  v.address.toLowerCase(),
);

export function morphoVaultByAddress(address: string): MorphoVault | undefined {
  const a = address.toLowerCase();
  return MONAD_USDC_VAULTS.find((v) => v.address.toLowerCase() === a);
}
