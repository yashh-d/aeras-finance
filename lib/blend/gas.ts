"use client";

// Gas for the owner transactions a Blend withdrawal needs, chain by chain.
//
// A withdrawal is one Safe transaction per chain the position sits on, sent
// and paid by the embedded wallet. So before anything is signed the plans
// are simulated where they will run (`eth_estimateGas` from the owner), the
// cost is priced at that chain's gas price, and the wallet's native balance
// there is checked against it with headroom. A chain the wallet cannot pay
// on gets a top-up from Solana USDC through Trustware, the same legs the
// venues on those chains already use: the Monad leg from lib/morpho/fund.ts,
// the Base leg from lib/glider/exit.ts, and the Ethereum leg sized by
// lib/trustware/eth-gas.ts from the live estimate.
//
// The simulation is also the early warning. Blend's Monad step reverted on
// 2026-09-22 for the full position because the vault could not redeem it
// (scripts/blend-withdraw-sim.mts), and the review card says so instead of
// letting the user confirm a withdrawal that would fail after signing.

import type { ActionPlan } from "@blend-money/fe";
import type { EIP1193Provider } from "@privy-io/react-auth";
import type { Hex } from "viem";

import { topUpBaseGas } from "@/lib/glider/exit";
import { USDC_DECIMALS } from "@/lib/jupiter/constants";
import { MONAD_NATIVE_TOKEN } from "@/lib/morpho/constants";
import {
  GAS_MIN_DELIVERED_WEI,
  GAS_TOPUP_USDC_ATOMIC,
  fundingRequest,
  quoteFunding,
} from "@/lib/morpho/fund";
import { atomicToUi } from "@/lib/trustware/amounts";
import {
  fetchTrustwareQuoteViaProxy,
  fetchTrustwareRouteViaProxy,
} from "@/lib/trustware/client";
import { planEthGas, type TrustwareLeg } from "@/lib/trustware/eth-gas";
import {
  submitTrustwareReceipt,
  trackTrustwareSettlement,
  type SolanaSigner,
} from "@/lib/trustware/execute";
import {
  extractExecution,
  extractIntentId,
  type TrustwareQuoteRequest,
} from "@/lib/trustware/types";

import { blendChainName } from "./constants";
import {
  connectPlanChain,
  describeRevert,
  ownerTransactionsOf,
  type EvmSigner,
} from "./execute";

export type { SolanaSigner } from "@/lib/trustware/execute";

// The wallet must hold this multiple of the simulated cost before the
// transaction is sent: gas prices move between review and confirm, and a
// transaction that runs out of balance mid-way is the state to avoid.
const HEADROOM_NUMERATOR = 15n;
const HEADROOM_DENOMINATOR = 10n;

// How long to wait for a top-up to become readable on its chain after
// Trustware reports it settled. The destination transaction has mined by
// then; this only covers RPC read lag.
const ARRIVAL_TIMEOUT_MS = 3 * 60_000;
const ARRIVAL_POLL_MS = 3_000;

export interface ChainGasReview {
  chainId: number;
  // From the simulation. Zero when the step would revert.
  gasUnits: bigint;
  gasPriceWei: bigint;
  // gasUnits * gasPriceWei.
  costWei: bigint;
  // What the wallet must hold: the cost with headroom.
  requiredWei: bigint;
  balanceWei: bigint;
  // The wallet cannot pay for this chain's transaction as it stands.
  needsTopUp: boolean;
  // The step would revert. The sentence to show, or null when it would not.
  revert: string | null;
}

// Simulate every plan where it runs and price it. Switches the wallet through
// each chain; signs nothing.
export async function reviewPlansGas(
  plans: readonly ActionPlan[],
  evm: EvmSigner,
): Promise<ChainGasReview[]> {
  const owner = evm.address as Hex;
  const out: ChainGasReview[] = [];
  for (const plan of plans) {
    const provider = await connectPlanChain(evm, plan.chainId);
    const [balanceHex, priceHex] = await Promise.all([
      provider.request({ method: "eth_getBalance", params: [owner, "latest"] }) as Promise<string>,
      provider.request({ method: "eth_gasPrice", params: [] }) as Promise<string>,
    ]);
    const balanceWei = BigInt(balanceHex);
    const gasPriceWei = BigInt(priceHex);
    let gasUnits = 0n;
    let revert: string | null = null;
    for (const tx of ownerTransactionsOf(plan, owner)) {
      try {
        gasUnits += BigInt(
          (await provider.request({
            method: "eth_estimateGas",
            params: [
              {
                from: owner,
                to: tx.to,
                data: tx.data,
                ...(tx.value > 0n ? { value: `0x${tx.value.toString(16)}` } : {}),
              },
            ],
          })) as string,
        );
      } catch (err) {
        revert = describeRevert(plan.chainId, err);
        gasUnits = 0n;
        break;
      }
    }
    const costWei = gasUnits * gasPriceWei;
    const requiredWei = (costWei * HEADROOM_NUMERATOR) / HEADROOM_DENOMINATOR;
    out.push({
      chainId: plan.chainId,
      gasUnits,
      gasPriceWei,
      costWei,
      requiredWei,
      balanceWei,
      needsTopUp: revert === null && balanceWei < requiredWei,
      revert,
    });
  }
  return out;
}

