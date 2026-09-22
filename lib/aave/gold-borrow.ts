"use client";

// Supply, borrow, repay and withdraw against the Aave V4 Gold spoke, signed by
// the user's Privy embedded EVM wallet on Ethereum.
//
// Same signing shape as the Morpho gold path and the same plumbing
// (lib/evm/tx.ts). What is different is the contract, and four of the
// differences are traps:
//
//   1. **Approve the Spoke.** `Spoke.supply` and `Spoke.repay` pull the tokens
//      themselves with `safeTransferFrom(msg.sender, hub, amount)`, so the
//      allowance is read against the Spoke. Aave's integration guide says
//      "approve the hub"; that fails after the user has signed.
//
//   2. **Supplying does not enable collateral.** A supply that was never
//      enabled backs nothing, and the borrow that follows reverts on health.
//      So a supply here is one `multicall` carrying `supply` and
//      `setUsingAsCollateral(true)`, which is what every real supply on this
//      spoke does. The enable call short-circuits when already set, so
//      including it every time costs nothing.
//
//   3. **Full repayment and full withdrawal are amounts, not shares.** The
//      contract clamps: any repay amount at or above the debt repays it
//      exactly and pulls only what is owed, and any withdraw amount above the
//      balance withdraws all of it. So a full repayment passes the maximum
//      uint256 and approves the debt plus headroom for the interest that
//      accrues before the block.
//
//   4. **Health is checked at exactly 1.0.** There is no separate LTV, so the
//      contract lets a borrow land on the liquidation threshold. The caller
//      sizes against /api/aave/gold-position, and the card defaults to a
//      buffer, but nothing here refuses a borrow the contract would accept.
//
// Ethereum gas is real. Each of these costs ETH the embedded wallet does not
// start with; lib/morpho/gold-fund.ts buys it as part of funding, with this
// venue's larger gas cycle.

import { encodeFunctionData, maxUint256 } from "viem";

import {
  approveIfShort,
  connectEthereum,
  sendTx,
  waitForReceipt,
  type EvmSigner,
} from "@/lib/ethereum/tx";

import { AAVE_SPOKE_ABI } from "./gold-abi";
import type { AaveGoldMarket } from "./gold-market";

export type { EvmSigner };

export type AaveGoldTxStage =
  | "switching"
  | "approving"
  | "supplying"
  | "enabling"
  | "borrowing"
  | "repaying"
  | "withdrawing"
  | "confirming"
  | "done";

export interface AaveGoldTxProgress {
  stage: AaveGoldTxStage;
  message: string;
  txHash?: string;
}

type Report = (p: AaveGoldTxProgress) => void;

// Headroom on a full-repayment approval. The contract pulls the debt as of the
// mined block, which is a little more than the debt read a moment before.
// 10 bps covers minutes of interest at any plausible rate.
const REPAY_APPROVAL_HEADROOM_BPS = 10n;

// One full borrow lifecycle on this spoke, in gas units, measured from receipts
// on 2026-09-09: XAUt approve (~50k), supply with enable (164k to 181k), borrow
// (261k to 277k), USDC approve (~50k), repay (153k to 156k), withdraw (174k).
// About 900k; rounded up so the funding planner's ETH top-up covers the exit
// as well as the entry.
export const AAVE_GAS_UNITS_FULL_CYCLE = 950_000n;

const spokeData = (
  functionName: "supply" | "withdraw" | "borrow" | "repay" | "setUsingAsCollateral",
  args: readonly unknown[],
) =>
  encodeFunctionData({
    abi: AAVE_SPOKE_ABI,
    functionName,
    args,
  } as Parameters<typeof encodeFunctionData>[0]);

// ── supply collateral ──────────────────────────────────────────────────────

