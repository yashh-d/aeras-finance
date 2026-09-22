// Blend (portal.blend.money) as an Earn venue.
//
// Blend is not a vault. It is a per-user Gnosis Safe plus an allocation
// policy: the account type below names a set of catalog vaults with weights,
// every user who signs in gets a Safe of their own (same address on every
// chain), and Blend routes that Safe's USDC across those vaults and rebalances
// it as the weights drift. The user is the Safe's only signer. Aeras never
// holds a key, which is why the integration is the frontend SDK
// (`@blend-money/fe`, SIWE with the embedded EVM wallet) and not the server
// SDK, whose model is a server-held signer.
//
// Three facts that shape everything built on this:
//
//   1. **EVM only.** Blend is live on eight EVM chains and no Solana. It is
//      the fourth venue where a position lives off Solana (CLAUDE.md, Chain
//      Assumptions), reached the same way Morpho-on-Monad is: the embedded
//      EVM wallet signs, and Trustware funds it from Solana USDC.
//   2. **A deposit lands on the account type's first configured chain**, not
//      the chain it is sent from ("the destination is the first configured
//      chain with vault infrastructure", docs.blend.money/architecture). A
//      deposit from Monad into an account type whose first chain is Ethereum
//      bridges to Ethereum. Which chain that is for `aeras-earn` is portal
//      state, read live by the yield route, never assumed here.
//   3. **The user pays gas, on every chain.** A deposit is a plain transfer
//      from the embedded wallet on Monad. A withdrawal is one Safe
//      transaction per chain the position sits on, sent by the embedded
//      wallet as the Safe's sole owner (lib/blend/safe.ts), so the wallet
//      needs MON, ETH on Ethereum and ETH on Base as the quote requires, and
//      the withdrawal path buys what is missing from Solana USDC first.
//      Blend's SDK would instead send those as ERC-4337 UserOperations paid
//      by a paymaster; nothing here uses that. Bridge fees are separate and
//      the quote shows them.
//
// Verified live by scripts/blend-check.mts.

import { MONAD_CHAIN_ID, MONAD_USDC } from "@/lib/morpho/constants";

// The account type slug from the portal (Accounts -> Aeras Earn). It is the
// `accountTypeId` path segment of every server API call and the thing the
// publishable key is bound to. Cannot be renamed once created.
export const BLEND_ACCOUNT_TYPE_ID = "aeras-earn";

// What the venue is called in the product. Blend is the infrastructure and
// stays out of the label, the column and the tab; the expanded panel is where
// it is disclosed, the way the Morpho form names Morpho and the curator.
export const BLEND_VENUE_NAME = "Aeras Vault I";

// Display names for the chains Blend is deployed on, for the column's note.
// Deposit *sources* are a much longer list (51 on 2026-09-14) and are not
// named here; only a chain a position can settle on needs a name.
const BLEND_CHAIN_NAMES: Readonly<Record<number, string>> = {
  1: "Ethereum",
  137: "Polygon",
  143: "Monad",
  999: "HyperEVM",
  3637: "Botanix",
  8453: "Base",
  42161: "Arbitrum",
  534352: "Scroll",
};

export function blendChainName(chainId: number): string {
  return BLEND_CHAIN_NAMES[chainId] ?? `chain ${chainId}`;
}

// One host serves both API surfaces: `/extern/fe` (publishable key plus SIWE
// bearer, called by the browser SDK) and `/extern/svr/{accountTypeId}`
// (server API key, called only from our route handlers).
export const BLEND_API_BASE_URL = "https://api.portal.blend.money";

// The chain the app deposits from and withdraws to. Monad, because the
// Solana <-> Monad USDC legs in lib/morpho/fund.ts already exist and are
// verified, and the embedded wallet already knows the chain. Where the
// position then settles is Blend's decision (fact 2 above).
export const BLEND_APP_CHAIN_ID = MONAD_CHAIN_ID;
export const BLEND_APP_USDC = MONAD_USDC;

// Publishable key, `pk_live_` plus 64 hex characters. Blend documents it as
// safe to embed: it identifies the account type and authorises nothing on its
// own (every write also needs the user's SIWE bearer). Read here rather than
// inline so a missing key fails with a sentence instead of a 401.
export function blendPublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_BLEND_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_BLEND_PUBLISHABLE_KEY is not set (portal: Accounts -> Aeras Earn -> Settings).",
    );
  }
  return key;
}

// ── chains the owner signs on ───────────────────────────────────────────────
//
// A deposit is signed on Monad, the origin. A withdrawal is one transaction
// per chain the position sits on: the owner calls the Safe's own
// `execTransaction` there (lib/blend/safe.ts) and pays that chain's gas. So
// these are the chains the app can drive a Safe on, and every one of them is
// in Privy's supportedChains (lib/privy/provider.tsx). Blend also deploys on
// Arbitrum, Polygon, Scroll, HyperEVM and Botanix; a position on one of
// those would need the chain added in both places before it could be
// withdrawn from here.
export const BLEND_SIGNING_CHAIN_IDS: readonly number[] = [1, 143, 8453];
