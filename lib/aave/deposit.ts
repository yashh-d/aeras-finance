"use client";

// Deposit into, and get out of, the Aave vaults on Ethereum, signed by the
// user's Privy embedded EVM wallet.
//
// Same signing shape as lib/morpho/deposit.ts and gold-borrow.ts (switch chain
// at the wallet level, fresh provider, read the chain id back, approve, send,
// poll the receipt), through the shared helpers in lib/ethereum/tx.ts. What is
// specific to Aave:
//
//   1. Two vault kinds with different exits. A supply vault (the stata token)
//      is plain ERC-4626: `withdraw` or `redeem`, instant. An Umbrella vault
//      leaves in three steps spread over weeks: `cooldown()`, then wait out
//      the cooldown, then redeem inside the unstake window. Miss the window
//      and the cooldown starts over. Every function here that touches an
//      Umbrella exit says which step it is.
//
//   2. Umbrella deposits and redemptions go through BGD's UmbrellaBatchHelper,
//      so one transaction wraps USDC into the stata token and stakes it (and
//      one unstakes and unwraps). The helper needs an allowance on whatever
//      goes in: the asset for a deposit, the stake token for a redemption.
//
//   3. USDT is not a compliant ERC-20 (see lib/aave/constants.ts). The shared
//      approval helper resets a short non-zero allowance before raising it.
//
//   4. Rewards are claimed from the RewardsController to the wallet, where
//      they land as the reserve's aToken. Left there they still earn Aave's
//      supply rate but not the safety incentives, so a claim can be followed
//      by a restake: the helper accepts the aToken as an edge token, so it is
//      one approval and one deposit.
//
//   5. Every one of these costs ETH the embedded wallet does not start with;
//      lib/aave/fund.ts buys it as part of funding.

import type { EIP1193Provider } from "@privy-io/react-auth";
import { decodeFunctionResult, encodeFunctionData, erc20Abi } from "viem";

import {
  approveIfShort,
  connectEthereum,
  ethCall,
  sendTx,
  waitForReceipt,
  type EvmSigner,
} from "@/lib/ethereum/tx";

import {
  BATCH_HELPER_ABI,
  ERC4626_ABI,
  REWARDS_CONTROLLER_ABI,
  STAKE_TOKEN_ABI,
} from "./abi";
import { UMBRELLA_BATCH_HELPER, UMBRELLA_REWARDS_CONTROLLER } from "./constants";
import type { AaveVault } from "./vaults";

export type { EvmSigner } from "@/lib/ethereum/tx";

// "funding" covers the optional Trustware legs that deliver USDC/USDT and ETH
// to the Ethereum wallet before a deposit (lib/aave/fund.ts).
export type AaveTxStage =
  | "funding"
  | "switching"
  | "approving"
  | "depositing"
  | "withdrawing"
  | "cooldown"
  | "claiming"
  | "confirming"
  | "done";

export interface AaveTxProgress {
  stage: AaveTxStage;
  message: string;
  txHash?: string;
}

type Report = (p: AaveTxProgress) => void;

// Headroom on the aToken amount a restake moves. An aToken balance grows every
// block, so a value read a moment ago is slightly stale by the time the
// helper reads it; the helper caps at the live balance, and the allowance has
// to cover that.
const RESTAKE_HEADROOM_BPS = 10n;

async function readShares(
  provider: EIP1193Provider,
  vault: string,
  owner: `0x${string}`,
): Promise<bigint> {
  const hex = await ethCall(
    provider,
    vault,
    encodeFunctionData({ abi: ERC4626_ABI, functionName: "balanceOf", args: [owner] }),
  );
  return decodeFunctionResult({ abi: ERC4626_ABI, functionName: "balanceOf", data: hex });
}

// ── deposit ────────────────────────────────────────────────────────────────

