// Morpho Blue on Ethereum: borrow USDT against tokenized gold.
//
// This is a different Morpho product from the Monad earn venue in ./vaults.ts,
// and the distinction is the thing to hold onto. Those are ERC-4626 *vaults*:
// you deposit USDC and earn the vault's yield. This is a Morpho Blue *market*:
// an isolated pair with one collateral (XAUt) and one loan asset (USDT), no
// curator, no allocations, no shares to hold. Both are "Morpho", they share no
// contract and no math.
//
// The consequence that matters to a user: **collateral in a Blue market earns
// nothing.** XAUt supplied here is inert. It buys borrowing power and nothing
// else. The 4%-ish supply APY on Morpho's own market page belongs to USDT
// suppliers, who are a different party. Any UI built on this must not present
// supplying gold as an earn action.
//
// See CLAUDE.md "Chain Assumptions". This is the second venue where a position
// settles off Solana, and unlike Morpho-on-Monad the chain is Ethereum, so
// every action costs real ETH gas. lib/morpho/gold-fund.ts is where that is
// dealt with.
//
// Everything below is verified on-chain by scripts/morpho-gold-check.mts, which
// reads the market params straight out of the Morpho Blue singleton rather than
// trusting the indexer or this file. Market parameters are immutable once
// created, so drift here means a typo, not a governance change.

// ── chain ──────────────────────────────────────────────────────────────────

// Ethereum mainnet. Already declared in lib/privy/provider.tsx `supportedChains`
// (as viem's `mainnet`, and the default chain), so the embedded wallet can sign
// here with no provider change.
export const ETHEREUM_CHAIN_ID = 1;

// Read-only JSON-RPC for market state, position reads and gas pricing.
// Server-only, so no NEXT_PUBLIC_ prefix. CLAUDE.md says there is no EVM RPC of
// our own, and that held while Trustware covered every EVM read we needed: its
// /sdk/rpc/evm surface proxies ERC-20 allowances only. Reading a Morpho Blue
// market needs a general eth_call, which that proxy does not serve, so this is
// the second read-only endpoint after MONAD_RPC_URL and follows the same shape:
// public fallback, paid endpoint droppable via env with no code change.
export const ETHEREUM_RPC_URL =
  process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com";

export const ETHEREUM_EXPLORER_TX_BASE = "https://etherscan.io/tx/";

// Trustware's sentinel for native ETH as a route destination.
//
// **This is the 0xEeee... alias, not the zero address**, which is the reverse
// of Monad. MONAD_NATIVE_TOKEN is the zero address and the alias also quotes
// there; on Ethereum the zero address returns a 502 from the route solver and
// only the alias quotes. Measured 2026-08-26: 20 USDC from Solana delivered
// 0.007778 ETH via the alias, and the identical request with the zero address
// failed twice. Do not "tidy" these two constants into one.
export const ETHEREUM_NATIVE_TOKEN =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// ── tokens ─────────────────────────────────────────────────────────────────

// Tether Gold. One token is one troy ounce of allocated London Good Delivery
// gold, so it marks around $4,600, not around a share price.
//
// **6 decimals, not 18.** Every other ERC-20 in this app's Ethereum surface
// (the Ondo tokens, the xStocks) is 18, and gold tokens are the exception that
// breaks the habit. Cross-checked in both directions against live Trustware
// quotes on 2026-08-26, the discipline lib/trustware/swap-tokens.ts uses:
// 500 USDC bought 107,927 atomic units and 100,000 atomic units sold for
// $461.91, which implies ~$4,615/oz both ways. At 18 decimals the implied price
// would be wrong by 10^12.
export const XAUT = {
  symbol: "XAUt" as const,
  name: "Tether Gold",
  address: "0x68749665FF8D2d112Fa859AA293F07A622782F38",
  decimals: 6,
} as const;

// Tether USD on Ethereum, the loan asset.
//
// USDT is the ERC-20 that does not follow the ERC-20 spec, in two ways that
// both bite here. It returns no bool from `approve` and `transfer`, and it
// reverts outright on any approve that moves a non-zero allowance to a
// different non-zero value. lib/morpho/gold-borrow.ts resets the allowance to
// zero before re-approving for exactly that reason.
export const USDT = {
  symbol: "USDT" as const,
  name: "Tether USD",
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  decimals: 6,
} as const;

