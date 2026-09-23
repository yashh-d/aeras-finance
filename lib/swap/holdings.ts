// What the wallet holds, in the swap registry's terms.
//
// The wallet panel already reads every balance the Swap sheet can spend: the
// Solana account balances, the cross-chain stable and native scans, and the
// Monad balances from the EVM wallet. This joins them to SWAP_TOKENS so the
// sheet's From list is "what you have", with the exact atomic balance behind
// Max. A registry token the scans do not read (Solana USDT, Wormhole ETH and
// WBTC, BNB Chain's USDT and BTCB) is not offered as a source; it is still a
// destination.

import type { MonadBalances } from "@/lib/morpho/use-monad-balances";
import type { AccountBalances } from "@/lib/solana/balances";
import { TRUSTWARE_SOLANA_CHAIN } from "@/lib/trustware/constants";
import type { NativeHolding } from "@/lib/trustware/native";
import type { StableHolding } from "@/lib/trustware/stables";
import { swapTokenById, type SwapToken } from "@/lib/trustware/swap-tokens";

export interface SwapHolding {
  token: SwapToken;
  balanceAtomic: string;
}

const SOL = `${TRUSTWARE_SOLANA_CHAIN}:SOL`;
const SOLANA_USDC = `${TRUSTWARE_SOLANA_CHAIN}:USDC`;
const SOLANA_XAUT0 = `${TRUSTWARE_SOLANA_CHAIN}:XAUt0`;

export function buildSwapHoldings(args: {
  balances: AccountBalances | null;
  stables: StableHolding[];
  native: NativeHolding[];
  monad: MonadBalances | null;
}): SwapHolding[] {
  const out: SwapHolding[] = [];
  const add = (id: string, balanceAtomic: string | undefined) => {
    const token = swapTokenById(id);
    if (!token || !balanceAtomic) return;
    if (BigInt(balanceAtomic) <= 0n) return;
    out.push({ token, balanceAtomic });
  };

  const b = args.balances;
  if (b) {
    add(SOLANA_USDC, b.usdcAtomic);
    // SOL is held as a float; the sheet's Max keeps a fee reserve anyway.
    add(SOL, BigInt(Math.floor(b.sol * 1e9)).toString());
    const xaut0 = swapTokenById(SOLANA_XAUT0);
    if (xaut0) add(SOLANA_XAUT0, b.xstocksAtomic[xaut0.address]);
  }
  for (const s of args.stables) add(`${s.chain}:USDC`, s.balanceAtomic);
  for (const n of args.native) add(`${n.chain}:${n.symbol}`, n.balanceAtomic);
  if (args.monad) {
    add("143:USDC", args.monad.usdcAtomic);
    add("143:MON", args.monad.monAtomic);
  }
  return out;
}
