// Base as a funding source, and the way back off it.
//
// Base is not a venue. Nothing is earned there, nothing is borrowed there, and
// no position settles there. It is in the app for one reason: USDC on Base is
// cheap and widely held, so a user who already has some should be able to put
// it to work here without first paying an Ethereum bridge to move it.
//
// That makes the return leg the whole point, not an afterthought. A chain the
// wallet can receive on but not spend from is a trap, which is what the wallet
// panel's "cannot be moved" warning exists to say about every OTHER chain. Base
// is only listed because `sendBaseUsdcToSolana` below actually works.
//
// This is deliberately thinner than lib/morpho/fund.ts. That module funds a
// position and has to reason about vault shares, arrival polling and a gas
// top-up leg. This one moves USDC one way and stops.

import { USDC_MINT } from "@/lib/jupiter/constants";

import {
  TRUSTWARE_DEFAULT_SLIPPAGE,
  TRUSTWARE_SOLANA_CHAIN,
} from "./constants";
import { executeEvmRoute, type EvmSigner } from "./execute";
import type { TrustwareQuoteRequest } from "./types";

// Base mainnet.
export const BASE_CHAIN_ID = 8453;

// Circle's canonical USDC on Base, 6 decimals. The same address the Lighter
// margin route already delivers to in lib/trustware/server.ts, which is where
// this was taken from rather than from a doc. Lowercased, because every
// contract comparison in this directory is lowercased.
export const BASE_USDC = {
  symbol: "USDC" as const,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  decimals: 6,
};

// Base pays gas in ETH, and the embedded EVM wallet is born with none.
//
// There is no automatic top-up here, unlike the Monad path. Monad can fund its
// own gas because the USDC arrives through a Trustware leg we build, so a
// second leg can ride along; Base USDC arrives from outside the app, so there
// is no inbound leg to attach one to. The user holds a little ETH on Base or
// the transfer cannot be signed, exactly as on BNB Chain.
//
// Sized against the gas limit Trustware actually returns for this route:
// 1,275,412 (0x137414) from LI.FI, 91,412 from relay, measured across four
// sizes on 2026-08-28 by scripts/trustware-base-check.mts. At 0.0002 ETH the
// floor covers the larger of those at about 0.157 gwei, which is a comfortable
// multiple of ordinary Base gas. Re-run the script if Base gas prices move.
const GAS_FLOOR_WEI = 200_000_000_000_000n; // 0.0002 ETH

// Below this the bridge is not worth taking. Measured on the same run, the
// route costs about $0.30 flat: 5 USDC delivered 4.73 (5.4% gone), 25 delivered
// 24.67 (1.3%), 100 delivered 99.46, 1000 delivered 999.42. The cost barely
// moves with size, so it is the small transfers that get hurt, and a user
// moving $5 should be told rather than discover it on arrival.
export const LOSSY_RETURN_BELOW_ATOMIC = 25_000_000n; // 25 USDC

// Rough delivered-amount shortfall, for the form's warning copy. Not a quote:
// the real figure comes back from /route at execution time.
export const RETURN_COST_USDC = 0.3;

// True when the wallet cannot pay for its own Base transactions. Exported so
// the form can say so before the user commits to an amount.
export function needsBaseGas(ethBalanceWei: string): boolean {
  return BigInt(ethBalanceWei || "0") < GAS_FLOOR_WEI;
}

// The whole balance is movable: Trustware's fee comes out of the delivered
// side, and gas is paid in ETH rather than in the token being sent. This exists
// as a named export anyway so the form's Max button and the guard below cannot
// drift apart.
export function maxReturnableBaseUsdcAtomic(baseUsdcAtomic: string): string {
  return BigInt(baseUsdcAtomic || "0").toString();
}

function returnRequest(
  fromAmountAtomic: string,
  evmAddress: string,
  solanaAddress: string,
): TrustwareQuoteRequest {
  return {
    fromChain: String(BASE_CHAIN_ID),
    toChain: TRUSTWARE_SOLANA_CHAIN,
    fromToken: BASE_USDC.address,
    toToken: USDC_MINT,
    fromAmount: fromAmountAtomic,
    fromAddress: evmAddress,
    toAddress: solanaAddress,
    // Crosses a bridge, so it keeps Trustware's default tolerance rather than
    // the tight Solana-swap setting, matching the Monad return leg.
    slippage: TRUSTWARE_DEFAULT_SLIPPAGE,
  };
}

export type BaseReturnProgress = {
  stage: "moving" | "done";
  message: string;
};

// Move Base USDC to the Solana wallet.
//
// executeEvmRoute does the work: it switches the wallet to Base, grants the
// allowance, broadcasts, submits the receipt Trustware needs to track a route
// the user has already paid for, and holds until settlement. The guards here
// are the parts it cannot know about.
export async function sendBaseUsdcToSolana(args: {
  amountAtomic: bigint;
  baseUsdcAtomic: string;
  ethBalanceWei: string;
  evm: EvmSigner;
  solanaAddress: string;
  onProgress?: (progress: BaseReturnProgress) => void;
  signal?: AbortSignal;
}): Promise<{ deliveredAtomic: string | null }> {
  if (args.amountAtomic <= 0n) throw new Error("Enter an amount above zero.");
  if (args.amountAtomic > BigInt(args.baseUsdcAtomic || "0")) {
    throw new Error("Amount is above the wallet's Base USDC balance.");
  }
  if (needsBaseGas(args.ethBalanceWei)) {
    throw new Error(
      "Your wallet has no ETH on Base to pay gas for this transfer. " +
        "Send a small amount of Base ETH to the same address first.",
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
        stage: p.stage === "settled" ? "done" : "moving",
        message: p.stage === "settled" ? "USDC arrived on Solana." : p.message,
      }),
    signal: args.signal,
  });
  return { deliveredAtomic: result.deliveredAtomic };
}