// ── the market ─────────────────────────────────────────────────────────────

// The Morpho Blue singleton on Ethereum. One contract holds every market;
// a market is addressed by its id, not by its own address.
export const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// Morpho's fixed scale for oracle prices. An oracle reports
// `collateralPrice * 10^(36 + loanDecimals - collateralDecimals)`, which for a
// 6-decimal collateral against a 6-decimal loan is a plain 1e36. Never assume
// the exponent from this market and reuse it for another pair.
export const ORACLE_PRICE_SCALE = 10n ** 36n;

// Morpho's fixed-point unit. LLTV, the borrow rate and the market fee are all
// WAD-scaled.
export const WAD = 10n ** 18n;

// The market parameters. These five values ARE the market: Morpho derives the
// market id by hashing them, so a single wrong byte addresses a market that
// does not exist rather than the wrong one, and every call reverts. That is a
// safe failure mode, which is why they are carried literally rather than
// resolved from the indexer at runtime.
export interface MorphoBlueMarket {
  // keccak256 of the abi-encoded params below. Morpho calls this the Id.
  id: string;
  // Display name, as Morpho lists it.
  name: string;
  chainId: number;
  loanToken: typeof USDT;
  collateralToken: typeof XAUT;
  oracle: string;
  irm: string;
  // Liquidation loan-to-value, WAD-scaled. 0.77e18 = 77%.
  lltv: bigint;
  // Whether Morpho lists the market in its own curated set. Five XAUt markets
  // exist on Ethereum and only two are listed; the unlisted ones hold a few
  // dollars of liquidity and would strand a borrower. Unlisted markets are not
  // in this registry at all, and the flag stays so an addition has to be a
  // deliberate one.
  listed: boolean;
}

// The single market we offer. XAUt collateral, USDT loan, 77% LLTV.
//
// Chosen over the four other Ethereum XAUt markets on liquidity, which is the
// only thing that decides whether a borrow actually executes. Measured from the
// indexer on 2026-08-26:
//
//   loan   listed  supply        borrowable now
//   USDT   yes     $2.66M        $322k
//   tGBP   yes     $86.6k        $8.8k
//   USDR   no      $0.40         $0.40
//   USDQ   no      $1.04         $1.04
//   USDC   no      $0            $0
//
// The USDC market is the tempting one, because USDC is what the rest of the app
// speaks, and it is empty: 86% LLTV and nothing to borrow. Borrowing USDT and
// converting is the working path, and Trustware routes USDT on Ethereum to USDC
// on Solana at about 0.3% (measured the same day), so the loan comes home.
export const XAUT_USDT_MARKET: MorphoBlueMarket = {
  id: "0xb7843fe78e7e7fd3106a1b939645367967d1f986c2e45edb8932ad1896450877",
  name: "XAUt / USDT",
  chainId: ETHEREUM_CHAIN_ID,
  loanToken: USDT,
  collateralToken: XAUT,
  oracle: "0xc7d1FE3fBe90e8f755250CA3Ce4d2aE50873d9dc",
  irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
  lltv: 770_000_000_000_000_000n,
  listed: true,
};

export const GOLD_MARKETS: readonly MorphoBlueMarket[] = [XAUT_USDT_MARKET];

export function goldMarketById(id: string): MorphoBlueMarket | undefined {
  const needle = id.toLowerCase();
  return GOLD_MARKETS.find((m) => m.id.toLowerCase() === needle);
}

// The params tuple in the order Morpho Blue's ABI expects. Every write call
// takes this struct, so building it in one place keeps field order from
// drifting between callers; a transposed oracle and irm would still encode and
// would revert on-chain rather than doing something wrong, but only after the
// user had signed.
export function marketParamsTuple(market: MorphoBlueMarket) {
  return {
    loanToken: market.loanToken.address as `0x${string}`,
    collateralToken: market.collateralToken.address as `0x${string}`,
    oracle: market.oracle as `0x${string}`,
    irm: market.irm as `0x${string}`,
    lltv: market.lltv,
  } as const;
}