export type GasReport = (message: string) => void;

async function readNativeBalance(provider: EIP1193Provider, owner: Hex): Promise<bigint> {
  return BigInt(
    (await provider.request({ method: "eth_getBalance", params: [owner, "latest"] })) as string,
  );
}

async function awaitNativeBalance(
  provider: EIP1193Provider,
  owner: Hex,
  atLeastWei: bigint,
  signal?: AbortSignal,
): Promise<bigint> {
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  let last = 0n;
  for (;;) {
    if (signal?.aborted) return last;
    try {
      last = await readNativeBalance(provider, owner);
      if (last >= atLeastWei) return last;
    } catch {
      // Transient read failure; the next poll retries.
    }
    if (Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, ARRIVAL_POLL_MS));
  }
}

// Route one priced Solana leg, sign it, hand Trustware the hash, and wait for
// Trustware to report it settled.
async function runSolanaLeg(args: {
  request: TrustwareQuoteRequest;
  solana: SolanaSigner;
  signal?: AbortSignal;
}): Promise<void> {
  const route = await fetchTrustwareRouteViaProxy(args.request);
  const intentId = extractIntentId(route);
  const base64Tx = extractExecution(route)?.transaction?.data;
  if (!intentId || !base64Tx || base64Tx.startsWith("0x")) {
    throw new Error("Trustware returned no signable Solana transaction for the gas top-up.");
  }
  const hash = await args.solana.signAndSendBase64(base64Tx);
  await submitTrustwareReceipt(intentId, hash, args.signal);
  await trackTrustwareSettlement(intentId, args.signal, () => {});
}

// Bring the wallet's native balance on `review.chainId` up to what its
// transaction needs, from Solana USDC. Signs one Solana transaction when a
// top-up is needed, none otherwise. Resolves once the balance is readable.
export async function ensureGasForChain(args: {
  review: ChainGasReview;
  evm: EvmSigner;
  solana: SolanaSigner | undefined;
  solanaUsdcAtomic: string;
  // What the withdrawal is worth, for the Ethereum gas allowance.
  positionValueUsd: number;
  report?: GasReport;
  signal?: AbortSignal;
}): Promise<void> {
  const { review, evm } = args;
  const report = args.report ?? (() => {});
  const owner = evm.address as Hex;
  const name = blendChainName(review.chainId);
  if (!review.needsTopUp) return;
  if (!args.solana) {
    throw new Error(
      `Your wallet needs gas on ${name} for this withdrawal and no Solana wallet is available to buy it.`,
    );
  }
  const solana = args.solana;

  if (review.chainId === 143) {
    const onSolana = BigInt(args.solanaUsdcAtomic || "0");
    if (onSolana < GAS_TOPUP_USDC_ATOMIC) {
      throw new Error(
        `Your Monad wallet needs a MON gas top-up (about ${atomicToUi(GAS_TOPUP_USDC_ATOMIC.toString(), USDC_DECIMALS)} USDC), but your Solana wallet holds only ${atomicToUi(onSolana.toString(), USDC_DECIMALS)} USDC.`,
      );
    }
    const request = fundingRequest(
      GAS_TOPUP_USDC_ATOMIC.toString(),
      solana.address,
      owner,
      MONAD_NATIVE_TOKEN,
    );
    const quote = await quoteFunding(request, fetchTrustwareQuoteViaProxy);
    if (BigInt(quote.toAmountMinAtomic) < GAS_MIN_DELIVERED_WEI) {
      throw new Error("The Monad gas top-up did not return a usable rate. Try again shortly.");
    }
    report("Buying MON on Monad for gas from your Solana wallet.");
    await runSolanaLeg({ request, solana, signal: args.signal });
  } else if (review.chainId === 8453) {
    report("Buying a little ETH on Base for gas from your Solana wallet.");
    await topUpBaseGas({ solana, evmAddress: owner, signal: args.signal });
  } else if (review.chainId === 1) {
    const plan = await planEthGas({
      ethBalanceAtomic: review.balanceWei.toString(),
      gasPriceWei: review.gasPriceWei.toString(),
      solanaUsdcAtomic: args.solanaUsdcAtomic,
      solanaAddress: solana.address,
      evmAddress: owner,
      gasUnits: review.gasUnits,
      positionValueUsd: args.positionValueUsd,
      fetchQuote: fetchTrustwareQuoteViaProxy,
    });
    if (plan.kind === "blocked") throw new Error(plan.reason);
    const leg: TrustwareLeg | undefined = plan.leg;
    if (!leg) return;
    report(
      `Buying about $${plan.costUsd?.toFixed(2) ?? "?"} of ETH on Ethereum for gas from your Solana wallet.`,
    );
    await runSolanaLeg({ request: leg.request, solana, signal: args.signal });
  } else {
    throw new Error(`Gas on ${name} cannot be topped up from here.`);
  }

  report(`Waiting for the gas to land on ${name}.`);
  const provider = await connectPlanChain(evm, review.chainId);
  const balance = await awaitNativeBalance(provider, owner, review.requiredWei, args.signal);
  if (balance < review.requiredWei) {
    throw new Error(
      `The gas top-up settled but the ${name} balance has not caught up. Your funds are safe. Try again in a moment.`,
    );
  }
}