// Deposit `amountAtomic` of the vault's asset (6dp). A supply vault takes it
// directly; an Umbrella vault takes it through the batch helper, which wraps
// and stakes in one transaction. Grants the allowance first if the standing
// one is short. Returns the deposit tx hash.
export async function depositToAaveVault(args: {
  vault: AaveVault;
  amountAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { vault, amountAtomic, signer } = args;
  if (amountAtomic <= 0n) throw new Error("Enter an amount to deposit.");
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  const spender = vault.kind === "umbrella" ? UMBRELLA_BATCH_HELPER : vault.address;
  await approveIfShort({
    provider,
    token: vault.asset.address,
    symbol: vault.asset.symbol,
    owner,
    spender,
    spenderLabel: "Aave",
    amount: amountAtomic,
    report: (message) => report({ stage: "approving", message }),
  });

  report({ stage: "depositing", message: `Depositing into ${vault.name}.` });
  const hash =
    vault.kind === "umbrella"
      ? await sendTx(
          provider,
          owner,
          UMBRELLA_BATCH_HELPER,
          encodeFunctionData({
            abi: BATCH_HELPER_ABI,
            functionName: "deposit",
            args: [
              {
                stakeToken: vault.address as `0x${string}`,
                edgeToken: vault.asset.address as `0x${string}`,
                value: amountAtomic,
              },
            ],
          }),
        )
      : await sendTx(
          provider,
          owner,
          vault.address,
          encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: "deposit",
            args: [amountAtomic, owner],
          }),
        );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Deposit confirmed.", txHash: hash });
  return hash;
}

// ── supply vault: instant withdraw ─────────────────────────────────────────

// Withdraw from a supply vault. A partial withdrawal is priced in the asset
// (`withdraw`); a full exit redeems the exact share balance (`redeem`) so no
// dust is left. Subject to the reserve's free liquidity, which the form checks
// against `withdrawableAtomic` before calling. Returns the tx hash.
export async function withdrawFromAaveSupply(args: {
  vault: AaveVault;
  amountAtomic: bigint;
  redeemAll: boolean;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { vault, amountAtomic, redeemAll, signer } = args;
  if (vault.kind !== "supply") {
    throw new Error("Umbrella positions leave through a cooldown, not a withdrawal.");
  }
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  let data: `0x${string}`;
  if (redeemAll) {
    const shares = await readShares(provider, vault.address, owner);
    if (shares <= 0n) throw new Error("You have no position to withdraw.");
    data = encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: "redeem",
      args: [shares, owner, owner],
    });
  } else {
    if (amountAtomic <= 0n) throw new Error("Enter an amount to withdraw.");
    data = encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: "withdraw",
      args: [amountAtomic, owner, owner],
    });
  }

  report({ stage: "withdrawing", message: `Withdrawing from ${vault.name}.` });
  const hash = await sendTx(provider, owner, vault.address, data);
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Withdrawal confirmed.", txHash: hash });
  return hash;
}

// ── umbrella: the three-step exit ──────────────────────────────────────────

