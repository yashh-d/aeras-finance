import { MONAD_CHAIN_ID, MONAD_USDC } from "./constants";

// Curated Monad USDC Morpho vaults. Like the xStock and Kamino registries,
// this is a hardcoded allowlist, not anything the user can pass in. Addresses
// verified live against the Morpho indexer and each vault's on-chain `asset()`,
// `decimals()`, and `convertToAssets()` on 2026-08-25.
//
// These are Morpho Vaults V2, not V1 MetaMorpho. This distinction bites:
// near-empty V1 vaults with the *same names* ("Hyperithm USDC Apex" at
// 0xA8665084..., "August USDC" at 0x21649703..., "Steakhouse High Yield USDC"
// at 0x802c91d8...) also exist on Monad, and the indexer serves V1 under the
// `vaults` query and V2 under `vaultV2s`. All the real TVL is in V2 (Hyperithm
// ~$66M vs $23 in its V1 twin on 2026-08-25). Do not point this registry at a
// V1 address and do not query V1 metrics for it.
//
// V2 vaults are still ERC-4626 for everything we do: `deposit` / `withdraw` /
// `redeem` / `convertToAssets` all work, and all three vaults' deposit and
// share gates are unset (receive/send-shares gates permanently abdicated), so
// access is permissionless. One V2 quirk: `maxDeposit` / `maxRedeem` always
// return 0 by design, so never consult them to size a transaction.
//
// A note on decimals: the deposited asset (USDC) is 6-decimal, but vault
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
  // ERC-4626 share-token decimals. 18 for Morpho Vaults V2.
  shareDecimals: number;
  // Whether the vault has passed Morpho's listing review and appears in its
  // official listed set. All current entries are listed; keep the flag so an
  // unlisted addition can be surfaced as a caution in the UI.
  listed: boolean;
}

const SHARE_DECIMALS = 18;

// Ordered by TVL as of 2026-08-25.
export const MONAD_USDC_VAULTS: readonly MorphoVault[] = [
  {
    address: "0x78999cc96d2Ba0341588C60CcB0E91c6C33CF371",
    name: "Hyperithm USDC Apex",
    curator: "Hyperithm",
    chainId: MONAD_CHAIN_ID,
    asset: MONAD_USDC,
    shareDecimals: SHARE_DECIMALS,
    listed: true,
  },
  {
    address: "0x80017bF0f793EBbE9679Cd61ff0e395B62CAbB59",
    name: "August USDC V2",
    curator: "August Digital",
    chainId: MONAD_CHAIN_ID,
    asset: MONAD_USDC,
    shareDecimals: SHARE_DECIMALS,
    listed: true,
  },
  {
    address: "0xbeEFf443C3CbA3E369DA795002243BeaC311aB83",
    name: "Steakhouse High Yield USDC",
    curator: "Steakhouse Financial",
    chainId: MONAD_CHAIN_ID,
    asset: MONAD_USDC,
    shareDecimals: SHARE_DECIMALS,
    listed: true,
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
