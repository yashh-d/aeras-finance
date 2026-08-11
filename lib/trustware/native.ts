// Native chain assets the user holds on the EVM chains this app supports.
//
// Trustware's balance scan covers 129 chains, most of them with a zero balance
// and some with spam tokens carrying absurd amounts. Only Ethereum and BNB
// Chain are shown: they are the chains Privy will sign on and the ones the
// conversion registry covers, so anything else is noise the user cannot act on.
//
// Gas matters here. Converting an EVM holding into Solana collateral costs an
// approval plus a route transaction, both paid in the chain's native token, and
// a wallet holding the stock but no gas cannot start.

import type { TrustwareBalancesResponse } from "./types";

export interface NativeHolding {
  chain: string;
  chainLabel: string;
  symbol: string;
  decimals: number;
  balanceAtomic: string;
  // Coingecko id, so the price route can quote it.
  priceId: string;
}

const NATIVE_CHAINS: Record<
  string,
  { label: string; symbol: string; priceId: string }
> = {
  "1": { label: "Ethereum", symbol: "ETH", priceId: "ethereum" },
  "56": { label: "BNB Chain", symbol: "BNB", priceId: "binancecoin" },
};

export function selectNativeHoldings(
  res: TrustwareBalancesResponse,
): NativeHolding[] {
  const out: NativeHolding[] = [];
  for (const result of res.results ?? []) {
    const chain = result.chain_id;
    if (!chain) continue;
    const meta = NATIVE_CHAINS[chain];
    if (!meta) continue;
    for (const balance of result.balances ?? []) {
      // The native asset is the one with no contract address.
      if (balance.contract) continue;
      if (!balance.balance || balance.balance === "0") continue;
      out.push({
        chain,
        chainLabel: meta.label,
        symbol: balance.symbol ?? meta.symbol,
        decimals: typeof balance.decimals === "number" ? balance.decimals : 18,
        balanceAtomic: balance.balance,
        priceId: meta.priceId,
      });
    }
  }
  return out;
}

export function nativeUiAmount(holding: NativeHolding): number {
  return Number(holding.balanceAtomic) / 10 ** holding.decimals;
}
