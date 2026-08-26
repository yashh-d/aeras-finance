"use client";

// Fund a Morpho-on-Monad deposit from the user's Solana USDC.
//
// The vault deposit itself (lib/morpho/deposit.ts) spends USDC that is already
// on Monad. This module covers everything the wallet is missing: when the
// Monad USDC balance is short it plans and executes a Trustware conversion of
// Solana USDC into Monad USDC, and when the wallet holds no native MON it adds
// a small gas top-up leg (Solana USDC -> native MON), because a freshly funded
// embedded wallet cannot pay for its own approve and deposit otherwise. Both
// legs broadcast up front and settle in parallel, then the normal ERC-4626
// deposit runs. This is the "universal deposit machinery pointed at an EVM
// chain" described in CLAUDE.md Chain Assumptions.
//
// Verified against the live Trustware API on 2026-08-25:
//   - Monad (chainId "143") is in GET /routes/chains.
//   - Solana USDC -> Monad USDC quotes and routes (provider "lifi"; ~0.3% fees
//     plus a $0.025 fixed fee at retail size).
//   - Solana USDC -> native MON quotes and routes via the zero-address
//     sentinel (0.5 USDC delivered ~17 MON; MON ~ $0.03).
//   - For a Solana source, /route's execution.transaction carries ONLY a `data`
//     field holding a base64 Solana transaction to sign. The EVM fields (to,
//     chainId, gas) are absent.
//   - The route's approvals array echoes an ERC-20-style approval with a Solana
//     mint and LI.FI's Solana chain id. There are no ERC-20 approvals on
//     Solana; it must be ignored, not executed.
//
// The same rules as lib/trustware/execute.ts apply: nothing downstream treats
// funds as delivered before Trustware reports success, and every validation
// that can happen before the user signs does.

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { USDC_DECIMALS, USDC_MINT } from "@/lib/jupiter/constants";
import { awaitTokenBalance } from "@/lib/solana/await-balance";
import { addBps, atomicToUi, toNumberOrNull } from "@/lib/trustware/amounts";
import {
  fetchTrustwareQuoteViaProxy,
  fetchTrustwareRouteViaProxy,
} from "@/lib/trustware/client";
import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
} from "@/lib/trustware/constants";
import {
  executeEvmRoute,
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import {
  extractEstimate,
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
  type TrustwareQuoteResponse,
} from "@/lib/trustware/types";

import { MONAD_CHAIN_ID, MONAD_NATIVE_TOKEN, MONAD_USDC } from "./constants";
import {
  depositToMorphoVault,
  type EvmSigner,
  type MorphoTxProgress,
} from "./deposit";
import type { MorphoVault } from "./vaults";

export type { SolanaSigner } from "@/lib/trustware/execute";

// Sizing headroom over the quoted rate, matching the xStock planner's
// CONVERSION_HEADROOM_BPS rationale: the rate can drift between planning and
// execution. Any oversend is not lost; it lands as Monad USDC and stays in the
// user's wallet.
const FUNDING_HEADROOM_BPS = 150;

// Margin taken off the Solana balance when computing the deposit ceiling.
// Covers the slippage floor, the sizing headroom, and the fixed fee at retail
// size. The plan validates the real number; this only keeps Max honest.
const MAX_BUFFER_BPS = 300;

// Gas thresholds, measured on Monad mainnet 2026-08-25 at gasPrice 102 gwei:
// an ERC-20 approve costs ~0.006 MON and a vault deposit ~0.026 MON. The
// floor is a comfortable multiple of a full deposit (and a later withdraw), so
// a wallet above it never strands mid-flow. The top-up is a fixed 0.5 USDC,
// which delivered ~17 MON when measured, so one top-up covers hundreds of
// transactions and never needs repeating at today's prices.
const GAS_FLOOR_WEI = 100_000_000_000_000_000n; // 0.1 MON
const GAS_TOPUP_USDC_ATOMIC = 500_000n; // 0.5 USDC
// If 0.5 USDC quotes to less than this, MON has repriced dramatically and the
// fixed top-up no longer makes sense; stop and say so instead of delivering
// gas dust.
const GAS_MIN_DELIVERED_WEI = 1_000_000_000_000_000_000n; // 1 MON

// How long to wait for delivered funds to become readable on Monad after
// Trustware reports success. The destination transactions have already mined
// at that point; this only covers RPC read lag.
const ARRIVAL_TIMEOUT_MS = 60_000;
const ARRIVAL_POLL_MS = 2_500;

// True when the wallet cannot pay for its own Monad transactions and a
// deposit must include the gas top-up leg. Exported for the card's hint copy.
export function needsMonadGas(monBalanceAtomic: string): boolean {
  return BigInt(monBalanceAtomic || "0") < GAS_FLOOR_WEI;
}

export interface MorphoFundingLeg {
  // The exact request /route will be called with. Kept on the plan so the
  // executed route matches the priced one.
  request: TrustwareQuoteRequest;
  // Solana USDC to send, 6-decimal atomic.
  sourceAmountAtomic: string;
  // Guaranteed delivery floor after slippage, in the destination token's
  // atomic units (6-decimal for USDC, 18-decimal wei for native MON).
  toAmountMinAtomic: string;
  totalFeesUsd: number | null;
}

export type MorphoDepositPlan =
  | { kind: "direct" }
  | {
      kind: "fund-then-deposit";
      shortfallAtomic: string;
      // USDC leg. Absent when the Monad balance already covers the deposit.
      funding?: MorphoFundingLeg;
      // Native MON gas top-up. Absent when the wallet already holds gas.
      gas?: MorphoFundingLeg;
    }
  | { kind: "blocked"; reason: string };

// The deposit ceiling the form should offer: Monad USDC at par plus the Solana
// USDC discounted by the funding margin, less the gas top-up when the wallet
// still needs one.
export function maxFundableDepositAtomic(
  monadUsdcAtomic: string,
  solanaUsdcAtomic: string,
  monBalanceAtomic: string,
): string {
  const onMonad = BigInt(monadUsdcAtomic || "0");
  let onSolana = BigInt(solanaUsdcAtomic || "0");
  if (needsMonadGas(monBalanceAtomic)) {
    onSolana =
      onSolana > GAS_TOPUP_USDC_ATOMIC ? onSolana - GAS_TOPUP_USDC_ATOMIC : 0n;
  }
  const usable = (onSolana * BigInt(10_000 - MAX_BUFFER_BPS)) / 10_000n;
  return (onMonad + usable).toString();
}

function fundingRequest(
  fromAmountAtomic: string,
  solanaAddress: string,
  evmAddress: string,
  toToken: string = MONAD_USDC.address,
): TrustwareQuoteRequest {
  return {
    fromChain: TRUSTWARE_SOLANA_CHAIN,
    toChain: String(MONAD_CHAIN_ID),
    fromToken: USDC_MINT,
    toToken,
    fromAmount: fromAmountAtomic,
    fromAddress: solanaAddress,
    toAddress: evmAddress,
    // The route crosses a bridge, so it keeps Trustware's default tolerance
    // rather than the tight Solana-swap setting.
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
  };
}

type QuoteFn = (req: TrustwareQuoteRequest) => Promise<TrustwareQuoteResponse>;

async function quoteFunding(
  req: TrustwareQuoteRequest,
  fetchQuote: QuoteFn,
): Promise<{
  toAmountMinAtomic: string;
  totalFeesUsd: number | null;
}> {
  const res = await fetchQuote(req);
  const estimate = extractEstimate(res);
  if (!estimate?.toAmount) {
    throw new Error("Trustware returned no estimate for this conversion.");
  }
  // Not every route echoes a minimum; derive the floor from the slippage rather
  // than sizing against the optimistic number.
  const toAmountMinAtomic =
    estimate.toAmountMin ??
    (
      (BigInt(estimate.toAmount) *
        BigInt(Math.round((100 - (req.slippage ?? TRUSTWARE_DEFAULT_SLIPPAGE)) * 100))) /
      10_000n
    ).toString();
  return {
    toAmountMinAtomic,
    totalFeesUsd: toNumberOrNull(estimate.totalFeesUsd),
  };
}

// Work out what the requested deposit is missing on Monad (USDC, gas, or
// both), and price the legs that deliver it. Read-only: signs nothing, moves
// nothing.
export async function planMorphoDeposit(args: {
  // Requested deposit, 6-decimal atomic.
  depositAtomic: bigint;
  monadUsdcAtomic: string;
  solanaUsdcAtomic: string;
  monBalanceAtomic: string;
  solanaAddress: string | undefined;
  evmAddress: string;
  // Override the quote transport. The default hits our proxy on a relative
  // path, which only resolves in the browser; scripts pass a direct fetcher.
  fetchQuote?: QuoteFn;
}): Promise<MorphoDepositPlan> {
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;
  const requested = args.depositAtomic;
  if (requested <= 0n) return { kind: "blocked", reason: "Enter an amount above zero." };

  const onMonad = BigInt(args.monadUsdcAtomic || "0");
  const needsGas = needsMonadGas(args.monBalanceAtomic);
  const shortfall = requested > onMonad ? requested - onMonad : 0n;

  if (shortfall === 0n && !needsGas) return { kind: "direct" };

  const shortfallUi = atomicToUi(shortfall.toString(), USDC_DECIMALS);
  let onSolana = BigInt(args.solanaUsdcAtomic || "0");

  if (!args.solanaAddress) {
    return {
      kind: "blocked",
      reason: needsGas
        ? "Your Monad wallet needs a MON gas top-up and no Solana wallet is available to fund it."
        : `You need ${shortfallUi} more USDC on Monad and no Solana wallet is available to convert from.`,
    };
  }

  // Price the gas leg first and reserve its spend, so the USDC leg is sized
  // against what is actually left.
  let gas: MorphoFundingLeg | undefined;
  if (needsGas) {
    if (onSolana < GAS_TOPUP_USDC_ATOMIC) {
      return {
        kind: "blocked",
        reason: `Your Monad wallet needs a one-time MON gas top-up (about ${atomicToUi(GAS_TOPUP_USDC_ATOMIC.toString(), USDC_DECIMALS)} USDC), but your Solana wallet holds only ${atomicToUi(onSolana.toString(), USDC_DECIMALS)} USDC.`,
      };
    }
    const request = fundingRequest(
      GAS_TOPUP_USDC_ATOMIC.toString(),
      args.solanaAddress,
      args.evmAddress,
      MONAD_NATIVE_TOKEN,
    );
    let quote: Awaited<ReturnType<typeof quoteFunding>>;
    try {
      quote = await quoteFunding(request, fetchQuote);
    } catch (err) {
      return {
        kind: "blocked",
        reason: `Could not price the Monad gas top-up. ${
          err instanceof Error ? err.message : "Try again shortly."
        }`,
      };
    }
    if (BigInt(quote.toAmountMinAtomic) < GAS_MIN_DELIVERED_WEI) {
      return {
        kind: "blocked",
        reason: "The Monad gas top-up did not return a usable rate. Try again shortly.",
      };
    }
    gas = {
      request,
      sourceAmountAtomic: GAS_TOPUP_USDC_ATOMIC.toString(),
      toAmountMinAtomic: quote.toAmountMinAtomic,
      totalFeesUsd: quote.totalFeesUsd,
    };
    onSolana -= GAS_TOPUP_USDC_ATOMIC;
  }

  let funding: MorphoFundingLeg | undefined;
  if (shortfall > 0n) {
    if (onSolana <= 0n) {
      return {
        kind: "blocked",
        reason: `You need ${shortfallUi} more USDC on Monad and your Solana wallet holds no USDC to convert${gas ? " after the gas top-up" : ""}.`,
      };
    }

    // Both sides are 6-decimal USDC, so par is a close first guess and the
    // probe only corrects for fees and slippage. Clamp to the balance so the
    // quote is one the user could execute.
    const probeAmount = shortfall > onSolana ? onSolana : shortfall;
    let probe: Awaited<ReturnType<typeof quoteFunding>>;
    try {
      probe = await quoteFunding(
        fundingRequest(probeAmount.toString(), args.solanaAddress, args.evmAddress),
        fetchQuote,
      );
    } catch (err) {
      return {
        kind: "blocked",
        reason: `No conversion route from Solana USDC to Monad right now. ${
          err instanceof Error ? err.message : "Try again shortly."
        }`,
      };
    }

    const delivered = BigInt(probe.toAmountMinAtomic);
    if (delivered <= 0n) {
      return {
        kind: "blocked",
        reason: "The conversion to Monad USDC did not return a usable rate.",
      };
    }

    // Solve for the source amount that clears the shortfall at the observed
    // rate, plus headroom for drift between planning and execution.
    let required = (shortfall * probeAmount + delivered - 1n) / delivered;
    required = BigInt(addBps(required.toString(), FUNDING_HEADROOM_BPS));
    if (required > onSolana) {
      return {
        kind: "blocked",
        reason: `Converting ${atomicToUi(onSolana.toString(), USDC_DECIMALS)} USDC on Solana${gas ? " (after the gas top-up)" : ""} is not enough. About ${atomicToUi(required.toString(), USDC_DECIMALS)} is needed to cover the ${shortfallUi} USDC shortfall on Monad.`,
      };
    }

    // Re-quote at the solved amount: the probe priced a different size, so its
    // figures do not describe what would actually run.
    const request = fundingRequest(
      required.toString(),
      args.solanaAddress,
      args.evmAddress,
    );
    let quote: Awaited<ReturnType<typeof quoteFunding>>;
    try {
      quote = await quoteFunding(request, fetchQuote);
    } catch (err) {
      return {
        kind: "blocked",
        reason: `Could not price the conversion to Monad USDC. ${
          err instanceof Error ? err.message : "Try again shortly."
        }`,
      };
    }
    if (BigInt(quote.toAmountMinAtomic) < shortfall) {
      return {
        kind: "blocked",
        reason: "The conversion rate moved while pricing. Try again.",
      };
    }
    funding = {
      request,
      sourceAmountAtomic: required.toString(),
      toAmountMinAtomic: quote.toAmountMinAtomic,
      totalFeesUsd: quote.totalFeesUsd,
    };
  }

  return {
    kind: "fund-then-deposit",
    shortfallAtomic: shortfall.toString(),
    funding,
    gas,
  };
}

type Report = (p: MorphoTxProgress) => void;

interface BroadcastedLeg {
  intentId: string;
  sourceTxHash: string;
}

// Route one priced leg, sign its Solana source transaction, and hand Trustware
// the hash. Settlement tracking is separate so several legs can bridge at
// once.
async function broadcastFundingLeg(args: {
  funding: MorphoFundingLeg;
  // The delivery floor the fresh route must still guarantee before the user
  // commits funds. Pass 0n to skip (the plan already validated the leg).
  minDeliveredAtomic: bigint;
  // Progress-message noun: "USDC" or "MON for gas".
  describe: string;
  solana: SolanaSigner;
  report: Report;
  signal?: AbortSignal;
}): Promise<BroadcastedLeg> {
  const { funding, solana, report, signal } = args;

  report({ stage: "funding", message: `Preparing the ${args.describe} conversion to Monad.` });
  const routeRes = await fetchTrustwareRouteViaProxy(funding.request);

  const intentId = extractIntentId(routeRes);
  const transaction = extractExecution(routeRes)?.transaction;
  if (!intentId) throw new Error("Trustware returned no intent to track.");
  // For a Solana source the transaction is a base64 payload in `data` alone.
  // Anything hex-shaped would be an EVM transaction we cannot sign here.
  if (!transaction?.data || transaction.data.startsWith("0x")) {
    throw new Error("Trustware returned no signable Solana transaction.");
  }

  // Last free abort point: verify the fresh route still delivers enough.
  const estimate = extractEstimate(routeRes);
  const guaranteed = estimate?.toAmountMin ?? estimate?.toAmount;
  if (
    args.minDeliveredAtomic > 0n &&
    guaranteed &&
    BigInt(guaranteed) < args.minDeliveredAtomic
  ) {
    throw new Error(
      "The conversion rate moved and no longer covers this deposit. " +
        "Try again to get a fresh quote.",
    );
  }

  report({
    stage: "funding",
    message: `Sending ${atomicToUi(funding.sourceAmountAtomic, USDC_DECIMALS)} USDC from your Solana wallet (${args.describe}).`,
  });
  const sourceTxHash = await solana.signAndSendBase64(transaction.data);

  // Submit immediately after broadcast; without this Trustware cannot track a
  // route the user has already paid for.
  await submitTrustwareReceipt(intentId, sourceTxHash, signal);
  return { intentId, sourceTxHash };
}

// Execute every leg of a funding plan: broadcast each source transaction (the
// signing is quick), let the bridges settle in parallel (the wait), then hold
// until the funds are readable on Monad. Shared by the funded deposit and the
// wallet panel's Fund button.
async function executeFundingPlan(args: {
  plan: Extract<MorphoDepositPlan, { kind: "fund-then-deposit" }>;
  evmAddress: string;
  // The Monad USDC balance that must be readable before returning.
  usdcAtLeastAtomic: bigint;
  solana: SolanaSigner;
  report: Report;
  signal?: AbortSignal;
}): Promise<void> {
  const { plan, solana, report, signal } = args;

  const broadcasted: BroadcastedLeg[] = [];
  if (plan.gas) {
    broadcasted.push(
      await broadcastFundingLeg({
        funding: plan.gas,
        minDeliveredAtomic: GAS_MIN_DELIVERED_WEI,
        describe: "MON for gas",
        solana,
        report,
        signal,
      }),
    );
  }
  if (plan.funding) {
    broadcasted.push(
      await broadcastFundingLeg({
        funding: plan.funding,
        minDeliveredAtomic: BigInt(plan.shortfallAtomic),
        describe: "USDC",
        solana,
        report,
        signal,
      }),
    );
  }

  report({ stage: "funding", message: "Bridging to Monad. This can take a few minutes." });
  await Promise.all(
    broadcasted.map((leg) =>
      trackTrustwareSettlement(leg.intentId, signal, () =>
        report({ stage: "funding", message: "Bridging to Monad. This can take a few minutes." }),
      ),
    ),
  );

  report({ stage: "funding", message: "Funds arrived. Confirming the Monad balance." });
  const arrived = await awaitMonadFunds({
    evmAddress: args.evmAddress,
    usdcAtLeastAtomic: args.usdcAtLeastAtomic,
    monAtLeastAtomic: plan.gas ? GAS_FLOOR_WEI : 0n,
    signal,
  });
  if (
    arrived.usdc < args.usdcAtLeastAtomic ||
    (plan.gas && arrived.mon < GAS_FLOOR_WEI)
  ) {
    // The bridges settled, so the money is in the user's Monad wallet even if
    // our read has not caught up. A retry later sees the arrived balance.
    throw new Error(
      "The converted funds are on Monad but the balance read has not caught up. " +
        "Your funds are safe. Try again in a moment.",
    );
  }
}

// One fresh read of the wallet's Monad balances. Returns null when the route
// is unreachable; callers fall back to their state values rather than planning
// against zeros, which would oversize the funding.
async function readMonadBalances(
  evmAddress: string,
): Promise<{ usdcAtomic: string; monAtomic: string } | null> {
  try {
    const res = await fetch(
      `/api/morpho/position?address=${encodeURIComponent(evmAddress)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const { usdcBalanceAtomic, monBalanceAtomic } = (await res.json()) as {
      usdcBalanceAtomic?: string;
      monBalanceAtomic?: string;
    };
    return {
      usdcAtomic: usdcBalanceAtomic ?? "0",
      monAtomic: monBalanceAtomic ?? "0",
    };
  } catch {
    return null;
  }
}

// Read the wallet's Monad balances through our position route until they cover
// the deposit and its gas. Trustware has already reported success for every
// leg, so the destination transactions have mined; this only absorbs RPC read
// lag.
async function awaitMonadFunds(args: {
  evmAddress: string;
  usdcAtLeastAtomic: bigint;
  monAtLeastAtomic: bigint;
  signal?: AbortSignal;
}): Promise<{ usdc: bigint; mon: bigint }> {
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  let last = { usdc: 0n, mon: 0n };
  for (;;) {
    if (args.signal?.aborted) return last;
    try {
      const res = await fetch(
        `/api/morpho/position?address=${encodeURIComponent(args.evmAddress)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const { usdcBalanceAtomic, monBalanceAtomic } = (await res.json()) as {
          usdcBalanceAtomic?: string;
          monBalanceAtomic?: string;
        };
        last = {
          usdc: BigInt(usdcBalanceAtomic ?? "0"),
          mon: BigInt(monBalanceAtomic ?? "0"),
        };
        if (last.usdc >= args.usdcAtLeastAtomic && last.mon >= args.monAtLeastAtomic) {
          return last;
        }
      }
    } catch {
      // Transient read failure; the next poll retries.
    }
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, ARRIVAL_POLL_MS));
  }
}

