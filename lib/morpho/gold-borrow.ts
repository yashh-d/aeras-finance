"use client";

// Supply, borrow, repay and withdraw against the Morpho Blue gold market,
// signed by the user's Privy embedded EVM wallet on Ethereum.
//
// Mirrors the signing shape of lib/morpho/deposit.ts (switch chain at the
// wallet level, request a fresh provider, read the chain id back, approve, send,
// poll the receipt) but talks to the Morpho Blue singleton instead of an
// ERC-4626 vault. Four things here have no equivalent in the Monad path:
//
//   1. Every call carries the full MarketParams struct, not a market address.
//      Morpho derives the market id by hashing them, so wrong params address a
//      market that does not exist and the call reverts. Loud, and safe, but
//      only after the user has signed, which is why the registry is verified by
//      scripts/morpho-gold-check.mts rather than trusted.
//
//   2. **USDT is not a compliant ERC-20.** `approve` reverts outright when it
//      would move a non-zero allowance to a different non-zero value, and
//      neither `approve` nor `transfer` returns a bool. Repaying therefore
//      resets the allowance to zero first. Skipping that reset is a revert on
//      the second repayment and works fine on the first, which is the worst
//      possible way for a bug to behave.
//
//   3. A full repayment is sized in SHARES, not assets. Debt accrues every
//      second, so repaying a number read a moment ago always leaves dust behind
//      and the position stays open. Repaying the exact share balance closes it.
//
//   4. Ethereum gas is real. Each of these costs ETH the embedded wallet does
//      not start with; lib/morpho/gold-fund.ts buys it as part of funding.

import type { EIP1193Provider } from "@privy-io/react-auth";
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
} from "viem";

import { MORPHO_BLUE_ABI } from "./gold-abi";
import {
  ETHEREUM_CHAIN_ID,
  MORPHO_BLUE,
  marketParamsTuple,
  type MorphoBlueMarket,
} from "./gold-market";

export interface EvmSigner {
  address: string;
  // Wallet-level chain switch. Privy binds each provider instance to the chain
  // active when it was requested, and the signing confirmation follows the
  // wallet's active chain, so the switch must happen at the wallet level and a
  // FRESH provider must be requested after it (see lib/privy/evm.ts).
  switchChain: (chainId: number) => Promise<void>;
  getProvider: () => Promise<EIP1193Provider>;
}

export type GoldTxStage =
  | "switching"
  | "approving"
  | "supplying"
  | "borrowing"
  | "repaying"
  | "withdrawing"
  | "confirming"
  | "done";

export interface GoldTxProgress {
  stage: GoldTxStage;
  message: string;
  txHash?: string;
}

type Report = (p: GoldTxProgress) => void;

// Headroom on a repayment approval. Debt accrues between reading the balance
// and the transaction mining, so an allowance sized to the debt read a moment
// ago can come up a few units short and revert. 10 bps covers minutes of
// interest at any plausible rate, and an unused allowance costs nothing.
const REPAY_APPROVAL_HEADROOM_BPS = 10n;

// ── low-level ──────────────────────────────────────────────────────────────

async function ethCall(
  provider: EIP1193Provider,
  to: string,
  data: Hex,
): Promise<Hex> {
  return (await provider.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  })) as Hex;
}

async function sendTx(
  provider: EIP1193Provider,
  from: string,
  to: string,
  data: Hex,
): Promise<string> {
  return (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  })) as string;
}