// Step 1 of 3. Snapshots the current share balance and starts the clock. The
// position keeps earning through the cooldown and stays slashable. Returns
// the tx hash.
export async function startUmbrellaCooldown(args: {
  vault: AaveVault;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { vault, signer } = args;
  if (vault.kind !== "umbrella") throw new Error("Only an Umbrella vault has a cooldown.");
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  report({ stage: "cooldown", message: "Starting the cooldown." });
  const hash = await sendTx(
    provider,
    owner,
    vault.address,
    encodeFunctionData({ abi: STAKE_TOKEN_ABI, functionName: "cooldown" }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Cooldown started.", txHash: hash });
  return hash;
}

// Step 3 of 3 (step 2 is waiting). Burns `sharesAtomic` stake shares through
// the batch helper and lands the asset in the wallet. Only works inside the
// unstake window and only up to the snapshot amount; the form derives both
// from the position read and refuses outside them, because the contract's
// revert would come after the user signed. Returns the tx hash.
export async function redeemFromUmbrella(args: {
  vault: AaveVault;
  sharesAtomic: bigint;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { vault, sharesAtomic, signer } = args;
  if (vault.kind !== "umbrella") throw new Error("Not an Umbrella vault.");
  if (sharesAtomic <= 0n) throw new Error("Enter an amount to withdraw.");
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  // The helper redeems on the user's behalf, which spends a stake-token
  // allowance. The stake token is a standard OpenZeppelin ERC-20.
  await approveIfShort({
    provider,
    token: vault.address,
    symbol: vault.symbol,
    owner,
    spender: UMBRELLA_BATCH_HELPER,
    spenderLabel: "the Aave helper",
    amount: sharesAtomic,
    report: (message) => report({ stage: "approving", message }),
  });

  report({ stage: "withdrawing", message: `Unstaking from ${vault.name}.` });
  const hash = await sendTx(
    provider,
    owner,
    UMBRELLA_BATCH_HELPER,
    encodeFunctionData({
      abi: BATCH_HELPER_ABI,
      functionName: "redeem",
      args: [
        {
          stakeToken: vault.address as `0x${string}`,
          edgeToken: vault.asset.address as `0x${string}`,
          value: sharesAtomic,
        },
      ],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: hash });
  await waitForReceipt(provider, hash);
  report({ stage: "done", message: "Withdrawal confirmed.", txHash: hash });
  return hash;
}

// ── umbrella: rewards ──────────────────────────────────────────────────────

// Claim every pending reward stream to the wallet. With `restake`, whatever
// arrived as the vault's own aToken is then deposited back through the helper,
// so it earns the safety incentives again instead of only the supply rate.
// Any reward that is not the aToken stays in the wallet either way. Returns
// the claim tx hash.
export async function claimUmbrellaRewards(args: {
  vault: AaveVault;
  restake: boolean;
  signer: EvmSigner;
  onProgress?: Report;
}): Promise<string> {
  const { vault, signer } = args;
  if (vault.kind !== "umbrella") throw new Error("Only an Umbrella vault pays rewards.");
  const report: Report = (p) => args.onProgress?.(p);
  const owner = signer.address as `0x${string}`;

  report({ stage: "switching", message: "Switching to Ethereum." });
  const provider = await connectEthereum(signer);

  // Measure the aToken delta rather than trusting the claim's return value,
  // which a JSON-RPC send does not surface.
  const aBefore = args.restake ? await readErc20(provider, vault.aToken, owner) : 0n;

  report({ stage: "claiming", message: "Claiming rewards." });
  const claimHash = await sendTx(
    provider,
    owner,
    UMBRELLA_REWARDS_CONTROLLER,
    encodeFunctionData({
      abi: REWARDS_CONTROLLER_ABI,
      functionName: "claimAllRewards",
      args: [vault.address as `0x${string}`, owner],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: claimHash });
  await waitForReceipt(provider, claimHash);

  if (!args.restake) {
    report({ stage: "done", message: "Rewards claimed to your Ethereum wallet.", txHash: claimHash });
    return claimHash;
  }

  const aAfter = await readErc20(provider, vault.aToken, owner);
  const claimed = aAfter > aBefore ? aAfter - aBefore : 0n;
  if (claimed <= 0n) {
    report({
      stage: "done",
      message: "Rewards claimed. Nothing arrived as the reserve's aToken, so there was nothing to restake.",
      txHash: claimHash,
    });
    return claimHash;
  }

  // The helper moves min(value, live balance), and the live balance is a
  // touch above the read because the aToken accrues per block. Ask for the
  // read plus headroom so it sweeps the whole claim.
  const value = (claimed * (10_000n + RESTAKE_HEADROOM_BPS)) / 10_000n + 1n;
  await approveIfShort({
    provider,
    token: vault.aToken,
    symbol: `a${vault.asset.symbol}`,
    owner,
    spender: UMBRELLA_BATCH_HELPER,
    spenderLabel: "the Aave helper",
    amount: value,
    report: (message) => report({ stage: "approving", message }),
  });

  report({ stage: "depositing", message: "Restaking the claimed rewards." });
  const restakeHash = await sendTx(
    provider,
    owner,
    UMBRELLA_BATCH_HELPER,
    encodeFunctionData({
      abi: BATCH_HELPER_ABI,
      functionName: "deposit",
      args: [
        {
          stakeToken: vault.address as `0x${string}`,
          edgeToken: vault.aToken as `0x${string}`,
          value,
        },
      ],
    }),
  );
  report({ stage: "confirming", message: "Confirming on Ethereum.", txHash: restakeHash });
  await waitForReceipt(provider, restakeHash);
  report({ stage: "done", message: "Rewards claimed and restaked.", txHash: restakeHash });
  return restakeHash;
}

async function readErc20(
  provider: EIP1193Provider,
  token: string,
  owner: `0x${string}`,
): Promise<bigint> {
  const hex = await ethCall(
    provider,
    token,
    encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
  );
  return decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: hex });
}