// Deposit USDC into a Monad Morpho vault, first delivering whatever the Monad
// wallet is missing (USDC, gas, or both) from the user's Solana USDC. One
// call, every stage reported. Returns the deposit tx hash.
export async function depositUsdcWithFunding(args: {
  vault: MorphoVault;
  amountAtomic: bigint;
  monadUsdcAtomic: string;
  solanaUsdcAtomic: string;
  monBalanceAtomic: string;
  signer: EvmSigner;
  // Required only when funding is needed; the plan reports a readable reason
  // when it is missing.
  solana: SolanaSigner | undefined;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ txHash: string; funded: boolean }> {
  const report: Report = (p) => args.onProgress?.(p);

  // UI state can lag the chain: a retry once re-bought a gas top-up the first
  // attempt had already delivered, because the card's MON balance still read
  // zero. Plan against a fresh read whenever one is available; the passed-in
  // values are only the fallback for a transient read failure.
  const fresh = await readMonadBalances(args.signer.address);
  const monadUsdcAtomic = fresh?.usdcAtomic ?? args.monadUsdcAtomic;
  const monBalanceAtomic = fresh?.monAtomic ?? args.monBalanceAtomic;

  const plan = await planMorphoDeposit({
    depositAtomic: args.amountAtomic,
    monadUsdcAtomic,
    solanaUsdcAtomic: args.solanaUsdcAtomic,
    monBalanceAtomic,
    solanaAddress: args.solana?.address,
    evmAddress: args.signer.address,
  });
  if (plan.kind === "blocked") throw new Error(plan.reason);

  let funded = false;
  if (plan.kind === "fund-then-deposit") {
    if (!args.solana) {
      throw new Error("No Solana wallet is available to fund this deposit.");
    }
    await executeFundingPlan({
      plan,
      evmAddress: args.signer.address,
      usdcAtLeastAtomic: args.amountAtomic,
      solana: args.solana,
      report,
      signal: args.signal,
    });
    funded = true;
  }

  const txHash = await depositToMorphoVault({
    vault: args.vault,
    amountAtomic: args.amountAtomic,
    signer: args.signer,
    onProgress: args.onProgress,
  });
  return { txHash, funded };
}

// Move USDC from the user's Solana wallet into their Monad wallet, with the
// same automatic MON gas top-up a funded deposit gets. This is the wallet
// panel's Fund button; no vault is involved and nothing is deposited.
export async function fundMonadUsdc(args: {
  // USDC to deliver to Monad, 6-decimal atomic.
  amountAtomic: bigint;
  // The wallet's current Monad USDC. Only sets the arrival floor; the plan
  // below treats the full amount as the shortfall to deliver.
  monadUsdcAtomic: string;
  solanaUsdcAtomic: string;
  monBalanceAtomic: string;
  evmAddress: string;
  solana: SolanaSigner;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<void> {
  const report: Report = (p) => args.onProgress?.(p);

  // A zero Monad balance makes the planner size legs for the full amount.
  const plan = await planMorphoDeposit({
    depositAtomic: args.amountAtomic,
    monadUsdcAtomic: "0",
    solanaUsdcAtomic: args.solanaUsdcAtomic,
    monBalanceAtomic: args.monBalanceAtomic,
    solanaAddress: args.solana.address,
    evmAddress: args.evmAddress,
  });
  if (plan.kind === "blocked") throw new Error(plan.reason);
  if (plan.kind === "direct") return; // zero amount; nothing to move

  await executeFundingPlan({
    plan,
    evmAddress: args.evmAddress,
    usdcAtLeastAtomic: BigInt(args.monadUsdcAtomic || "0") + args.amountAtomic,
    solana: args.solana,
    report,
    signal: args.signal,
  });
  report({ stage: "done", message: "USDC arrived on Monad." });
}

// ── the return leg: Monad USDC -> Solana USDC ──────────────────────────────
//
// Verified live 2026-08-26: Trustware routes it (provider "lifi"), the source
// leg is a standard chainId-143 EVM transaction with an ERC-20 approval, and
// the /sdk/rpc/evm/allowance proxy answers for chainId 143.

function returnRequest(
  fromAmountAtomic: string,
  evmAddress: string,
  solanaAddress: string,
): TrustwareQuoteRequest {
  return {
    fromChain: String(MONAD_CHAIN_ID),
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: MONAD_USDC.address,
    toToken: USDC_MINT,
    fromAmount: fromAmountAtomic,
    fromAddress: evmAddress,
    toAddress: solanaAddress,
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
  };
}

// Price the return leg. Read-only; the form shows the guaranteed floor before
// the user commits.
export async function quoteMonadUsdcToSolana(args: {
  amountAtomic: bigint;
  evmAddress: string;
  solanaAddress: string;
  fetchQuote?: QuoteFn;
}): Promise<{ toAmountMinAtomic: string; totalFeesUsd: number | null }> {
  return quoteFunding(
    returnRequest(args.amountAtomic.toString(), args.evmAddress, args.solanaAddress),
    args.fetchQuote ?? fetchTrustwareQuoteViaProxy,
  );
}

// Send Monad USDC back to the user's Solana wallet. The amount is what leaves
// Monad; fees come out of the delivered side. Requires MON for gas, which the
// wallet has whenever it was funded through this module (the top-up outlasts
// hundreds of transactions); a gasless wallet gets a readable error rather
// than a doomed signature.
export async function sendMonadUsdcToSolana(args: {
  amountAtomic: bigint;
  monadUsdcAtomic: string;
  monBalanceAtomic: string;
  evm: EvmSigner;
  solanaAddress: string;
  onProgress?: Report;
  signal?: AbortSignal;
}): Promise<{ deliveredAtomic: string | null }> {
  if (args.amountAtomic <= 0n) throw new Error("Enter an amount above zero.");
  if (args.amountAtomic > BigInt(args.monadUsdcAtomic || "0")) {
    throw new Error("Amount is above the wallet's Monad USDC balance.");
  }
  if (needsMonadGas(args.monBalanceAtomic)) {
    throw new Error(
      "Your Monad wallet has no MON to pay gas for this transfer. " +
        "Funding the wallet from Solana adds gas automatically.",
    );
  }

  const result = await executeEvmRoute({
    request: returnRequest(
      args.amountAtomic.toString(),
      args.evm.address,
      args.solanaAddress,
    ),
    evm: args.evm,
    describe: "USDC",
    onProgress: (p) =>
      args.onProgress?.({
        stage: p.stage === "settled" ? "done" : "funding",
        message:
          p.stage === "settled" ? "USDC arrived on Solana." : p.message,
      }),
    signal: args.signal,
  });
  return { deliveredAtomic: result.deliveredAtomic };
}

// Ceiling for spending the Monad balance toward a Solana-side action: the
// balance discounted by the funding margin, mirroring maxFundableDepositAtomic
// for the other direction. Gas is paid in MON, so no USDC is reserved.
export function maxReturnableUsdcAtomic(monadUsdcAtomic: string): string {
  return (
    (BigInt(monadUsdcAtomic || "0") * BigInt(10_000 - MAX_BUFFER_BPS)) /
    10_000n
  ).toString();
}

// Bring the user's Solana USDC up to `walletAtLeastAtomic` by converting Monad
// USDC. The mirror of the deposit-funding planner: probe at par, solve the
// source amount with headroom, execute, then hold until the Solana ATA
// actually reflects it. Used by Solana-side actions (loan repayment) whose
// wallet is short but whose money is parked on Monad.
export async function fundSolanaUsdcFromMonad(args: {
  // Solana wallet USDC required after the leg, 6-decimal atomic.
  walletAtLeastAtomic: bigint;
  solanaUsdcAtomic: string;
  monadUsdcAtomic: string;
  monBalanceAtomic: string;
  evm: EvmSigner;
  solanaAddress: string;
  onProgress?: Report;
  signal?: AbortSignal;
  fetchQuote?: QuoteFn;
}): Promise<void> {
  const report: Report = (p) => args.onProgress?.(p);
  const onSolana = BigInt(args.solanaUsdcAtomic || "0");
  const target = args.walletAtLeastAtomic - onSolana;
  if (target <= 0n) return;

  const balance = BigInt(args.monadUsdcAtomic || "0");
  if (balance <= 0n) {
    throw new Error("Your Monad wallet holds no USDC to convert.");
  }
  if (needsMonadGas(args.monBalanceAtomic)) {
    throw new Error(
      "Your Monad wallet has no MON to pay gas for this transfer. " +
        "Funding the wallet from Solana adds gas automatically.",
    );
  }
  const fetchQuote = args.fetchQuote ?? fetchTrustwareQuoteViaProxy;

  // Par is a close first guess for USDC to USDC; the probe corrects for fees
  // and slippage, then the solved amount gets headroom for drift.
  const probeAmount = target > balance ? balance : target;
  const probe = await quoteFunding(
    returnRequest(probeAmount.toString(), args.evm.address, args.solanaAddress),
    fetchQuote,
  );
  const delivered = BigInt(probe.toAmountMinAtomic);
  if (delivered <= 0n) {
    throw new Error("The conversion to Solana USDC did not return a usable rate.");
  }
  let required = (target * probeAmount + delivered - 1n) / delivered;
  required = BigInt(addBps(required.toString(), FUNDING_HEADROOM_BPS));
  if (required > balance) {
    throw new Error(
      `Converting all ${atomicToUi(balance.toString(), USDC_DECIMALS)} USDC on Monad is not enough. About ${atomicToUi(required.toString(), USDC_DECIMALS)} is needed to cover the ${atomicToUi(target.toString(), USDC_DECIMALS)} USDC shortfall on Solana.`,
    );
  }

  // executeEvmRoute re-checks the fresh route's guaranteed minimum against the
  // target before anything is signed.
  await executeEvmRoute({
    request: returnRequest(required.toString(), args.evm.address, args.solanaAddress),
    evm: args.evm,
    describe: "USDC",
    minDeliveredAtomic: target,
    onProgress: (p) => report({ stage: "funding", message: p.message }),
    signal: args.signal,
  });

  report({ stage: "funding", message: "USDC arrived. Confirming the Solana balance." });
  const finalBalance = await awaitTokenBalance({
    mint: USDC_MINT,
    owner: args.solanaAddress,
    atLeastAtomic: args.walletAtLeastAtomic.toString(),
    programId: TOKEN_PROGRAM_ID,
    timeoutMs: 60_000,
    signal: args.signal,
  });
  if (BigInt(finalBalance) < args.walletAtLeastAtomic) {
    // The bridge settled, so the money is in the Solana wallet even if the
    // read lags. A retry sees the arrived balance and skips the funding.
    throw new Error(
      "The converted USDC is on Solana but the balance read has not caught up. " +
        "Your funds are safe. Try again in a moment.",
    );
  }
}
