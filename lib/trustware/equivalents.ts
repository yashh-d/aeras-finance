// Equivalence registry: which same-underlying tokenized-stock representations on
// other chains map to a canonical Solana xStock that Jupiter Lend accepts.
//
// Scope is deliberately narrow: only 1:1 equivalents from the Ondo and Backed
// xStock issuers, for the four underlyings that have Jupiter Lend borrow vaults
// (TSLA, SPY, QQQ, NVDA). Leveraged/inverse products (TQQQ, SQQQ, 2x/3x/5x),
// Mirror/Stablestock synthetics, and Backed bTokens are intentionally excluded:
// they are not the same asset and must never be treated as convertible.
//
// Destinations are not re-hardcoded here; they come from XSTOCK_BORROW_VAULTS so
// there is a single source of truth for the vault collateral mints.
//
// Source addresses were pulled from Trustware's live token registry
// (GET /api/v1/routes/tokens). Listing proves the token exists, not that a live
// route to the Solana xStock is available; routability is confirmed lazily at
// quote time via /api/trustware/quote.

import { XSTOCK_BORROW_VAULTS, type XStockBorrowVault } from "@/lib/jupiter/borrow";

export type EquivalentIssuer = "ondo" | "xstock";

export interface EquivalentSource {
  issuer: EquivalentIssuer;
  // Trustware chainId. Numeric string for EVM chains.
  chain: string;
  chainLabel: string;
  // Contract address, lowercased for case-insensitive matching.
  token: string;
  decimals: number;
  symbol: string;
}

const UNDERLYING_TO_XSTOCK = {
  TSLA: "TSLAx",
  SPY: "SPYx",
  QQQ: "QQQx",
  NVDA: "NVDAx",
} as const;

export type Underlying = keyof typeof UNDERLYING_TO_XSTOCK;

export interface EquivalenceEntry {
  underlying: Underlying;
  // The Jupiter Lend vault whose collateralMint is the conversion destination.
  vault: XStockBorrowVault;
  sources: EquivalentSource[];
}

const CHAIN_LABELS: Record<string, string> = {
  "1": "Ethereum",
  "56": "BNB Chain",
};

// Held out until Trustware has live routes. These tokens exist in the registry
// but /quote returns "chain support under maintenance" as of 2026-07-29, so
// including them would let a user deposit on a chain we cannot convert from.
// Re-add (with a fresh routability check) once routes are live:
//   HyperEVM (999):  TSLAon 0x417883b1709545f1211a25b00ad13455fc7f1bc5
//                    SPYon  0x32ec2792aec02122edd9f28866b720db1e1c1b54
//                    QQQon  0x911e2dcd2b70f44231f3f0f1c6ec9af75068fd85
//                    NVDAon 0xb989ad9b91886b1aaed8daadb26f028b29b40945
//                    xStocks TSLAx/SPYx/QQQx/NVDAx share the mainnet addresses below.
//   Arbitrum (42161): TSLAon 0xb298bc2fac7aeda17fe0812323a98e6278a91557

// Every EVM Ondo/xStock token observed is 18 decimals.
const EVM_DECIMALS = 18;

function s(
  issuer: EquivalentIssuer,
  chain: string,
  symbol: string,
  token: string,
): EquivalentSource {
  return {
    issuer,
    chain,
    chainLabel: CHAIN_LABELS[chain] ?? chain,
    token: token.toLowerCase(),
    decimals: EVM_DECIMALS,
    symbol,
  };
}

function vaultFor(underlying: Underlying): XStockBorrowVault {
  const symbol = UNDERLYING_TO_XSTOCK[underlying];
  const vault = XSTOCK_BORROW_VAULTS.find((v) => v.collateralSymbol === symbol);
  if (!vault) {
    throw new Error(`No Jupiter Lend vault for ${symbol}`);
  }
  return vault;
}

export const EQUIVALENCE: readonly EquivalenceEntry[] = [
  {
    underlying: "TSLA",
    vault: vaultFor("TSLA"),
    sources: [
      s("ondo", "1", "TSLAon", "0xf6b1117ec07684d3958cad8beb1b302bfd21103f"),
      s("xstock", "1", "TSLAx", "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0"),
      s("ondo", "56", "TSLAon", "0x2494b603319d4d9f9715c9f4496d9e0364b59d93"),
      s("xstock", "56", "TSLAx", "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0"),
    ],
  },
  {
    underlying: "SPY",
    vault: vaultFor("SPY"),
    sources: [
      s("ondo", "1", "SPYon", "0xfedc5f4a6c38211c1338aa411018dfaf26612c08"),
      s("xstock", "1", "SPYx", "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48"),
      s("ondo", "56", "SPYon", "0x6a708ead771238919d85930b5a0f10454e1c331a"),
      s("xstock", "56", "SPYx", "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48"),
    ],
  },
  {
    underlying: "QQQ",
    vault: vaultFor("QQQ"),
    sources: [
      s("ondo", "1", "QQQon", "0x0e397938c1aa0680954093495b70a9f5e2249aba"),
      s("xstock", "1", "QQQx", "0xa753a7395cae905cd615da0b82a53e0560f250af"),
      s("ondo", "56", "QQQon", "0x0cde6936d305d5b34667fc46425e852efd73559a"),
      s("xstock", "56", "QQQx", "0xa753a7395cae905cd615da0b82a53e0560f250af"),
    ],
  },
  {
    underlying: "NVDA",
    vault: vaultFor("NVDA"),
    sources: [
      s("ondo", "1", "NVDAon", "0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee"),
      s("xstock", "1", "NVDAx", "0xc845b2894dbddd03858fd2d643b4ef725fe0849d"),
      s("ondo", "56", "NVDAon", "0xa9ee28c80f960b889dfbd1902055218cba016f75"),
      s("xstock", "56", "NVDAx", "0xc845b2894dbddd03858fd2d643b4ef725fe0849d"),
    ],
  },
] as const;

export function equivalenceByUnderlying(
  underlying: Underlying,
): EquivalenceEntry | undefined {
  return EQUIVALENCE.find((e) => e.underlying === underlying);
}

// Look up a (chain, token) pair. Returns the matched source and the entry whose
// destination it converts into, or undefined if the pair is not a known
// convertible equivalent.
export function findEquivalentSource(
  chain: string,
  token: string,
): { entry: EquivalenceEntry; source: EquivalentSource } | undefined {
  const needle = token.toLowerCase();
  for (const entry of EQUIVALENCE) {
    const source = entry.sources.find(
      (src) => src.chain === chain && src.token === needle,
    );
    if (source) return { entry, source };
  }
  return undefined;
}

export function isConvertibleSource(chain: string, token: string): boolean {
  return findEquivalentSource(chain, token) !== undefined;
}

// Flat list of every convertible source, for the deposit-asset picker.
export function allEquivalentSources(): EquivalentSource[] {
  return EQUIVALENCE.flatMap((e) => e.sources);
}
