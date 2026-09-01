// What a user can pay with when buying an asset on the Markets tab.
//
// The buy ticket used to offer exactly USDC and SOL. That is not what a wallet
// holds: the same account can be carrying TSLAx, gold, and USDC on Ethereum,
// and none of it could buy anything. Worse, the USDC case was actively
// misleading, because "3.57 USDC available" is true of the Solana balance while
// the account holds another $29.90 of the same token one chain away.
//
// Two kinds of source, and the difference is the whole design:
//
//   solana     Already on Solana. Jupiter Ultra routes any Solana mint into any
//              other, so this is one swap and one signature. SOL, USDC, and
//              every catalog asset the wallet holds qualify.
//
//   bridged    On another chain. Trustware settles it to the user's own Solana
//              wallet as USDC first, and the Jupiter swap then runs exactly as
//              it would have. Two legs, two confirmations, and gas on the
//              source chain, which is why it is labelled rather than hidden.
//
// The split is not cosmetic. A bridged buy cannot be atomic, it costs gas the
// embedded EVM wallet may not hold, and it leaves the funds resting as Solana
// USDC if the second leg is abandoned. That is a safe intermediate state, not a
// stranding, but the ticket has to say so before it starts.
//
// Pure over balances the caller already has, so no extra upstream read and the
// list can be exercised without a wallet.

import type { AccountBalances } from "@/lib/solana/balances";
import { atomicToUiString } from "@/lib/solana/balances";
import type { StableHolding } from "@/lib/trustware/stables";
import { stableUiAmount } from "@/lib/trustware/stables";
import { tokenLogoBySymbol } from "@/lib/tokens/logos";

import { SOL_DECIMALS, SOL_MINT, USDC_DECIMALS, USDC_MINT } from "./constants";
import { XSTOCKS } from "./xstocks";

export type PayAssetKind = "solana" | "bridged";

export interface PayAsset {
  // Stable across refreshes so a selection survives the balances reloading.
  id: string;
  kind: PayAssetKind;
  symbol: string;
  chainLabel: string;
  decimals: number;
  // Lossless. Max fills this rather than a rounded display figure, which for a
  // high-decimal mint rounds UP and asks for more than the wallet holds.
  balanceExact: string;
  balance: number;
  // Null when nothing prices it, which only costs the ticket its USD hint.
  priceUsd: number | null;
  balanceUsd: number | null;
  logo?: string;

  // Solana sources only: the mint Jupiter swaps from.
  mint?: string;
  // Bridged sources only: where it lives and what it is.
  chain?: string;
  contract?: string;
}

export interface PayAssetInput {
  balances: AccountBalances | null;
  // USD price per Solana mint.
  priceUsdByMint: Record<string, number | undefined>;
  // USDC held off Solana, from the shared wallet scan.
  stables: StableHolding[];
  // The asset being bought. It is never offered as a way to pay for itself.
  buyingMint: string;
}

// Dust floor. Below this a row is noise: it cannot clear Jupiter's $5 minimum
// and it pushes the assets that can below the fold.
const MIN_PAY_USD = 0.01;

export function payAssets(input: PayAssetInput): PayAsset[] {
  const { balances } = input;
  const out: PayAsset[] = [];
  if (!balances) return out;

  // USDC on Solana first. It is the quote currency of every market here, it
  // needs no conversion, and it is what someone means by "cash".
  const usdcUi = atomicToUiString(balances.usdcAtomic, USDC_DECIMALS);
  out.push({
    id: "solana:usdc",
    kind: "solana",
    symbol: "USDC",
    chainLabel: "Solana",
    decimals: USDC_DECIMALS,
    balanceExact: usdcUi,
    balance: Number(usdcUi),
    priceUsd: 1,
    balanceUsd: Number(usdcUi),
    logo: tokenLogoBySymbol("USDC"),
    mint: USDC_MINT,
  });

  // SOL second, and always shown even at zero: it is the wallet's native asset
  // and its absence from the list would read as a missing feature rather than
  // an empty balance.
  const solPrice = input.priceUsdByMint[SOL_MINT] ?? null;
  out.push({
    id: "solana:sol",
    kind: "solana",
    symbol: "SOL",
    chainLabel: "Solana",
    decimals: SOL_DECIMALS,
    // SOL carries no stored atomic figure, so full precision on the float is
    // the most exact form available.
    balanceExact: String(balances.sol),
    balance: balances.sol,
    priceUsd: solPrice,
    balanceUsd: solPrice === null ? null : balances.sol * solPrice,
    logo: tokenLogoBySymbol("SOL"),
    mint: SOL_MINT,
  });

  // Everything else in the catalog the wallet actually holds: other xStocks,
  // and the gold tokens. Selling one asset to buy another is a single Jupiter
  // route, so there is no reason to make the user do it in two trips through
  // USDC.
  for (const x of XSTOCKS) {
    if (x.mint === input.buyingMint) continue;
    const atomic = balances.xstocksAtomic[x.mint];
    if (!atomic || BigInt(atomic) <= 0n) continue;

    const exact = atomicToUiString(atomic, x.decimals);
    const price = input.priceUsdByMint[x.mint] ?? null;
    const balance = Number(exact);
    const balanceUsd = price === null ? null : balance * price;
    if (balanceUsd !== null && balanceUsd < MIN_PAY_USD) continue;

    out.push({
      id: `solana:${x.mint}`,
      kind: "solana",
      symbol: x.symbol,
      chainLabel: "Solana",
      decimals: x.decimals,
      balanceExact: exact,
      balance,
      priceUsd: price,
      balanceUsd,
      logo: x.logo,
      mint: x.mint,
    });
  }

  // USDC on the other chains the wallet holds it on. Trustware brings it to
  // Solana and the swap runs from there.
  for (const stable of input.stables) {
    const amount = stableUiAmount(stable);
    if (amount < MIN_PAY_USD) continue;
    out.push({
      id: `bridged:${stable.chain}:${stable.contract}`,
      kind: "bridged",
      symbol: stable.symbol,
      chainLabel: stable.chainLabel,
      decimals: stable.decimals,
      balanceExact: amount.toFixed(stable.decimals),
      balance: amount,
      priceUsd: 1,
      balanceUsd: amount,
      logo: tokenLogoBySymbol("USDC"),
      chain: stable.chain,
      contract: stable.contract,
    });
  }

  return out;
}

// The one to offer by default.
//
// Solana USDC whenever there is any, because it is the quote currency, it needs
// no conversion, and it is what someone means by paying cash. Otherwise the
// largest Solana holding, which keeps the common case to one signature.
//
// SOL is deliberately last, chosen only when it is the sole option. It is the
// wallet's gas: a default that spends it to buy a stock can leave an account
// that cannot sign the transaction to sell that stock again. Picking it is
// fine, defaulting to it is not.
export function bestPayAsset(assets: PayAsset[]): PayAsset | undefined {
  const usdc = assets.find((a) => a.id === "solana:usdc");
  if (usdc && usdc.balance > 0) return usdc;

  const onSolana = assets
    .filter(
      (a) => a.kind === "solana" && a.mint !== SOL_MINT && (a.balanceUsd ?? 0) > 0,
    )
    .sort((a, b) => (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0));
  if (onSolana[0]) return onSolana[0];

  const bridged = assets
    .filter((a) => a.kind === "bridged" && (a.balanceUsd ?? 0) > 0)
    .sort((a, b) => (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0));

  return bridged[0] ?? usdc ?? assets[0];
}