// Post XAUt as collateral and enable it. This earns nothing on its own; it only
// creates borrowing power. Returns the transaction hash.
export async function supplyAaveGoldCollateral(args: {
  market: AaveGoldMarket;
  // XAUt, 6-decimal atomic.
  amountAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { market, amountAtomic, signer } = args;
  if (amountAtomic <= 0n) throw new Error("Enter an amount to supply.");
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  await approveIfShort({
    provider,
    token: market.collateralToken.address,
    symbol: market.collateralToken.symbol,
    owner,
    spender: market.spoke,
    spenderLabel: "Aave",
    amount: amountAtomic,
    report: (message) => report({ stage: "approving", message }),
  });

  report({
    stage: "supplying",
    message: `Supplying ${market.collateralToken.symbol} as collateral.`,
  });
  const hash = await sendTx(
    provider,
    owner,
    market.spoke,
    encodeFunctionData({
      abi: AAVE_SPOKE_ABI,
      functionName: "multicall",
      args: [
        [
          spokeData("supply", [market.collateral.reserveId, amountAtomic, owner]),
          spokeData("setUsingAsCollateral", [market.collateral.reserveId, true, owner]),
        ],
      ],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Collateral supplied.", txHash: hash });
  return hash;
}

// Enable XAUt already supplied as collateral, for a position opened elsewhere
// (Aave's own UI) without the flag. One call, no approval.
export async function enableAaveGoldCollateral(args: {
  market: AaveGoldMarket;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { market, signer } = args;
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  report({ stage: "enabling", message: "Enabling your gold as collateral." });
  const hash = await sendTx(
    provider,
    owner,
    market.spoke,
    spokeData("setUsingAsCollateral", [market.collateral.reserveId, true, owner]),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Collateral enabled.", txHash: hash });
  return hash;
}

// ── borrow ─────────────────────────────────────────────────────────────────

// Draw USDC against posted collateral, delivered to the user's own wallet.
//
// No approval is involved: borrowing moves the hub's tokens out, not the
// user's in. Three ways this reverts, each with a different fix: the position
// would be unhealthy (borrow less), the hub lacks free liquidity or the spoke
// has hit its draw cap (borrow less, or wait), or the reserve is frozen. All
// are checked before signing by the caller against /api/aave/gold-market.
export async function borrowAgainstAaveGold(args: {
  market: AaveGoldMarket;
  // USDC, 6-decimal atomic.
  amountAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { market, amountAtomic, signer } = args;
  if (amountAtomic <= 0n) throw new Error("Enter an amount to borrow.");
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  report({ stage: "borrowing", message: `Borrowing ${market.debtToken.symbol}.` });
  const hash = await sendTx(
    provider,
    owner,
    market.spoke,
    spokeData("borrow", [market.debt.reserveId, amountAtomic, owner]),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Borrowed.", txHash: hash });
  return hash;
}

// ── repay ──────────────────────────────────────────────────────────────────

// Repay USDC debt.
//
// A partial repayment passes the amount. A full repayment passes the maximum
// uint256: the contract clamps to the debt as of the mined block and pulls
// exactly that, so the position closes with no dust. The approval is sized
// from the debt read a moment ago plus headroom for the interest in between.
export async function repayAaveGoldDebt(args: {
  market: AaveGoldMarket;
  // USDC atomic for a partial repayment. Ignored when repayAll.
  amountAtomic: bigint;
  repayAll: boolean;
  // Current debt in USDC atomic, from /api/aave/gold-position. Sizes the
  // approval on a full repayment.
  debtAtomic: string;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { market, signer } = args;
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  const debt = BigInt(args.debtAtomic || "0");
  if (args.repayAll && debt <= 0n) {
    throw new Error("You have no debt to repay.");
  }
  if (!args.repayAll && args.amountAtomic <= 0n) {
    throw new Error("Enter an amount to repay.");
  }

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  const approvalBase = args.repayAll ? debt : args.amountAtomic;
  const approval =
    (approvalBase * (10_000n + REPAY_APPROVAL_HEADROOM_BPS)) / 10_000n + 1n;
  await approveIfShort({
    provider,
    token: market.debtToken.address,
    symbol: market.debtToken.symbol,
    owner,
    spender: market.spoke,
    spenderLabel: "Aave",
    amount: approval,
    report: (message) => report({ stage: "approving", message }),
  });

  report({
    stage: "repaying",
    message: args.repayAll
      ? `Repaying all ${market.debtToken.symbol} debt.`
      : `Repaying ${market.debtToken.symbol}.`,
  });
  const hash = await sendTx(
    provider,
    owner,
    market.spoke,
    spokeData("repay", [
      market.debt.reserveId,
      args.repayAll ? maxUint256 : args.amountAtomic,
      owner,
    ]),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Repaid.", txHash: hash });
  return hash;
}

// ── withdraw collateral ────────────────────────────────────────────────────

// Take XAUt back out, to the user's own Ethereum wallet.
//
// The contract checks health after the withdrawal, so this reverts if it would
// leave the remaining collateral unable to cover the debt. The caller sizes
// against `withdrawableCollateralAtomic` from /api/aave/gold-position, which
// is that same check computed off-chain. An amount at or above the balance is
// a full withdrawal; the contract clamps rather than reverting.
//
// The XAUt lands on Ethereum, where it earns nothing. Any surface offering this
// should offer the way back to Solana beside it, the same rule CLAUDE.md sets
// for the Ondo tokens.
export async function withdrawAaveGoldCollateral(args: {
  market: AaveGoldMarket;
  // XAUt, 6-decimal atomic.
  amountAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { market, amountAtomic, signer } = args;
  if (amountAtomic <= 0n) throw new Error("Enter an amount to withdraw.");
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  report({
    stage: "withdrawing",
    message: `Withdrawing ${market.collateralToken.symbol}.`,
  });
  const hash = await sendTx(
    provider,
    owner,
    market.spoke,
    spokeData("withdraw", [market.collateral.reserveId, amountAtomic, owner]),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Collateral withdrawn.", txHash: hash });
  return hash;
}