// Point the embedded wallet at Ethereum and hand back a provider actually bound
// to it.
//
// The switch happens on the WALLET, never via wallet_switchEthereumChain on a
// provider: a provider is bound to the chain active when it was requested, and
// the Privy signing confirmation follows the wallet's active chain. That split
// once presented a Monad approval as an Ethereum transaction. Privy also
// propagates the switch through React state, so a provider requested
// immediately after switchChain resolves can still be on the old chain; the
// poll below absorbs that, and the chain id read-back is the hard gate.
// Nothing is signed until a fresh provider reports Ethereum.
async function connectEthereum(signer: EvmSigner): Promise<EIP1193Provider> {
  try {
    await signer.switchChain(ETHEREUM_CHAIN_ID);
  } catch {
    throw new Error(
      "Could not switch your wallet to Ethereum. Nothing was signed and no funds moved.",
    );
  }
  const deadline = Date.now() + 5_000;
  for (;;) {
    const provider = await signer.getProvider();
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (BigInt(current) === BigInt(ETHEREUM_CHAIN_ID)) return provider;
    if (Date.now() >= deadline) {
      throw new Error(
        "The wallet did not switch to Ethereum. Nothing was signed and no funds moved.",
      );
    }
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${ETHEREUM_CHAIN_ID.toString(16)}` }],
      });
    } catch {
      // The wallet-level switch may still land on its own; keep polling.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function waitForReceipt(provider: EIP1193Provider, hash: string) {
  // Ethereum blocks are 12 seconds and a low-priority transaction can sit for a
  // while, so this window is wider than Monad's.
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error("The transaction failed on Ethereum.");
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 4_000));
  }
  throw new Error(
    "The transaction did not confirm on Ethereum in time. It may still land; check your wallet before retrying.",
  );
}

async function readAllowance(
  provider: EIP1193Provider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const hex = await ethCall(
    provider,
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner as `0x${string}`, spender as `0x${string}`],
    }),
  );
  return decodeFunctionResult({
    abi: erc20Abi,
    functionName: "allowance",
    data: hex,
  });
}

// Grant `amount` of `token` to Morpho Blue, dealing with USDT's approve rule.
//
// The rule: USDT reverts on any approve that changes a non-zero allowance to a
// different non-zero value. So a standing allowance that is too small must be
// zeroed before it can be raised. Compliant tokens are unaffected by the extra
// step beyond one wasted transaction, and only ever pay it when their allowance
// is genuinely short, so the branch is not worth splitting by token.
async function approveIfShort(args: {
  provider: EIP1193Provider;
  token: string;
  symbol: string;
  owner: string;
  amount: bigint;
  report: Report;
}): Promise<void> {
  const { provider, token, owner, amount, report } = args;
  const current = await readAllowance(provider, token, owner, MORPHO_BLUE);
  if (current >= amount) return;

  if (current > 0n) {
    report({
      stage: "approving",
      message: `Resetting the ${args.symbol} approval.`,
    });
    const zeroHash = await sendTx(
      provider,
      owner,
      token,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [MORPHO_BLUE as `0x${string}`, 0n],
      }),
    );
    await waitForReceipt(provider, zeroHash);
  }

  report({ stage: "approving", message: `Approving ${args.symbol} for Morpho.` });
  const hash = await sendTx(
    provider,
    owner,
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [MORPHO_BLUE as `0x${string}`, amount],
    }),
  );
  await waitForReceipt(provider, hash);
}

// ── supply collateral ──────────────────────────────────────────────────────

// Post XAUt as collateral. This earns nothing on its own; it only creates
// borrowing power. Returns the transaction hash.
export async function supplyGoldCollateral(args: {
  market: MorphoBlueMarket;
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
    amount: amountAtomic,
    report,
  });

  report({
    stage: "supplying",
    message: `Supplying ${market.collateralToken.symbol} as collateral.`,
  });
  const hash = await sendTx(
    provider,
    owner,
    MORPHO_BLUE,
    encodeFunctionData({
      abi: MORPHO_BLUE_ABI,
      functionName: "supplyCollateral",
      // Empty callback data: this is a plain supply, not a flash-style one.
      args: [marketParamsTuple(market), amountAtomic, owner, "0x"],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Collateral supplied.", txHash: hash });
  return hash;
}

// ── borrow ─────────────────────────────────────────────────────────────────

// Draw USDT against posted collateral, delivered to the user's own wallet.
//
// No approval is involved: borrowing moves the market's tokens out, not the
// user's in. Two ways this reverts that are worth distinguishing in the UI,
// because the fix differs: the position would be unhealthy (borrow less), or
// the market lacks free liquidity (borrow less, or wait). Both are checked
// before signing by the caller against /api/morpho/gold-market.
export async function borrowAgainstGold(args: {
  market: MorphoBlueMarket;
  // USDT, 6-decimal atomic.
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

  report({
    stage: "borrowing",
    message: `Borrowing ${market.loanToken.symbol}.`,
  });
  const hash = await sendTx(
    provider,
    owner,
    MORPHO_BLUE,
    encodeFunctionData({
      abi: MORPHO_BLUE_ABI,
      functionName: "borrow",
      // Sized in assets, so shares is zero. Morpho requires exactly one of the
      // two to be zero.
      args: [marketParamsTuple(market), amountAtomic, 0n, owner, owner],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Borrowed.", txHash: hash });
  return hash;
}

// ── repay ──────────────────────────────────────────────────────────────────

// Repay USDT debt.
//
// A partial repayment is sized in assets. A full repayment is sized in SHARES,
// because debt accrues continuously: repaying an asset amount read a second ago
// leaves a few units outstanding and the position stays open, holding the
// collateral hostage. Pass `repayAll` with the position's current borrow shares
// to close it exactly.
export async function repayGoldDebt(args: {
  market: MorphoBlueMarket;
  // USDT atomic for a partial repayment. Ignored when repayAll.
  amountAtomic: bigint;
  repayAll: boolean;
  // The position's borrow shares, from /api/morpho/gold-position. Required when
  // repayAll.
  borrowSharesAtomic: string;
  // Current debt in USDT atomic, used only to size the approval. The exact
  // amount pulled is computed on-chain from the shares.
  debtAtomic: string;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { market, signer } = args;
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  const shares = BigInt(args.borrowSharesAtomic || "0");
  if (args.repayAll && shares <= 0n) {
    throw new Error("You have no debt to repay.");
  }
  if (!args.repayAll && args.amountAtomic <= 0n) {
    throw new Error("Enter an amount to repay.");
  }

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  // Approve with headroom: a full repayment pulls whatever the shares are worth
  // at mining time, which is a little more than the debt read here.
  const approvalBase = args.repayAll
    ? BigInt(args.debtAtomic || "0")
    : args.amountAtomic;
  const approval =
    (approvalBase * (10_000n + REPAY_APPROVAL_HEADROOM_BPS)) / 10_000n + 1n;
  await approveIfShort({
    provider,
    token: market.loanToken.address,
    symbol: market.loanToken.symbol,
    owner,
    amount: approval,
    report,
  });

  report({
    stage: "repaying",
    message: args.repayAll
      ? `Repaying all ${market.loanToken.symbol} debt.`
      : `Repaying ${market.loanToken.symbol}.`,
  });
  const hash = await sendTx(
    provider,
    owner,
    MORPHO_BLUE,
    encodeFunctionData({
      abi: MORPHO_BLUE_ABI,
      functionName: "repay",
      args: args.repayAll
        ? [marketParamsTuple(market), 0n, shares, owner, "0x"]
        : [marketParamsTuple(market), args.amountAtomic, 0n, owner, "0x"],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Repaid.", txHash: hash });
  return hash;
}

// ── withdraw collateral ────────────────────────────────────────────────────

// Take XAUt back out, to the user's own Ethereum wallet.
//
// Morpho checks health after the withdrawal, so this reverts if it would leave
// the remaining collateral unable to cover the debt. The caller sizes against
// `withdrawableCollateralAtomic` from /api/morpho/gold-position, which is that
// same check computed off-chain.
//
// The XAUt lands on Ethereum, where it earns nothing. Any surface offering this
// should offer the way back to Solana beside it, the same rule CLAUDE.md sets
// for the Ondo tokens.
export async function withdrawGoldCollateral(args: {
  market: MorphoBlueMarket;
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
    MORPHO_BLUE,
    encodeFunctionData({
      abi: MORPHO_BLUE_ABI,
      functionName: "withdrawCollateral",
      args: [marketParamsTuple(market), amountAtomic, owner, owner],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Collateral withdrawn.", txHash: hash });
  return hash;
}
