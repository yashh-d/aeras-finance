// Solana tokens the wallet can receive that are not in the tradable xStock
// catalog.
//
// These are Ondo's natively-issued Solana equities. They are the same
// underlying as a Backed xStock but a different mint, so nothing in the app
// trades or deposits them directly. Before this list existed they were simply
// invisible: a user who received TSLAon saw their balance unchanged and had no
// way to tell the transfer had landed. Showing them is display only. Converting
// one into its xStock is the borrow flow's job, via lib/trustware/equivalents.
//
// The convertible entries are derived from the conversion registry rather than
// re-listed, so a mint can never be shown here as convertible while the borrow
// planner disagrees.

import { xstockByMint } from "@/lib/jupiter/xstocks";
import { EQUIVALENCE } from "@/lib/trustware/equivalents";

export interface EquivalentToken {
  symbol: string;
  // Underlying company or index, for the row sublabel.
  name: string;
  mint: string;
  decimals: number;
  logo?: string;
  // Whether the borrow flow can convert this into a tradable xStock. False
  // means we can show the balance and nothing else.
  convertible: boolean;
  // The Backed xStock this represents the same equity as. Balances group by it,
  // so a wallet holding TSLAx and TSLAon reads as one Tesla position.
  xstockMint: string;
}

// Ondo's Solana mints that Trustware can route. Name and logo come from the
// xStock the conversion lands in, since both represent the same equity.
const CONVERTIBLE: EquivalentToken[] = EQUIVALENCE.flatMap((entry) => {
  const target = xstockByMint(entry.vault.collateralMint);
  return entry.sources
    .filter((s) => s.kind === "solana")
    .map((s) => ({
      symbol: s.symbol,
      name: target?.name ?? entry.underlying,
      mint: s.token,
      decimals: s.decimals,
      logo: target?.logo,
      convertible: true,
      xstockMint: entry.vault.collateralMint,
    }));
});

// Held out of the conversion registry because Trustware has no live route for
// it (verified 2026-08-05, see lib/trustware/equivalents.ts). Listed here anyway
// so the balance is visible rather than silently dropped.
const QQQON: EquivalentToken = {
  symbol: "QQQon",
  name: "Nasdaq 100",
  mint: "HrYNm6jTQ71LoFphjVKBTdAE4uja7WsmLG8VxB8ondo",
  decimals: 9,
  logo: "/logos/qqq.png",
  convertible: false,
  xstockMint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
};

export const SOLANA_EQUIVALENT_TOKENS: readonly EquivalentToken[] = [
  ...CONVERTIBLE,
  QQQON,
];

export function equivalentTokenByMint(
  mint: string,
): EquivalentToken | undefined {
  return SOLANA_EQUIVALENT_TOKENS.find((t) => t.mint === mint);
}
