// Ondo collateral tokens sitting in the user's own Ethereum wallet.
//
// These arrive there one way: withdrawing from Ondo Perps. They are ordinary
// ERC-20s the user owns outright, and until this selector existed they were
// invisible in the app.
//
// **Why they need their own selector rather than joining the equivalents.**
// `selectHeldEquivalents` filters every cross-chain balance through
// `findEquivalentSource`, which resolves against `EQUIVALENCE` in
// lib/trustware/equivalents.ts. Every entry there is constructed by
// `vaultFor(underlying)`, which throws when the underlying has no Jupiter Lend
// borrow vault, and only TSLA, SPY, QQQ and NVDA have one. That registry exists
// to answer "what can I convert into collateral I can borrow against", and a
// withdrawn SPCXon is simply not that question. Adding SPCX to it would throw
// at module load.
//
// So the two are kept apart. This one answers "what did a withdrawal leave in
// my wallet", the set is Ondo's own eight margin tokens, and nothing about it
// implies the holding can be lent.
//
// Ethereum only, because that is the only network Ondo credits or returns on.

import { ONDO_MARGIN_TOKENS } from "@/lib/ondo/collateral";

import type { TrustwareBalancesResponse } from "./types";

const ETHEREUM_CHAIN = "1";

// Contract address (lowercased) -> Ondo's symbol for it. Built from the same
// fixed registry the Trustware proxy allowlist uses, so a token cannot appear
// here that the proxy would refuse to route.
const BY_CONTRACT = new Map(
  Object.entries(ONDO_MARGIN_TOKENS).map(([symbol, address]) => [
    address.toLowerCase(),
    symbol,
  ]),
);

export interface OndoWalletHolding {
  symbol: string;
  contractAddress: string;
  decimals: number;
  balanceAtomic: string;
}

export function selectOndoHoldings(
  res: TrustwareBalancesResponse,
): OndoWalletHolding[] {
  const out: OndoWalletHolding[] = [];

  for (const result of res.results ?? []) {
    if (result.chain_id !== ETHEREUM_CHAIN) continue;

    for (const balance of result.balances ?? []) {
      if (!balance.contract) continue;
      if (!balance.balance || balance.balance === "0") continue;

      const symbol = BY_CONTRACT.get(balance.contract.toLowerCase());
      if (!symbol) continue;

      // USDC is excluded deliberately. It is already reported by the stables
      // selector and shown as one balance across chains, so surfacing it again
      // here would double-count it in the wallet total.
      if (symbol === "USDC") continue;

      out.push({
        symbol,
        contractAddress: balance.contract,
        // Every Ondo equity token is 18 decimals, but the upstream figure is
        // preferred where present: a wrong scale here is an error of orders of
        // magnitude in a displayed balance.
        decimals: typeof balance.decimals === "number" ? balance.decimals : 18,
        balanceAtomic: balance.balance,
      });
    }
  }

  return out;
}

export function ondoHoldingUiAmount(holding: OndoWalletHolding): number {
  return Number(holding.balanceAtomic) / 10 ** holding.decimals;
}
