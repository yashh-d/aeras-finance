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
import type { Hex } from "viem";

import { fundEvmGas, planEvmGas } from "@/lib/gas/evm";
import type { SolanaSigner } from "@/lib/trustware/execute";


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

// Bring the wallet's native balance on `review.chainId` up to what its
// transaction needs, from Solana USDC. Signs one Solana transaction when a
// top-up is needed, none otherwise. Resolves once the balance is readable.
//
// The legs and the arrival wait live in lib/gas/evm.ts now, shared with the
// gas sheet every other exit path opens; this passes the review's simulated
// requirement in place of the chain's floor.
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
  if (!review.needsTopUp) return;
  const name = blendChainName(review.chainId);
  if (!args.solana) {
    throw new Error(
      `Your wallet needs gas on ${name} for this withdrawal and no Solana wallet is available to buy it.`,
    );
  }
  const shortfall = await planEvmGas({
    chainId: review.chainId,
    evm,
    solanaUsdcAtomic: args.solanaUsdcAtomic,
    solanaAddress: args.solana.address,
    gasUnits: review.gasUnits,
    positionValueUsd: args.positionValueUsd,
    balanceWei: review.balanceWei,
    gasPriceWei: review.gasPriceWei,
    requiredWei: review.requiredWei,
  });
  if (!shortfall) return;
  await fundEvmGas({
    shortfall,
    evm,
    solana: args.solana,
    report: args.report,
    signal: args.signal,
  });
}
