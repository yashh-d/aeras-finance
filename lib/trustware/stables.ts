// USDC the user holds on the EVM chains this app can sign for.
//
// Sibling of native.ts, and it exists for the same reason: the balance scan
// covers 129 chains and the answer has to be narrowed to what the user can
// actually act on. Only Ethereum and BNB Chain are read, because those are the
// two chains in Privy's supportedChains, and execute.ts fails loudly rather than
// signing on an undeclared chain.
//
// Matching is by contract address, never by symbol. The scan surfaces spam
// tokens, and a token calling itself USDC is not one; paying a bridge from the
// wrong contract is unrecoverable.
//
// Decimals are pinned per chain because they genuinely differ. Ethereum USDC is
// 6 decimals, Binance-peg USDC on BNB Chain is 18. Both verified against
// Trustware's own token registry on 2026-08-16. Assuming 6 everywhere would
// misread a BNB balance by a factor of a trillion.

import type { TrustwareBalancesResponse } from "./types";

export interface StableHolding {
  chain: string;
  chainLabel: string;
  symbol: string;
  decimals: number;
  balanceAtomic: string;
  contract: string;
}

interface StableEntry {
  chainLabel: string;
  contract: string;
  decimals: number;
}

const USDC_BY_CHAIN: Record<string, StableEntry> = {
  "1": {
    chainLabel: "Ethereum",
    contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    decimals: 6,
  },
  "56": {
    chainLabel: "BNB Chain",
    contract: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    decimals: 18,
  },
};

export function selectStableHoldings(
  res: TrustwareBalancesResponse,
): StableHolding[] {
  const out: StableHolding[] = [];
  for (const result of res.results ?? []) {
    const chain = result.chain_id;
    if (!chain) continue;
    const entry = USDC_BY_CHAIN[chain];
    if (!entry) continue;

    for (const balance of result.balances ?? []) {
      const contract = balance.contract?.toLowerCase();
      if (contract !== entry.contract) continue;
      if (!balance.balance || balance.balance === "0") continue;

      out.push({
        chain,
        chainLabel: entry.chainLabel,
        symbol: "USDC",
        // The registry decimals win over whatever the scan reports. A wrong
        // value here sizes a bridge, so it is not taken on trust from a payload.
        decimals: entry.decimals,
        balanceAtomic: balance.balance,
        contract: entry.contract,
      });
    }
  }
  return out;
}

export function stableUiAmount(holding: StableHolding): number {
  return Number(holding.balanceAtomic) / 10 ** holding.decimals;
}
