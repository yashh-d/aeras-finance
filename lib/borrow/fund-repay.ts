"use client";

// Fund a USDC repayment from everything the account actually holds.
//
// A repay spends Solana USDC, but the account's dollars can sit in three
// places: USDC on Solana (spends directly), SOL (swaps to USDC in one instant
// Jupiter hop), and USDC on Monad (bridges home through Trustware's return
// leg). This composes them: Monad contributes as much as it can guarantee,
// SOL covers the remainder, and nothing downstream runs until the Solana USDC
// account actually holds the target.
//
// Ordering: the SOL swap executes first because it settles in seconds, then
// the Monad leg bridges (minutes) and its arrival check waits for the combined
// total. ETH on Ethereum is deliberately not a source: mainnet gas plus bridge
// minimums eat a retail-sized balance, and draining the gas asset strands the
// wallet.

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  SOL_DECIMALS,
  SOL_MINT,
  USDC_DECIMALS,
  USDC_MINT,
} from "@/lib/jupiter/constants";
import {
  executeSolanaConversion,
  quoteSolanaConversion,
} from "@/lib/jupiter/convert";
import type { EvmSigner, MorphoTxProgress } from "@/lib/morpho/deposit";
import {
  fundSolanaUsdcFromMonad,
  maxReturnableUsdcAtomic,
  type SolanaSigner,
} from "@/lib/morpho/fund";
import { atomicToUi } from "@/lib/trustware/amounts";
import { awaitTokenBalance } from "@/lib/solana/await-balance";

// SOL held back for transaction fees. The repay itself and any swap each cost
// well under 0.001 SOL; 0.01 keeps the wallet operable afterwards.
const SOL_FEE_RESERVE = 0.01;

// Margin on the SOL leg's sizing, covering swap fees, the slippage floor, and
// price drift between quote and execution.
const SOL_SWAP_MARGIN_BPS = 300;

export interface RepayFundingSources {
  // USDC the Solana wallet already holds, UI units.
  direct: number;
  // What swapping spare SOL can guarantee, UI units. Zero without a price.
  fromSol: number;
  // What the Monad balance can guarantee after conversion costs, UI units.
  fromMonad: number;
  // Everything a repay can draw on.
  total: number;
}

// The ceiling a repay form should offer, and the per-source split for copy.
export function repayFundingSources(args: {
  solanaUsdc: number;
  sol: number;
  solPriceUsd: number | null;
  monadUsdcAtomic: string;
}): RepayFundingSources {
  const spareSol = Math.max(0, args.sol - SOL_FEE_RESERVE);
  const fromSol =
    args.solPriceUsd && args.solPriceUsd > 0
      ? spareSol * args.solPriceUsd * (1 - SOL_SWAP_MARGIN_BPS / 10_000)
      : 0;
  const fromMonad = Number(maxReturnableUsdcAtomic(args.monadUsdcAtomic)) / 1e6;
  return {
    direct: args.solanaUsdc,
    fromSol,
    fromMonad,
    total: args.solanaUsdc + fromSol + fromMonad,
  };
}

// Bring the Solana wallet's USDC up to `walletAtLeastAtomic`, drawing on the
// Monad balance first (it usually holds the bulk) and swapping SOL for the
// remainder. Throws with a readable reason when the sources cannot cover it;
// nothing is signed in that case.
export async function fundRepayUsdc(args: {
  walletAtLeastAtomic: bigint;
  solanaUsdcAtomic: string;
  sol: number;
  solPriceUsd: number | null;
  monadUsdcAtomic: string;
  monBalanceAtomic: string;
  // Required only when the Monad balance ends up contributing.
  evm: EvmSigner | undefined;
  solana: SolanaSigner;
  onProgress?: (p: MorphoTxProgress) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const report = (p: MorphoTxProgress) => args.onProgress?.(p);
  const usdc = BigInt(args.solanaUsdcAtomic || "0");
  const target = args.walletAtLeastAtomic;
  const shortfall = target - usdc;
  if (shortfall <= 0n) return;

  const monadCap = BigInt(maxReturnableUsdcAtomic(args.monadUsdcAtomic));
  const fromMonad = shortfall < monadCap ? shortfall : monadCap;
  const fromSolNeeded = shortfall - fromMonad;

  // The SOL leg runs first: it settles in seconds, so by the time the bridge
  // lands the swap's proceeds are long since spendable.
  let swappedMinAtomic = 0n;
  if (fromSolNeeded > 0n) {
    if (!args.solPriceUsd || args.solPriceUsd <= 0) {
      throw new Error("SOL price is unavailable, so the swap cannot be sized.");
    }
    const spareSol = Math.max(0, args.sol - SOL_FEE_RESERVE);
    const solNeededUi =
      (Number(fromSolNeeded) / 1e6 / args.solPriceUsd) *
      (1 + SOL_SWAP_MARGIN_BPS / 10_000);
    if (solNeededUi > spareSol) {
      throw new Error(
        `Your balances cannot cover this: about ${solNeededUi.toFixed(4)} SOL would need swapping and only ${spareSol.toFixed(4)} is spare after the fee reserve.`,
      );
    }
    report({ stage: "funding", message: "Swapping SOL for USDC." });
    const quote = await quoteSolanaConversion({
      inputMint: SOL_MINT,
      inputDecimals: SOL_DECIMALS,
      outputMint: USDC_MINT,
      outputDecimals: USDC_DECIMALS,
      amountAtomic: BigInt(Math.ceil(solNeededUi * 1e9)).toString(),
    });
    if (BigInt(quote.toAmountMinAtomic) < fromSolNeeded) {
      throw new Error(
        `The SOL swap guarantees only ${atomicToUi(quote.toAmountMinAtomic, USDC_DECIMALS)} USDC of the ${atomicToUi(fromSolNeeded.toString(), USDC_DECIMALS)} needed. Try again.`,
      );
    }
    await executeSolanaConversion({
      quote,
      userPublicKey: args.solana.address,
      signAndSendBase64: args.solana.signAndSendBase64,
    });
    swappedMinAtomic = BigInt(quote.toAmountMinAtomic);
  }

  if (fromMonad > 0n) {
    if (!args.evm) {
      throw new Error("No Monad wallet is available to fund this repay.");
    }
    // The swap's guaranteed minimum counts as already on Solana, so the bridge
    // is sized for exactly what Monad must contribute — and its arrival check
    // holds for the combined target.
    await fundSolanaUsdcFromMonad({
      walletAtLeastAtomic: target,
      solanaUsdcAtomic: (usdc + swappedMinAtomic).toString(),
      monadUsdcAtomic: args.monadUsdcAtomic,
      monBalanceAtomic: args.monBalanceAtomic,
      evm: args.evm,
      solanaAddress: args.solana.address,
      onProgress: args.onProgress,
      signal: args.signal,
    });
    return;
  }

  // Only the swap ran; confirm the account reflects it before the repay.
  report({ stage: "funding", message: "Confirming the Solana balance." });
  const finalBalance = await awaitTokenBalance({
    mint: USDC_MINT,
    owner: args.solana.address,
    atLeastAtomic: target.toString(),
    programId: TOKEN_PROGRAM_ID,
    timeoutMs: 30_000,
    signal: args.signal,
  });
  if (BigInt(finalBalance) < target) {
    throw new Error(
      "The swapped USDC has not appeared in the balance read yet. " +
        "Your funds are safe. Try again in a moment.",
    );
  }
}
