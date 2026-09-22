"use client";

// Deposit USDC into the user's Aeras Vault I account (Blend) from the
// embedded EVM wallet on Monad, funding that wallet from Solana USDC first
// when it is short.
//
// The sequence, each stage reported to the form:
//   1. Fund. lib/morpho/fund.ts brings the Monad wallet up to the deposit
//      amount in USDC and to the gas floor in MON from the Solana wallet,
//      through Trustware. Signs nothing when both already hold enough.
//   2. Sign in. SIWE with the embedded wallet (lib/blend/sdk.ts); silent.
//   3. Quote. Blend prices the deposit and says where it lands. Quoted after
//      funding, not before, because a quote lives about fifteen minutes
//      (measured 2026-09-21) and a bridge can take longer than that.
//   4. Guard. The fee is checked against the amount before anything is
//      signed. Blend's figure was $0.00006 on a 1 USDC deposit; a fee that is
//      a percent of the amount means the route is not the one that was
//      measured, and the session is cancelled instead of signed.
//   5. Execute. Blend locks the session, the wallet sends the plan (one
//      ERC-20 transfer of USDC from the EOA on Monad, no approval; verified
//      live) through lib/blend/execute.ts, Blend gets the hash and is polled
//      to settlement. Blend deploys the Safe at first deposit and pays for it.
//
// Where the deposit lands is Blend's decision (lib/blend/constants.ts, fact
// 2). The quote's destinationChainId is what the result reports; it was
// Monad when measured and nothing here assumes it.

import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import type { MorphoTxProgress } from "@/lib/morpho/deposit";
import { ensureMonadUsdc, type SolanaSigner } from "@/lib/morpho/fund";
import { atomicToUi } from "@/lib/trustware/amounts";

import {
  BLEND_APP_CHAIN_ID,
  BLEND_APP_USDC,
  BLEND_VENUE_NAME,
  blendChainName,
} from "./constants";
import { runBlendQuote, type EvmSigner } from "./execute";
import { loadBlendSdk, persistBlendSession } from "./sdk";

export type { SolanaSigner } from "@/lib/morpho/fund";

// The most of a deposit Blend may take in fees before the app refuses to
// sign. One percent: two orders of magnitude above the measured fee, so it
// never binds on the route that was verified and binds at once on any other.
const MAX_FEE_BPS = 100;

// The same stage vocabulary the Morpho form draws, so the two EVM earn forms
// report alike. "funding" is the Trustware leg, "switching" covers sign-in
// and pricing, "depositing" is the signature, "confirming" is Blend's
// settlement poll.
export type BlendTxProgress = MorphoTxProgress;
type Report = (p: BlendTxProgress) => void;

export interface BlendDepositResult {
  txHashes: { hash: string; chainId: number }[];
  originChainId: number;
  destinationChainId: number;
  feesUsd: number | null;
  // What Blend said it will credit, 6-decimal USDC atomic.
  outputAtomic: string;
  // Whether a Trustware leg ran first.
  funded: boolean;
}

export async function depositUsdcToBlend(args: {
  // 6-decimal atomic.
  amountAtomic: bigint;
  monadUsdcAtomic: string;
  solanaUsdcAtomic: string;
  monBalanceAtomic: string;
  evm: EvmSigner;
  // Required only when funding is needed; the plan reports a readable reason
  // when it is missing.
  solana: SolanaSigner | undefined;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<BlendDepositResult> {
  const report: Report = (p) => args.onProgress?.(p);
  if (args.amountAtomic <= 0n) throw new Error("Enter an amount to deposit.");
  const address = args.evm.address;
  if (!address) throw new Error("No embedded EVM wallet available.");

  const { funded } = await ensureMonadUsdc({
    usdcAtLeastAtomic: args.amountAtomic,
    monadUsdcAtomic: args.monadUsdcAtomic,
    solanaUsdcAtomic: args.solanaUsdcAtomic,
    monBalanceAtomic: args.monBalanceAtomic,
    evmAddress: address,
    solana: args.solana,
    onProgress: args.onProgress,
    signal: args.signal,
  });

  report({ stage: "switching", message: `Signing in to ${BLEND_VENUE_NAME}.` });
  const { sdk } = await loadBlendSdk(args.evm);

  report({ stage: "switching", message: "Pricing the deposit." });
  const quote = await sdk.quoteDeposit(
    {
      chainId: BLEND_APP_CHAIN_ID,
      tokenAddress: BLEND_APP_USDC.address,
      amount: args.amountAtomic.toString(),
      // One open session per account. A quote left behind by a closed tab or
      // a failed attempt would otherwise block this one.
      forceReset: true,
    },
    { signal: args.signal },
  );

  const feesUsd = finite(quote.fees.totalUsd);
  const inputUsd = finite(quote.input.amountUsd);
  if (
    feesUsd !== null &&
    inputUsd !== null &&
    inputUsd > 0 &&
    feesUsd * 10_000 > inputUsd * MAX_FEE_BPS
  ) {
    await cancelQuietly(sdk, quote.intentId);
    throw new Error(
      `Blend quoted $${feesUsd.toFixed(2)} in fees on a $${inputUsd.toFixed(2)} deposit. Nothing was signed. Try again later.`,
    );
  }

  const destination = blendChainName(quote.destinationChainId);
  const where =
    quote.destinationChainId === quote.originChainId
      ? `on ${destination}`
      : `to ${destination}`;
  const amountUi = atomicToUi(quote.input.amount, USDC_DECIMALS);
  report({ stage: "depositing", message: `Depositing ${amountUi} USDC ${where}.` });

  const result = await runBlendQuote({
    sdk,
    quote,
    evm: args.evm,
    report: (message) => report({ stage: "depositing", message }),
    onSubmitted: () => report({ stage: "confirming", message: "Confirming with Blend." }),
    signal: args.signal,
  });
  persistBlendSession(sdk, address);

  if (result.status !== "settled") {
    throw new Error(
      result.error ??
        `Blend reported the deposit as ${result.status}. Check your Monad wallet before retrying.`,
    );
  }

  const first = result.txHashes[0];
  report({ stage: "done", message: "Deposit settled.", txHash: first?.hash });
  return {
    txHashes: result.txHashes,
    originChainId: quote.originChainId,
    destinationChainId: quote.destinationChainId,
    feesUsd,
    outputAtomic: quote.output.amount,
    funded,
  };
}

function finite(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function cancelQuietly(
  sdk: Awaited<ReturnType<typeof loadBlendSdk>>["sdk"],
  intentId: string,
): Promise<void> {
  try {
    await sdk.sessions.cancel(intentId);
  } catch {
    // The next quote passes forceReset and clears it anyway.
  }
}
